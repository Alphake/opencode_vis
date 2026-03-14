from __future__ import annotations

import math
import os
import re
import json
import datetime
import threading
import hashlib
from pathlib import Path
from collections import Counter
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import dashscope


SUPPORTED_PART_TYPES = {
    "text",
    "reasoning",
    "tool",
    "step-start",
    "step-finish",
    "compaction",
}

_PROJECTION_LOG_PATH = Path(__file__).parent.parent / "logs" / "projection_debug.jsonl"
_PROJECTION_LOG_LOCK = threading.Lock()
_HF_MODEL_CACHE: Dict[str, Any] = {}
_HF_MODEL_CACHE_LOCK = threading.Lock()


@dataclass
class ProjectionNode:
    """
    由一个 MessagePart 归一化得到的可视化节点。

    设计目标：
    - 兼容前端投影渲染（x/y 点位 + 类型/状态样式）
    - 同时保留原始 payload，便于追溯“这个点是从哪条消息的哪个 part 来的”
    """

    node_id: str
    session_id: str
    message_id: str
    agent: str
    role: str
    timestamp: int
    part_type: str
    status: str
    payload: Dict[str, Any]
    embedding_input: str
    keywords: List[str]
    features: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nodeId": self.node_id,
            "sessionId": self.session_id,
            "messageId": self.message_id,
            "agent": self.agent,
            "role": self.role,
            "timestamp": self.timestamp,
            "type": self.part_type,
            "status": self.status,
            "payload": self.payload,
            "embeddingInput": self.embedding_input,
            "keywords": self.keywords,
            "features": self.features,
        }


def _normalize_text(value: Any, max_len: int = 500) -> str:
    """
    将任意值规整为紧凑文本片段。

    - dict/list 会转成字符串
    - 连续空白会压缩
    - 超长内容会截断，避免 embedding 输入过大
    """
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


def _safe_payload_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    生成日志安全摘要，避免写入过大字段导致日志文件膨胀。
    """
    out: Dict[str, Any] = {}
    for k, v in payload.items():
        if k in {"embedding", "vectors"} and isinstance(v, list):
            out[k] = f"<list len={len(v)}>"
            continue
        if isinstance(v, str):
            out[k] = _normalize_text(v, max_len=220)
        elif isinstance(v, (dict, list)):
            out[k] = _normalize_text(v, max_len=220)
        else:
            out[k] = v
    return out


def _extract_keywords_basic(text: str, top_k: int = 8) -> List[str]:
    """
    轻量关键词提取（basic 模式）。

    这里故意保持“简单、可预测”，后续可以无缝替换为 LLM 抽取实现。
    """
    if not text:
        return []
    tokens = re.findall(r"[A-Za-z0-9_\-\u4e00-\u9fff]{2,}", text.lower())
    stop = {
        "the",
        "and",
        "for",
        "with",
        "this",
        "that",
        "from",
        "have",
        "will",
        "into",
        "tool",
        "type",
        "part",
        "session",
        "message",
    }
    filtered = [t for t in tokens if t not in stop]
    if not filtered:
        return []
    freq = Counter(filtered)
    return [k for k, _ in freq.most_common(top_k)]


def _build_embedding_input(part: Dict[str, Any], agent: str, role: str) -> str:
    """
    按 part.type 组装 embedding 输入文本。

    每种类型使用固定模板，既保证可比较性，也保留类型上下文。
    """
    print(f" _build_embedding_input part: {part}")
    print(f" _build_embedding_input agent: {part}")
    print(f" _build_embedding_input role: {part}")
    
    p_type = part.get("type", "text")
    if p_type == "text":
        content = _normalize_text(part.get("content", ""))
        return f"[text] agent={agent} role={role} content={content}"
    if p_type == "reasoning":
        content = _normalize_text(part.get("content", ""))
        return f"[reasoning] agent={agent} role={role} content={content}"
    if p_type == "tool":
        tool = _normalize_text(part.get("toolName", ""))
        status = _normalize_text(part.get("toolStatus", "pending"))
        tool_input = _normalize_text(part.get("toolInput", ""), max_len=350)
        tool_output = _normalize_text(part.get("toolOutput", ""), max_len=350)
        return (
            f"[tool] agent={agent} role={role} tool={tool} status={status} "
            f"input={tool_input} output={tool_output}"
        )
    if p_type == "step-finish":
        return (
            "[step-finish] "
            f"tokenInput={part.get('tokenInput', 0)} "
            f"tokenOutput={part.get('tokenOutput', 0)} "
            f"cost={part.get('cost', 0)}"
        )
    if p_type == "step-start":
        return "[step-start]"
    if p_type == "compaction":
        return "[compaction] context_compacted"
    return f"[unknown] {_normalize_text(part.get('content', ''), max_len=350)}"


def _derive_part_status(part: Dict[str, Any], is_latest_message: bool) -> str:
    """
    生成节点状态（用于可视化样式）。

    - tool 类型保留原始 toolStatus
    - 非 tool 类型使用 active/final 派生状态
    """
    if part.get("type") == "tool":
        return str(part.get("toolStatus", "pending"))
    return "active" if is_latest_message else "final"


def _vector_norm(vec: List[float]) -> float:
    return math.sqrt(sum(x * x for x in vec))


class DashScopeEmbedder:
    """
    DashScope embedding 的封装适配器。

    API Key 从环境变量 `DASHSCOPE_API_KEY` 读取。
    """

    def __init__(self, model: str = "text-embedding-v3") -> None:
        self.model = model
        self.api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
        if self.api_key:
            dashscope.api_key = self.api_key

    def ensure_ready(self) -> Optional[str]:
        log_projection_debug(
            stage="fn.ensure_ready.input",
            payload={"model": self.model, "hasApiKey": bool(self.api_key)},
        )
        if not self.api_key:
            log_projection_debug(
                stage="fn.ensure_ready.output",
                payload={"ok": False, "error": "Missing DASHSCOPE_API_KEY"},
            )
            return "Missing DASHSCOPE_API_KEY environment variable."
        log_projection_debug(stage="fn.ensure_ready.output", payload={"ok": True})
        return None

    def embed_texts(self, texts: List[str]) -> Tuple[List[List[float]], Dict[str, Any]]:
        """
        批量调用 DashScope embedding，返回向量与调试信息。
        """
        log_projection_debug(
            stage="fn.embed_texts.input",
            payload={
                "model": self.model,
                "textCount": len(texts),
                "textPreview": [_normalize_text(t, max_len=120) for t in texts[:5]],
            },
        )
        embeddings: List[List[float]] = []
        # DashScope embedding 单次输入上限按保守值 10 进行自动分批。
        batch_size = 10
        last_status_code: Optional[int] = None
        for start in range(0, len(texts), batch_size):
            end = min(start + batch_size, len(texts))
            batch = texts[start:end]
            log_projection_debug(
                stage="fn.embed_texts.batch.input",
                payload={"start": start, "end": end, "batchSize": len(batch)},
            )
            resp = dashscope.TextEmbedding.call(model=self.model, input=batch)
            if resp:
                print(f" _build_embedding_input resp: {resp}")
            status_code = getattr(resp, "status_code", None)
            last_status_code = status_code
            output = getattr(resp, "output", None)
            message = getattr(resp, "message", "")
            if status_code != 200:
                log_projection_debug(
                    stage="fn.embed_texts.batch.output",
                    payload={
                        "ok": False,
                        "start": start,
                        "end": end,
                        "statusCode": status_code,
                        "message": message,
                    },
                )
                raise RuntimeError(f"DashScope embedding failed: status={status_code} message={message}")

            batch_embeddings: List[List[float]] = []
            if isinstance(output, dict):
                raw_embs = output.get("embeddings", []) or []
                for item in raw_embs:
                    vec = item.get("embedding") if isinstance(item, dict) else None
                    if isinstance(vec, list):
                        batch_embeddings.append([float(v) for v in vec])
            if len(batch_embeddings) != len(batch):
                log_projection_debug(
                    stage="fn.embed_texts.batch.output",
                    payload={
                        "ok": False,
                        "start": start,
                        "end": end,
                        "error": "Embedding count mismatch in batch",
                        "expected": len(batch),
                        "actual": len(batch_embeddings),
                    },
                )
                raise RuntimeError(
                    f"Embedding count mismatch in batch: expected={len(batch)} actual={len(batch_embeddings)}"
                )
            embeddings.extend(batch_embeddings)
            log_projection_debug(
                stage="fn.embed_texts.batch.output",
                payload={"ok": True, "start": start, "end": end, "vectorCount": len(batch_embeddings)},
            )

        if len(embeddings) != len(texts):
            log_projection_debug(
                stage="fn.embed_texts.output",
                payload={"ok": False, "error": "Embedding count mismatch", "expected": len(texts), "actual": len(embeddings)},
            )
            raise RuntimeError(f"Embedding count mismatch: expected={len(texts)} actual={len(embeddings)}")

        norms = [_vector_norm(v) for v in embeddings]
        debug = {
            "model": self.model,
            "statusCode": last_status_code,
            "vectorDim": len(embeddings[0]) if embeddings else 0,
            "avgNorm": round(sum(norms) / len(norms), 6) if norms else 0,
            "batchSize": batch_size,
            "batchCount": math.ceil(len(texts) / batch_size) if texts else 0,
        }
        log_projection_debug(stage="fn.embed_texts.output", payload={"ok": True, **debug})
        return embeddings, debug


class HuggingFaceEmbedder:
    """
    本地 HuggingFace embedding 适配器（免费开源）。

    默认模型：
    - BAAI/bge-m3（中英双语、多语种通用）
    """

    def __init__(self, model: str = "BAAI/bge-m3", normalize_embeddings: bool = True) -> None:
        self.model = model
        self.normalize_embeddings = normalize_embeddings

    def ensure_ready(self) -> Optional[str]:
        try:
            import sentence_transformers  # noqa: F401
        except Exception as exc:
            return (
                "HuggingFace embedder requires `sentence-transformers` and `torch`. "
                f"import error: {exc}"
            )
        return None

    def _get_model(self):
        with _HF_MODEL_CACHE_LOCK:
            if self.model in _HF_MODEL_CACHE:
                return _HF_MODEL_CACHE[self.model]
            from sentence_transformers import SentenceTransformer
            model = SentenceTransformer(self.model)
            _HF_MODEL_CACHE[self.model] = model
            return model

    def embed_texts(self, texts: List[str]) -> Tuple[List[List[float]], Dict[str, Any]]:
        """
        批量本地向量化（CPU/GPU 由 sentence-transformers 自动选择）。
        """
        model = self._get_model()
        vecs = model.encode(
            texts,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        embeddings = [v.astype(float).tolist() for v in vecs]
        norms = [_vector_norm(v) for v in embeddings]
        debug = {
            "model": self.model,
            "provider": "huggingface",
            "vectorDim": len(embeddings[0]) if embeddings else 0,
            "vectorCount": len(embeddings),
            "avgNorm": round(sum(norms) / len(norms), 6) if norms else 0,
        }
        log_projection_debug(stage="fn.hf_embed_texts.output", payload={"ok": True, **debug})
        return embeddings, debug


def build_mock_embeddings(texts: List[str], dim: int = 64) -> List[List[float]]:
    """
    构造可复现的 mock embedding（用于离线或接口联调）。
    """
    vectors: List[List[float]] = []
    for text in texts:
        seed = hashlib.sha256(text.encode("utf-8")).digest()
        vec: List[float] = []
        for i in range(dim):
            b = seed[i % len(seed)]
            # 映射到 [-1, 1]
            vec.append((b / 127.5) - 1.0)
        vectors.append(vec)
    log_projection_debug(
        stage="fn.build_mock_embeddings.output",
        payload={"vectorCount": len(vectors), "dim": dim},
    )
    return vectors


def build_part_nodes_from_messages(
    session_id: str,
    messages: List[Dict[str, Any]],
    keyword_mode: str = "off",
) -> Tuple[List[ProjectionNode], Dict[str, Any]]:
    log_projection_debug(
        stage="fn.build_part_nodes.input",
        payload={
            "sessionId": session_id,
            "messageCount": len(messages),
            "keywordMode": keyword_mode,
        },
    )
    """
    从 session 消息构建 part 级节点。

    返回：
    - nodes：用于投影的扁平节点数组
    - debug：提取阶段统计信息（便于观测）
    """
    nodes: List[ProjectionNode] = []
    invalid_type = 0
    latest_ts = max((int(m.get("timestamp", 0) or 0) for m in messages), default=0)
    type_counter: Counter[str] = Counter()

    for msg in messages:
        message_id = str(msg.get("id", ""))
        agent = str(msg.get("agent", "") or "unknown")
        role = str(msg.get("role", "") or "assistant")
        timestamp = int(msg.get("timestamp", 0) or 0)
        is_latest = timestamp == latest_ts
        parts = msg.get("parts", []) or []
        for idx, part in enumerate(parts):
            p_type = str(part.get("type", "text"))
            if p_type not in SUPPORTED_PART_TYPES:
                invalid_type += 1
            type_counter[p_type] += 1
            call_id = _normalize_text(part.get("callId", ""), max_len=80)
            suffix = call_id if call_id else str(idx)
            node_id = f"{session_id}:{message_id}:{suffix}"
            status = _derive_part_status(part, is_latest)
            emb_input = _build_embedding_input(part, agent=agent, role=role)
            keywords = _extract_keywords_basic(emb_input) if keyword_mode == "basic" else []
            if keywords:
                emb_input = f"{emb_input} keywords={','.join(keywords)}"

            payload: Dict[str, Any] = {
                "content": part.get("content"),
                "toolName": part.get("toolName"),
                "toolInput": part.get("toolInput"),
                "toolOutput": part.get("toolOutput"),
                "toolStatus": part.get("toolStatus"),
                "callId": part.get("callId"),
                "tokenInput": part.get("tokenInput"),
                "tokenOutput": part.get("tokenOutput"),
                "cost": part.get("cost"),
            }
            features = {
                "textLength": len(str(part.get("content", "") or "")),
                "hasToolOutput": bool(part.get("toolOutput")),
                "isError": part.get("toolStatus") == "error",
            }
            nodes.append(
                ProjectionNode(
                    node_id=node_id,
                    session_id=session_id,
                    message_id=message_id,
                    agent=agent,
                    role=role,
                    timestamp=timestamp,
                    part_type=p_type,
                    status=status,
                    payload=payload,
                    embedding_input=emb_input,
                    keywords=keywords,
                    features=features,
                )
            )

    debug = {
        "sessionId": session_id,
        "messageCount": len(messages),
        "partCount": len(nodes),
        "partTypeCounts": dict(type_counter),
        "invalidTypeCount": invalid_type,
        "sampleEmbeddingInputByType": _sample_embedding_preview(nodes),
    }
    log_projection_debug(
        stage="fn.build_part_nodes.output",
        payload={
            "sessionId": session_id,
            "partCount": len(nodes),
            "partTypeCounts": dict(type_counter),
            "invalidTypeCount": invalid_type,
            "sampleEmbeddingInputByType": debug["sampleEmbeddingInputByType"],
        },
    )
    return nodes, debug


def _sample_embedding_preview(nodes: List[ProjectionNode]) -> Dict[str, str]:
    previews: Dict[str, str] = {}
    for node in nodes:
        if node.part_type not in previews:
            previews[node.part_type] = _normalize_text(node.embedding_input, max_len=160)
    return previews


def log_projection_debug(stage: str, payload: Dict[str, Any]) -> None:
    """
    将投影链路关键数据写入 backend/logs/projection_debug.jsonl。

    约定：
    - 每次调用写入一行 JSON
    - 必须包含 stage 字段（extract / embedding / position / error）
    - 允许写入 message/part/embedding/position 的完整调试信息
    """
    _PROJECTION_LOG_PATH.parent.mkdir(exist_ok=True)
    record = {
        "_ts": datetime.datetime.now().isoformat(),
        "stage": stage,
        "payload": _safe_payload_summary(payload),
    }
    with _PROJECTION_LOG_LOCK:
        with open(_PROJECTION_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    # 同步一份精简信息到控制台，方便在终端直接观察。
    try:
        preview = json.dumps(record["payload"], ensure_ascii=False)
        if len(preview) > 220:
            preview = preview[:220] + "..."
        print(f"[projection] {record['_ts']} {stage}: {preview}")
    except Exception:
        # 控制台日志失败不应影响主流程，静默忽略。
        pass


def attach_simple_positions(nodes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    为节点附加一个简单可解释的后端坐标（x/y）。

    说明：
    - 该坐标用于日志追踪与接口可观测性，不替代前端主布局算法。
    - x 按时间顺序线性分布，y 按类型分带。
    """
    log_projection_debug(
        stage="fn.attach_simple_positions.input",
        payload={"nodeCount": len(nodes)},
    )
    if not nodes:
        return nodes
    bands = {
        "text": 0.2,
        "reasoning": 0.4,
        "tool": 0.6,
        "step-start": 0.75,
        "step-finish": 0.85,
        "compaction": 0.95,
    }
    ordered = sorted(nodes, key=lambda n: (int(n.get("timestamp", 0) or 0), str(n.get("nodeId", ""))))
    total = max(1, len(ordered) - 1)
    for i, n in enumerate(ordered):
        n["x"] = i / total if total > 0 else 0.5
        n["y"] = float(bands.get(str(n.get("type", "")), 0.5))
    log_projection_debug(
        stage="fn.attach_simple_positions.output",
        payload={
            "nodeCount": len(ordered),
            "xRange": [ordered[0].get("x"), ordered[-1].get("x")] if ordered else [0, 0],
            "typeCounts": dict(Counter([str(n.get("type", "")) for n in ordered])),
        },
    )
    return ordered

