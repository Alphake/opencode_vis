from flask import Blueprint, jsonify, request, current_app
import hashlib
import json
import math
import os
from services.projection_service import (
    DashScopeEmbedder,
    HuggingFaceEmbedder,
    attach_simple_positions,
    build_mock_embeddings,
    build_part_nodes_from_messages,
    log_projection_debug,
)
from services.keyword_extraction_service import (
    build_full_message_text as _build_full_message_text,
    build_full_session_text as _build_full_session_text,
    extract_keywords_with_llm as _extract_keywords_with_llm,
)
from services.overview_layout import (
    message_layout_text as _message_layout_text,
    message_visual_type as _message_visual_type,
    reduce_vectors_2d as _reduce_vectors_2d,
    agent_group_status as _agent_group_status,
    first_user_message_text as _first_user_message_text,
    first_todo_text as _first_todo_text,
    place_point_by_landmarks as _place_point_by_landmarks,
)

api_bp = Blueprint("api", __name__)


def _store():
    return current_app.config["STORE"]


def _overview_states():
    states = current_app.config.get("OVERVIEW_STATES")
    if states is None:
        states = {}
        current_app.config["OVERVIEW_STATES"] = states
    return states


def _normalize_directory(directory: str) -> str:
    """
    规范化 directory 便于比较：统一路径分隔符、去掉末尾斜杠。
    解决 Postman/URL 传 D:\\\\projects\\\\... 与 store 里 D:/projects/... 不一致导致 sessionCount=0 的问题。
    """
    if not directory:
        return ""
    return directory.replace("\\", "/").strip().rstrip("/")


def _embed_by_mode(texts, embedding_mode: str, embedding_model: str):
    """
    统一 embedding 入口：
    - dashscope：阿里百炼
    - hf：本地 HuggingFace（免费开源）
    - mock：hash 向量（联调兜底）
    """
    mode = (embedding_mode or "dashscope").strip().lower()
    if mode == "mock":
        vectors = build_mock_embeddings(texts)
        return vectors, {
            "mode": "mock",
            "model": "mock-hash-v1",
            "vectorDim": len(vectors[0]) if vectors else 0,
            "vectorCount": len(vectors),
        }
    if mode == "hf":
        model = embedding_model or "BAAI/bge-m3"
        embedder = HuggingFaceEmbedder(model=model)
        err = embedder.ensure_ready()
        if err:
            raise RuntimeError(err)
        vectors, debug = embedder.embed_texts(texts)
        debug["mode"] = "hf"
        return vectors, debug

    model = embedding_model or "text-embedding-v3"
    embedder = DashScopeEmbedder(model=model)
    key_err = embedder.ensure_ready()
    if key_err:
        raise RuntimeError(key_err)
    vectors, debug = embedder.embed_texts(texts)
    debug["mode"] = "dashscope"
    return vectors, debug


def compute_overview_incremental(
    directory: str,
    embedding_mode: str | None = None,
    embedding_model: str | None = None,
    message_radius: float | None = None,
):
    """
    供 API 与事件流复用的增量布局计算。
    返回 (resp_dict, http_status_code)。
    """
    directory = (directory or "").strip()
    if not directory:
        return {"error": "directory is required", "addedMessageNodes": [], "debug": {}}, 400

    norm_dir = _normalize_directory(directory)
    state = _overview_states().get(norm_dir)
    if not state:
        return {
            "error": "incremental state not found, call /overview/projection/init first",
            "addedMessageNodes": [],
            "debug": {"directory": directory, "needInit": True},
        }, 409

    mode = (embedding_mode or state.get("embeddingMode", "dashscope") or "dashscope").strip().lower()
    model = (embedding_model or state.get("embeddingModel", "") or "").strip()
    if not model:
        model = "BAAI/bge-m3" if mode == "hf" else "text-embedding-v3"
    radius = float(message_radius if message_radius is not None else state.get("messageRadius", 0.28))
    radius = max(0.05, min(0.95, radius))

    sessions = [s for s in _store().all_sessions() if _normalize_directory(s.get("directory") or "") == norm_dir]
    known_ids = state.get("knownMessageIds") or set()
    if not isinstance(known_ids, set):
        known_ids = set(known_ids)
    landmarks = state.get("landmarks") or []
    center_by_agent = state.get("agentCenters") or {}

    pending = []
    dropped = 0
    for s in sessions:
        sid = s["id"]
        agent = (s.get("agent") or "unknown").strip() or "unknown"
        for m in _store().get_messages(sid):
            mid = m.get("id") or ""
            if not mid or mid in known_ids:
                continue
            layout_text = _message_layout_text(m)
            if not layout_text:
                dropped += 1
                continue
            msg_node_id = hashlib.md5(f"{directory}|msg|{sid}|{mid}".encode("utf-8")).hexdigest()[:12]
            pending.append({
                "nodeId": f"msg-{msg_node_id}",
                "agent": agent,
                "sessionId": sid,
                "messageId": mid,
                "role": m.get("role"),
                "type": _message_visual_type(m),
                "timestamp": m.get("timestamp"),
                "embeddingInput": layout_text,
            })

    if not pending:
        state["knownMessageIds"] = known_ids
        return {
            "directory": norm_dir,
            "addedMessageNodes": [],
            "debug": {
                "directory": norm_dir,
                "addedCount": 0,
                "droppedCount": dropped,
                "knownMessageCount": len(known_ids),
            },
        }, 200

    texts = [n["embeddingInput"] for n in pending]
    try:
        vectors, _ = _embed_by_mode(
            texts=texts,
            embedding_mode=mode,
            embedding_model=model,
        )
    except Exception as exc:
        return {"error": f"Embedding failed: {exc}", "addedMessageNodes": [], "debug": {"directory": directory}}, 502

    for i, node in enumerate(pending):
        vec = vectors[i] if i < len(vectors) else []
        node["embedding"] = vec
        cx, cy = center_by_agent.get(node["agent"], (0.0, 0.0))
        x, y = _place_point_by_landmarks(
            msg_vec=vec,
            landmarks=landmarks,
            agent_center=(cx, cy),
            message_radius=radius,
        )
        node["x"] = x
        node["y"] = y
        known_ids.add(node["messageId"])

    state["knownMessageIds"] = known_ids
    state["messageRadius"] = radius
    old_message_nodes = state.get("messageNodes") or []
    if not isinstance(old_message_nodes, list):
        old_message_nodes = []
    state["messageNodes"] = [*old_message_nodes, *pending]
    state["cacheReady"] = True
    _overview_states()[norm_dir] = state

    current_app.logger.info(
        "[overview.incremental] %s",
        json.dumps(
            {
                "directory": directory,
                "addedCount": len(pending),
                "knownMessageCount": len(known_ids),
                "landmarkCount": len(landmarks),
                "embeddingMode": mode,
                "embeddingModel": model,
            },
            ensure_ascii=False,
        ),
    )
    return {
        "directory": norm_dir,
        "addedMessageNodes": pending,
        "debug": {
            "directory": norm_dir,
            "addedCount": len(pending),
            "droppedCount": dropped,
            "knownMessageCount": len(known_ids),
            "landmarkCount": len(landmarks),
            "layoutMethod": "landmark_weighted_projection_v1",
            "landmarkSource": "agent + existing message nodes (frozen), new messages only",
        },
    }, 200


# ── Health ────────────────────────────────────────────────────────────────────


@api_bp.get("/health")
def health():
    store = _store()
    return jsonify({
        "ok": True,
        "sessions": len(store.all_sessions()),
    })


# ── Sessions ──────────────────────────────────────────────────────────────────


@api_bp.get("/sessions")
def list_sessions():
    return jsonify(_store().all_sessions())


@api_bp.get("/sessions/<session_id>")
def get_session(session_id: str):
    s = _store().get_session(session_id)
    if not s:
        return jsonify({"error": "not found"}), 404
    return jsonify(s.to_dict())


@api_bp.get("/overview/projection/init")
def get_overview_projection_init():
    """
    Overview 初始化投影（双层）：
    - 输入：directory
    - agentNodes: 一个 agent 一个大点（初始化锚点）
    - messageNodes: 一条 message 一个小点
    - 仅使用 text / reasoning / compaction 三类 part 的 content 拼接作为 embeddingInput
    - tool / step-start / step-finish 不参与布局
    - content 为 null/空串则跳过
    - 可选 embedding（dashscope/mock）并在后端返回 x/y
    """
    directory = (request.args.get("directory") or "").strip()
    if not directory:
        return jsonify({"error": "directory is required", "nodes": [], "debug": {}}), 400

    norm_dir = _normalize_directory(directory)
    with_embedding = (request.args.get("withEmbedding", "true") or "true").strip().lower() != "false"
    with_position = (request.args.get("withPosition", "true") or "true").strip().lower() != "false"
    embedding_mode = (request.args.get("embeddingMode", "dashscope") or "dashscope").strip().lower()
    embedding_model = (request.args.get("embeddingModel", "") or "").strip()
    if not embedding_model:
        embedding_model = "BAAI/bge-m3" if embedding_mode == "hf" else "text-embedding-v3"
    reduction_algo = (request.args.get("reductionAlgo", "mds") or "mds").strip().lower()
    message_radius = float(request.args.get("messageRadius", "0.35") or "0.35")
    message_radius = max(0.05, min(0.95, message_radius))
    clear_cache = (request.args.get("clearCache") or "").strip().lower() in ("1", "true", "yes")
    current_app.logger.info(
        "[overview.init] input=%s",
        json.dumps(
            {
                "directory": directory,
                "withEmbedding": with_embedding,
                "withPosition": with_position,
                "embeddingMode": embedding_mode,
                "embeddingModel": embedding_model,
                "reductionAlgo": reduction_algo,
                "messageRadius": message_radius,
                "clearCache": clear_cache,
            },
            ensure_ascii=False,
        ),
    )

    if clear_cache:
        _overview_states().pop(norm_dir, None)
        current_app.logger.info("[overview.init] clearCache=true, cleared state for directory=%s", norm_dir)
    sessions = [s for s in _store().all_sessions() if _normalize_directory(s.get("directory") or "") == norm_dir]
    state = _overview_states().get(norm_dir) or {}
    known_ids = state.get("knownMessageIds") or set()
    if not isinstance(known_ids, set):
        known_ids = set(known_ids)
    # 轻量缓存命中判定：message 集合未变化时，直接返回后端已保存坐标，避免重复 embedding/布局计算。
    current_ids = set()
    for s in sessions:
        sid = s.get("id")
        if not sid:
            continue
        for m in _store().get_messages(sid):
            mid = m.get("id") or ""
            if not mid:
                continue
            layout_text = _message_layout_text(m)
            if layout_text:
                current_ids.add(mid)
    if (
        not clear_cache
        and state.get("cacheReady")
        and known_ids == current_ids
        and isinstance(state.get("agentNodes"), list)
        and isinstance(state.get("messageNodes"), list)
        and isinstance(state.get("agentEdges"), list)
    ):
        current_app.logger.info(
            "[overview.init] cache-hit=%s",
            json.dumps(
                {
                    "directory": directory,
                    "agentCount": len(state.get("agentNodes") or []),
                    "pointCount": len(state.get("messageNodes") or []),
                    "knownMessageCount": len(known_ids),
                },
                ensure_ascii=False,
            ),
        )
        cached_resp = {
            "directory": norm_dir,
            "agentNodes": state.get("agentNodes") or [],
            "messageNodes": state.get("messageNodes") or [],
            "agentEdges": state.get("agentEdges") or [],
            "nodes": state.get("messageNodes") or [],
            "debug": {
                "directory": norm_dir,
                "cacheHit": True,
                "knownMessageCount": len(known_ids),
                "withEmbedding": with_embedding,
                "withPosition": with_position,
                "embeddingMode": embedding_mode,
                "embeddingModel": embedding_model,
            },
        }
        return jsonify(cached_resp)

    by_agent = {}
    for s in sessions:
        agent = (s.get("agent") or "unknown").strip() or "unknown"
        by_agent.setdefault(agent, []).append(s)
    sessions_by_id = {s["id"]: s for s in sessions}
    edge_counts = {}
    for s in sessions:
        pid = s.get("parentId")
        if not pid or pid not in sessions_by_id:
            continue
        parent = sessions_by_id[pid]
        src = (parent.get("agent") or "unknown").strip() or "unknown"
        tgt = (s.get("agent") or "unknown").strip() or "unknown"
        if not src or not tgt:
            continue
        key = (src, tgt)
        edge_counts[key] = edge_counts.get(key, 0) + 1

    agent_nodes = []
    message_nodes = []
    dropped_messages = 0
    for agent, sess_list in by_agent.items():
        # 代表 session：最新一条
        rep = sorted(sess_list, key=lambda s: s.get("createdAt") or 0, reverse=True)[0]
        status = _agent_group_status(sess_list)

        # 初始化文本 fallback：todo -> 第一条 user message -> session.title -> fallback
        todo_text, _ = _first_todo_text(sess_list, _store())
        user_text, user_mid = _first_user_message_text(sess_list, _store())
        title_text = (rep.get("title") or "").strip()
        init_source = "fallback"
        init_text = f"agent {agent}"
        if todo_text:
            init_source = "todo"
            init_text = todo_text
        elif title_text:
            init_source = "session_title"
            init_text = title_text
        elif user_text:
            init_source = "first_user_message"
            init_text = user_text
        

        agent_node_id = hashlib.md5(f"{directory}|agent|{agent}".encode("utf-8")).hexdigest()[:12]
        agent_nodes.append({
            "nodeId": f"ag-{agent_node_id}",
            "agent": agent,
            "status": status,
            "sessionId": rep["id"],
            "sessionCount": len(sess_list),
            "embeddingInput": init_text,
            "anchorMessageId": user_mid,
            "initSource": init_source,
            "messageCount": 0,
            "anchorText": init_text,
        })

        # message 小点：只取可布局内容
        for s in sess_list:
            sid = s["id"]
            for m in _store().get_messages(sid):
                layout_text = _message_layout_text(m)
                if not layout_text:
                    dropped_messages += 1
                    continue
                mid = m.get("id") or ""
                msg_node_id = hashlib.md5(f"{directory}|msg|{sid}|{mid}".encode("utf-8")).hexdigest()[:12]
                message_nodes.append({
                    "nodeId": f"msg-{msg_node_id}",
                    "agent": agent,
                    "sessionId": sid,
                    "messageId": mid,
                    "role": m.get("role"),
                    "type": _message_visual_type(m),
                    "timestamp": m.get("timestamp"),
                    "embeddingInput": layout_text,
                })

    resp = {
        "directory": norm_dir,
        "agentNodes": agent_nodes,
        "messageNodes": message_nodes,
        "agentEdges": [
            {"sourceAgent": src, "targetAgent": tgt, "count": cnt}
            for (src, tgt), cnt in edge_counts.items()
        ],
        # 兼容旧前端：继续输出 nodes=messageNodes
        "nodes": message_nodes,
        "debug": {
            "directory": norm_dir,
            "requestedDirectory": directory,
            "agentCount": len(agent_nodes),
            "pointCount": len(message_nodes),
            "sessionCount": len(sessions),
            "droppedMessageCount": dropped_messages,
            "withEmbedding": with_embedding,
            "withPosition": with_position,
            "embeddingMode": embedding_mode,
            "embeddingModel": embedding_model,
            "reductionAlgo": reduction_algo,
            "messageRadius": message_radius,
            "edgeCount": len(edge_counts),
            "initFallbackOrder": ["todo", "first_user_message", "session_title", "fallback"],
            "partTypesForLayout": ["text", "reasoning", "compaction"],
            "clearCache": clear_cache,
        },
    }
    if len(sessions) == 0:
        all_sess = _store().all_sessions()
        resp["debug"]["storeSessionCount"] = len(all_sess)
        resp["debug"]["availableDirectories"] = sorted(
            set(_normalize_directory(s.get("directory") or "") for s in all_sess) - {""}
        )
    current_app.logger.info(
        "[overview.init] grouped=%s",
        json.dumps(
            {
                "directory": directory,
                "sessionCount": len(sessions),
                "agentCount": len(agent_nodes),
                "pointCount": len(message_nodes),
                "droppedMessageCount": dropped_messages,
                "messageRadius": message_radius,
                "partTypesForLayout": ["text", "reasoning", "compaction"],
            },
            ensure_ascii=False,
        ),
    )

    if with_embedding and (agent_nodes or message_nodes):
        agent_texts = [n["embeddingInput"] for n in agent_nodes]
        message_texts = [n["embeddingInput"] for n in message_nodes]
        texts = agent_texts + message_texts
        try:
            vectors, embedding_debug = _embed_by_mode(
                texts=texts,
                embedding_mode=embedding_mode,
                embedding_model=embedding_model,
            )
            # 写回 embedding：先 agent，再 message
            for i, vec in enumerate(vectors[:len(agent_nodes)]):
                resp["agentNodes"][i]["embedding"] = vec
            for i, vec in enumerate(vectors[len(agent_nodes):]):
                resp["messageNodes"][i]["embedding"] = vec
            resp["nodes"] = resp["messageNodes"]
            resp["debug"]["embedding"] = embedding_debug
            current_app.logger.info(
                "[overview.init] embedding=%s",
                json.dumps(
                    {
                        "directory": directory,
                        "mode": embedding_debug.get("mode"),
                        "model": embedding_debug.get("model"),
                        "vectorDim": embedding_debug.get("vectorDim"),
                        "vectorCount": embedding_debug.get("vectorCount"),
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception as exc:
            return jsonify({"error": f"Embedding failed: {exc}", **resp}), 502

    if with_position:
        # 1) 先给 agent 大点布局
        agent_with_vec = [n for n in resp["agentNodes"] if isinstance(n.get("embedding"), list) and len(n.get("embedding")) >= 2]
        if len(agent_with_vec) > 1:
            agent_vecs = [[float(v) for v in n["embedding"]] for n in agent_with_vec]
            centers = _reduce_vectors_2d(agent_vecs, reduction_algo=reduction_algo)
            for i, n in enumerate(agent_with_vec):
                n["x"], n["y"] = centers[i][0], centers[i][1]
        elif len(agent_with_vec) == 1:
            # 避免 (0,0) 和 y=0：单 agent 用 (0.2, 0.2)，保证 message/增量点不塌缩到原点
            agent_with_vec[0]["x"], agent_with_vec[0]["y"] = 0.2, 0.2

        # 无 embedding 的 agent 放中间带轻微分散，同样避免 (0,0) 和 y=0
        no_vec_agents = [n for n in resp["agentNodes"] if "x" not in n or "y" not in n]
        for idx, n in enumerate(no_vec_agents):
            if len(no_vec_agents) > 1:
                n["x"] = -0.3 + 0.6 * (idx / (len(no_vec_agents) - 1))
                n["y"] = 0.2
            else:
                n["x"], n["y"] = 0.2, 0.2

        # 建立 agent -> center 映射
        center_by_agent = {n["agent"]: (n.get("x", 0.0), n.get("y", 0.0)) for n in resp["agentNodes"]}

        # 2) message 小点：先全局降维，再限制在各自 agent 中心附近半径内
        msg_with_vec = [n for n in resp["messageNodes"] if isinstance(n.get("embedding"), list) and len(n.get("embedding")) >= 2]
        layout_trace = {
            "msgWithVecCount": len(msg_with_vec),
            "totalMessageCount": len(resp["messageNodes"]),
            "agentWithVecCount": len(agent_with_vec),
            "centerByAgent": {k: list(v) for k, v in center_by_agent.items()},
        }
        if len(msg_with_vec) > 1:
            msg_vecs = [[float(v) for v in n["embedding"]] for n in msg_with_vec]
            msg_points = _reduce_vectors_2d(msg_vecs, reduction_algo=reduction_algo)
            layout_trace["msgPointsSample"] = [{"_gx": round(p[0], 4), "_gy": round(p[1], 4)} for p in msg_points[:5]]
            for i, n in enumerate(msg_with_vec):
                n["_gx"], n["_gy"] = msg_points[i][0], msg_points[i][1]
        elif len(msg_with_vec) == 1:
            msg_with_vec[0]["_gx"], msg_with_vec[0]["_gy"] = 0.0, 0.0
            layout_trace["msgPointsSample"] = [{"_gx": 0.0, "_gy": 0.0}]
        else:
            layout_trace["msgPointsSample"] = []
            layout_trace["note"] = "no message has embedding, all will use _gx=_gy=0"

        # 按 agent 局部归一化并约束到半径
        by_agent_msgs = {}
        for n in resp["messageNodes"]:
            by_agent_msgs.setdefault(n["agent"], []).append(n)
        per_agent_summary = []
        for agent, arr in by_agent_msgs.items():
            cx, cy = center_by_agent.get(agent, (0.0, 0.0))
            coords = [(float(n.get("_gx", 0.0)), float(n.get("_gy", 0.0))) for n in arr]
            if len(coords) <= 1:
                arr[0]["x"] = max(-1.0, min(1.0, cx))
                arr[0]["y"] = max(-1.0, min(1.0, cy))
                per_agent_summary.append({"agent": agent, "msgCount": len(arr), "cx": cx, "cy": cy, "branch": "single", "finalXY": [cx, cy]})
                continue
            xs = [p[0] for p in coords]
            ys = [p[1] for p in coords]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            span_x = (max_x - min_x) or 1.0
            span_y = (max_y - min_y) or 1.0
            for n in arr:
                lx = ((float(n.get("_gx", 0.0)) - min_x) / span_x) * 2.0 - 1.0
                ly = ((float(n.get("_gy", 0.0)) - min_y) / span_y) * 2.0 - 1.0
                n["x"] = max(-1.0, min(1.0, cx + lx * message_radius))
                n["y"] = max(-1.0, min(1.0, cy + ly * message_radius))
                n.pop("_gx", None)
                n.pop("_gy", None)
            first_xy = [round(arr[0]["x"], 4), round(arr[0]["y"], 4)] if arr else [0, 0]
            per_agent_summary.append({"agent": agent, "msgCount": len(arr), "cx": cx, "cy": cy, "spanX": span_x, "spanY": span_y, "branch": "multi", "firstFinalXY": first_xy})
        layout_trace["perAgentSummary"] = per_agent_summary
        resp["debug"]["layoutTrace"] = layout_trace

        # 兜底：若仍全部落在 (0,0)：按索引在圆上散开（理论上不应触发，单 agent 已改为 0.15）
        msg_nodes = resp["messageNodes"]
        if msg_nodes:
            all_zero = all(float(n.get("x", 0)) == 0.0 and float(n.get("y", 0)) == 0.0 for n in msg_nodes)
            if all_zero:
                r = 0.35
                for i, n in enumerate(msg_nodes):
                    angle = (2 * math.pi * i) / max(1, len(msg_nodes))
                    n["x"] = r * math.cos(angle)
                    n["y"] = r * math.sin(angle)
                current_app.logger.info(
                    "[overview.init] positions fallback: all message points were (0,0), spread %s points in circle r=%.2f",
                    len(msg_nodes), r,
                )
            elif len(msg_nodes) == 1 and float(msg_nodes[0].get("x", 0)) == 0.0 and float(msg_nodes[0].get("y", 0)) == 0.0:
                msg_nodes[0]["x"], msg_nodes[0]["y"] = 0.2, 0.2

        resp["nodes"] = resp["messageNodes"]
        resp["debug"]["position"] = {
            "provider": f"backend.overview_init_{reduction_algo}_v1",
            "space": "normalized[-1,1]",
            "messageRadius": message_radius,
        }
        current_app.logger.info(
            "[overview.init] positions=%s",
            json.dumps(
                {
                    "directory": directory,
                    "provider": f"backend.overview_init_{reduction_algo}_v1",
                    "reductionAlgo": reduction_algo,
                    "layoutTrace": resp["debug"].get("layoutTrace"),
                    "agentNodes": [
                        {
                            "agent": n.get("agent"),
                            "status": n.get("status"),
                            "sessionId": n.get("sessionId"),
                            "x": n.get("x"),
                            "y": n.get("y"),
                            "initSource": n.get("initSource"),
                        }
                        for n in resp["agentNodes"]
                    ],
                    "messageNodesSample": [
                        {
                            "agent": n.get("agent"),
                            "sessionId": n.get("sessionId"),
                            "messageId": n.get("messageId"),
                            "x": n.get("x"),
                            "y": n.get("y"),
                        }
                        for n in resp["messageNodes"][:100]
                    ],
                },
                ensure_ascii=False,
            ),
        )

    # 建立增量布局状态（Landmark 模式）：agent + 已有 message 均为锚点，位置不再调整；仅新 message 用 landmark 加权算位置
    try:
        agent_landmarks = [
            {"agent": n.get("agent"), "sessionId": n.get("sessionId"), "embedding": n.get("embedding"), "x": n.get("x", 0.0), "y": n.get("y", 0.0)}
            for n in resp["agentNodes"]
            if isinstance(n.get("embedding"), list) and len(n.get("embedding")) >= 2
        ]
        message_landmarks = [
            {"agent": n.get("agent"), "sessionId": n.get("sessionId"), "embedding": n.get("embedding"), "x": n.get("x", 0.0), "y": n.get("y", 0.0)}
            for n in resp["messageNodes"]
            if isinstance(n.get("embedding"), list) and len(n.get("embedding")) >= 2 and "x" in n and "y" in n
        ]
        landmarks = agent_landmarks + message_landmarks
        _overview_states()[norm_dir] = {
            "directory": norm_dir,
            "embeddingMode": embedding_mode,
            "embeddingModel": embedding_model,
            "messageRadius": message_radius,
            "landmarks": landmarks,
            "agentCenters": {n.get("agent"): (n.get("x", 0.0), n.get("y", 0.0)) for n in resp["agentNodes"]},
            "knownMessageIds": {n.get("messageId") for n in resp["messageNodes"] if n.get("messageId")},
            "agentNodes": resp["agentNodes"],
            "messageNodes": resp["messageNodes"],
            "agentEdges": resp["agentEdges"],
            "cacheReady": True,
        }
        resp["debug"]["incremental"] = {
            "enabled": True,
            "landmarkCount": len(landmarks),
            "agentLandmarkCount": len(agent_landmarks),
            "messageLandmarkCount": len(message_landmarks),
            "knownMessageCount": len(_overview_states()[norm_dir]["knownMessageIds"]),
        }
    except Exception as exc:
        current_app.logger.warning("[overview.init] incremental state build failed: %s", exc)

    return jsonify(resp)


@api_bp.get("/overview/projection/incremental")
def get_overview_projection_incremental():
    """
    Overview 增量投影：
    - 依赖 /overview/projection/init 先建立状态
    - 只返回新增 message 点（旧点不动）
    - 新点位置使用 Landmark 加权投影（基于 user/todo 等初始化锚点）
    """
    directory = (request.args.get("directory") or "").strip()
    payload, status = compute_overview_incremental(
        directory=directory,
        embedding_mode=request.args.get("embeddingMode"),
        embedding_model=request.args.get("embeddingModel"),
        message_radius=float(request.args.get("messageRadius", "0.28") or "0.28"),
    )
    return jsonify(payload), status


@api_bp.get("/sessions/<session_id>/messages")
def get_session_messages(session_id: str):
    return jsonify(_store().get_messages(session_id))


@api_bp.post("/monitor/extract-keywords")
def post_monitor_extract_keywords():
    """
    监控用关键词提取：用 LLM 从全量消息文本中提取意图与关键词（不接入现有布局）。

    请求体（JSON）三选一：
    - text: 直接传入完整文本，用于联调或单次测试；
    - sessionId + messageId: 从 store 取该条 message，拼全量文本后提取；
    - 仅 sessionId: 取该 session 下全部 messages 拼成整段对话后提取。

    返回：{ "ok": bool, "result": { "intent_sentence", "keyword" } | null, "error": str | null, "debug": {} }
    """
    body = request.get_json(silent=True) or {}
    text = (body.get("text") or "").strip()
    session_id = (body.get("sessionId") or "").strip()
    message_id = (body.get("messageId") or "").strip()
    model = (body.get("model") or "qwen-plus-2025-07-28").strip()

    if text:
        full_text = text
        source = "body.text"
    elif session_id and message_id:
        messages = _store().get_messages(session_id)
        msg = next((m for m in messages if (m.get("id") or m.get("messageId")) == message_id), None)
        if not msg:
            return jsonify({
                "ok": False,
                "result": None,
                "error": "message not found",
                "debug": {"sessionId": session_id, "messageId": message_id},
            }), 404
        full_text = _build_full_message_text(msg)
        source = "store.message"
    elif session_id:
        messages = _store().get_messages(session_id)
        if not messages:
            return jsonify({
                "ok": False,
                "result": None,
                "error": "no messages in session",
                "debug": {"sessionId": session_id},
            }), 404
        full_text = _build_full_session_text(messages)
        source = "store.session"
    else:
        return jsonify({
            "ok": False,
            "result": None,
            "error": "provide body.text, or body.sessionId+messageId, or body.sessionId",
            "debug": {},
        }), 400

    out = _extract_keywords_with_llm(full_text, model=model)
    out["debug"]["source"] = source
    out["debug"]["input_length"] = len(full_text)
    ok = out.get("error") is None
    return jsonify({"ok": ok, "result": out.get("result"), "error": out.get("error"), "debug": out.get("debug", {})}), 200 if ok else 500


@api_bp.get("/sessions/<session_id>/projection/parts")
def get_session_part_projection(session_id: str):
    log_projection_debug(
        stage="fn.route_projection.input",
        payload={"sessionId": session_id, "queryString": request.query_string.decode("utf-8", errors="ignore")},
    )
    """
    为选中 session 构建 part 级投影输入。

    查询参数：
    - keywordMode: off | basic
    - withEmbedding: true | false（默认 true）
    - embeddingModel: DashScope embedding 模型名（默认 text-embedding-v3）
    """
    keyword_mode = (request.args.get("keywordMode", "off") or "off").strip().lower()
    with_embedding = (request.args.get("withEmbedding", "true") or "true").strip().lower() != "false"
    with_position = (request.args.get("withPosition", "true") or "true").strip().lower() != "false"
    embedding_mode = (request.args.get("embeddingMode", "dashscope") or "dashscope").strip().lower()
    embedding_model = (request.args.get("embeddingModel", "") or "").strip()
    if not embedding_model:
        embedding_model = "BAAI/bge-m3" if embedding_mode == "hf" else "text-embedding-v3"

    messages = _store().get_messages(session_id)
    nodes, extraction_debug = build_part_nodes_from_messages(
        session_id=session_id,
        messages=messages,
        keyword_mode=keyword_mode,
    )
    message_fields_dump = [
        {
            "id": m.get("id"),
            "sessionId": m.get("sessionId"),
            "role": m.get("role"),
            "agent": m.get("agent"),
            "timestamp": m.get("timestamp"),
            "tokens": m.get("tokens"),
            "cost": m.get("cost"),
            "isCompaction": m.get("isCompaction"),
            "partCount": len(m.get("parts") or []),
            "parts": m.get("parts") or [],
        }
        for m in messages
    ]

    resp = {
        "sessionId": session_id,
        "nodes": [n.to_dict() for n in nodes],
        "debug": {
            "extraction": extraction_debug,
        },
    }
    if with_position:
        resp["nodes"] = attach_simple_positions(resp["nodes"])
        resp["debug"]["position"] = {
            "provider": "backend.simple_band_v1",
            "note": "用于日志追踪与可观测，不替代前端主布局算法",
        }
        log_projection_debug(
            stage="position",
            payload={
                "sessionId": session_id,
                "nodeCount": len(resp["nodes"]),
                "positionProvider": "backend.simple_band_v1",
                "positions": [
                    {"nodeId": n.get("nodeId"), "x": n.get("x"), "y": n.get("y"), "type": n.get("type")}
                    for n in resp["nodes"][:300]
                ],
            },
        )
    log_projection_debug(
        stage="extract",
        payload={
            "sessionId": session_id,
            "query": {
                "keywordMode": keyword_mode,
                "withEmbedding": with_embedding,
                "withPosition": with_position,
                "embeddingMode": embedding_mode,
                "embeddingModel": embedding_model,
            },
            "messageFields": message_fields_dump,
            "nodes": resp["nodes"],
        },
    )
    if not with_embedding:
        log_projection_debug(
            stage="fn.route_projection.output",
            payload={"sessionId": session_id, "withEmbedding": False, "nodeCount": len(resp["nodes"])},
        )
        return jsonify(resp)

    texts = [n.embedding_input for n in nodes]
    try:
        vectors, embedding_debug = _embed_by_mode(
            texts=texts,
            embedding_mode=embedding_mode,
            embedding_model=embedding_model,
        )
    except Exception as exc:
        log_projection_debug(
            stage="error",
            payload={"sessionId": session_id, "step": "embed_texts", "error": str(exc), "embeddingMode": embedding_mode},
        )
        return jsonify({"error": f"Embedding failed: {exc}", **resp}), 502

    for i, vec in enumerate(vectors):
        resp["nodes"][i]["embedding"] = vec

    resp["debug"]["embedding"] = embedding_debug
    log_projection_debug(
        stage="embedding",
        payload={
            "sessionId": session_id,
            "embeddingDebug": embedding_debug,
            "nodes": [
                {
                    "nodeId": n.get("nodeId"),
                    "messageId": n.get("messageId"),
                    "type": n.get("type"),
                    "status": n.get("status"),
                    "embeddingInput": n.get("embeddingInput"),
                    # 如后续后端也计算坐标，这里会自动记录位置
                    "position": {"x": n.get("x"), "y": n.get("y")},
                    "embedding": n.get("embedding"),
                }
                for n in resp["nodes"]
            ],
        },
    )
    log_projection_debug(
        stage="fn.route_projection.output",
        payload={"sessionId": session_id, "withEmbedding": True, "nodeCount": len(resp["nodes"])},
    )
    return jsonify(resp)


# ── Agents / Hierarchy ────────────────────────────────────────────────────────


@api_bp.get("/agents/hierarchy")
def get_hierarchy():
    return jsonify(_store().get_hierarchy())


@api_bp.get("/agents/status")
def get_agents_status():
    sessions = _store().all_sessions()
    return jsonify(
        [
            {
                "id": s["id"],
                "agent": s["agent"],
                "status": s["status"],
                "parentId": s["parentId"],
            }
            for s in sessions
        ]
    )


# ── Tools ─────────────────────────────────────────────────────────────────────


@api_bp.get("/tools/stats")
def get_tool_stats():
    return jsonify(_store().get_tool_stats())


@api_bp.get("/tools/calls")
def get_tool_calls():
    session_id = request.args.get("sessionId")
    return jsonify(_store().get_tool_calls(session_id))


# ── Todos ─────────────────────────────────────────────────────────────────────


@api_bp.get("/todos")
def get_todos():
    return jsonify(_store().get_todos())


@api_bp.get("/todos/<session_id>")
def get_session_todos(session_id: str):
    return jsonify(_store().get_todos(session_id))


# ── Skills ────────────────────────────────────────────────────────────────────


@api_bp.get("/skills")
def get_skills():
    session_id = request.args.get("sessionId")
    return jsonify(_store().get_skills(session_id))


# ── Metrics ───────────────────────────────────────────────────────────────────


@api_bp.get("/metrics")
def get_metrics():
    return jsonify(_store().get_metrics())
