from __future__ import annotations

import math
import random


def message_layout_text(message):
    """
    Overview 布局专用 message 文本：
    - 仅保留 text / reasoning / compaction 三类 part
    - content 为 null/空串则丢弃
    - 一条 message 输出一个完整文本（不截断）
    """
    parts = message.get("parts") or []
    keep_types = {"text", "reasoning", "compaction"}
    chunks = []
    for p in parts:
        ptype = (p.get("type") or "").strip().lower()
        if ptype not in keep_types:
            continue
        content = p.get("content")
        if content is None:
            continue
        text = str(content).strip()
        if not text:
            continue
        chunks.append(text)
    return "\n\n".join(chunks).strip()


def pairwise_sqdist(vectors):
    n = len(vectors)
    d2 = [[0.0] * n for _ in range(n)]
    for i in range(n):
        vi = vectors[i]
        for j in range(i + 1, n):
            vj = vectors[j]
            s = 0.0
            dim = min(len(vi), len(vj))
            for k in range(dim):
                diff = float(vi[k]) - float(vj[k])
                s += diff * diff
            d2[i][j] = s
            d2[j][i] = s
    return d2


def normalize_points(points):
    """
    将二维点归一化到 [-1,1]，方便前端统一渲染。
    """
    if not points:
        return points
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = (max_x - min_x) or 1.0
    span_y = (max_y - min_y) or 1.0
    return [(((x - min_x) / span_x) * 2.0 - 1.0, ((y - min_y) / span_y) * 2.0 - 1.0) for x, y in points]


def power_iteration(mat, iters=80):
    """
    对称矩阵幂迭代，近似求最大特征值/特征向量。
    返回 (eigenvalue, eigenvector)。
    """
    n = len(mat)
    if n == 0:
        return 0.0, []
    rnd = random.Random(42)
    v = [rnd.random() + 1e-6 for _ in range(n)]
    for _ in range(iters):
        mv = [sum(mat[i][j] * v[j] for j in range(n)) for i in range(n)]
        norm = math.sqrt(sum(x * x for x in mv)) or 1.0
        v = [x / norm for x in mv]
    mv = [sum(mat[i][j] * v[j] for j in range(n)) for i in range(n)]
    eig = sum(v[i] * mv[i] for i in range(n))
    return eig, v


def classical_mds_2d(vectors):
    """
    经典 MDS（Torgerson）：
    1) 用全量 embedding 计算两两距离
    2) 双中心化得到 Gram 矩阵 B
    3) 取前两大特征值/特征向量构造二维坐标
    """
    n = len(vectors)
    if n <= 1:
        return [(0.0, 0.0)] * n

    d2 = pairwise_sqdist(vectors)
    row_mean = [sum(r) / n for r in d2]
    col_mean = [sum(d2[i][j] for i in range(n)) / n for j in range(n)]
    all_mean = sum(row_mean) / n
    b = [[-0.5 * (d2[i][j] - row_mean[i] - col_mean[j] + all_mean) for j in range(n)] for i in range(n)]

    eig1, v1 = power_iteration(b)
    if eig1 < 0:
        eig1 = 0.0
    b2 = [[b[i][j] - eig1 * v1[i] * v1[j] for j in range(n)] for i in range(n)]
    eig2, v2 = power_iteration(b2)
    if eig2 < 0:
        eig2 = 0.0

    s1 = math.sqrt(eig1)
    s2 = math.sqrt(eig2)
    points = [(v1[i] * s1, v2[i] * s2) for i in range(n)]
    return normalize_points(points)


def tsne_2d(vectors, iterations=300, lr=80.0):
    """
    轻量 t-SNE 近似实现（用于小规模点集快速初始化）：
    - 用全量 embedding 计算高维相似度 P
    - 在二维中用 Student-t 分布构造 Q
    - 梯度下降最小化 KL(P||Q)
    """
    n = len(vectors)
    if n <= 1:
        return [(0.0, 0.0)] * n

    d2 = pairwise_sqdist(vectors)
    non_zero = [d2[i][j] for i in range(n) for j in range(n) if i != j and d2[i][j] > 0]
    sigma2 = (sum(non_zero) / len(non_zero)) if non_zero else 1.0
    sigma2 = max(sigma2, 1e-8)

    p = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            val = math.exp(-d2[i][j] / (2.0 * sigma2))
            p[i][j] = val
            p[j][i] = val
    p_sum = sum(sum(row) for row in p) or 1.0
    p = [[x / p_sum for x in row] for row in p]

    rnd = random.Random(42)
    y = [[(rnd.random() - 0.5) * 1e-3, (rnd.random() - 0.5) * 1e-3] for _ in range(n)]

    for _ in range(iterations):
        q_num = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(i + 1, n):
                dx = y[i][0] - y[j][0]
                dy = y[i][1] - y[j][1]
                val = 1.0 / (1.0 + dx * dx + dy * dy)
                q_num[i][j] = val
                q_num[j][i] = val
        q_sum = sum(sum(row) for row in q_num) or 1.0
        q = [[x / q_sum for x in row] for row in q_num]

        grads = [[0.0, 0.0] for _ in range(n)]
        for i in range(n):
            gx = 0.0
            gy = 0.0
            for j in range(n):
                if i == j:
                    continue
                dx = y[i][0] - y[j][0]
                dy = y[i][1] - y[j][1]
                inv = q_num[i][j]
                coeff = 4.0 * (p[i][j] - q[i][j]) * inv
                gx += coeff * dx
                gy += coeff * dy
            grads[i][0] = gx
            grads[i][1] = gy

        for i in range(n):
            y[i][0] += lr * grads[i][0]
            y[i][1] += lr * grads[i][1]

    points = [(pt[0], pt[1]) for pt in y]
    return normalize_points(points)


def reduce_vectors_2d(vectors, reduction_algo="mds"):
    """返回二维点列表（已归一化到 [-1,1]）。"""
    if not vectors:
        return []
    algo = (reduction_algo or "mds").strip().lower()
    if algo == "tsne":
        return tsne_2d(vectors)
    return classical_mds_2d(vectors)


def assign_overview_positions(nodes, reduction_algo="mds"):
    """
    使用全量 embedding 计算二维布局：
    - mds: 经典 MDS
    - tsne: 轻量 t-SNE
    - 都会输出归一化坐标到 [-1,1]
    """
    with_vec = [n for n in nodes if isinstance(n.get("embedding"), list) and len(n.get("embedding")) >= 2]
    if len(with_vec) <= 1:
        n = max(1, len(nodes))
        for i, node in enumerate(nodes):
            x = 0.0 if n == 1 else -1.0 + (2.0 * i) / (n - 1)
            node["x"] = x
            node["y"] = 0.0
        return nodes

    vectors = [[float(v) for v in n["embedding"]] for n in with_vec]
    points = reduce_vectors_2d(vectors, reduction_algo=reduction_algo)
    for idx, node in enumerate(with_vec):
        node["x"] = points[idx][0]
        node["y"] = points[idx][1]

    for n in nodes:
        if "x" not in n or "y" not in n:
            n["x"] = 0.0
            n["y"] = 0.0
    return nodes


def agent_group_status(sessions):
    """
    group 状态优先级：busy > error > idle
    """
    statuses = {(s.get("status") or "idle") for s in (sessions or [])}
    if "busy" in statuses:
        return "busy"
    if "error" in statuses:
        return "error"
    return "idle"


def first_user_message_text(sess_list, store):
    """在一组 session 中按时间找第一条 user message 的布局文本。"""
    ordered = sorted(sess_list, key=lambda s: s.get("createdAt") or 0)
    for s in ordered:
        for m in sorted(store.get_messages(s["id"]), key=lambda mm: mm.get("timestamp") or 0):
            if (m.get("role") or "") != "user":
                continue
            t = message_layout_text(m)
            if t:
                return t, m.get("id")
    return "", None


def first_todo_text(sess_list, store):
    """在一组 session 中优先找最近 session 的 todo 文本。"""
    ordered = sorted(sess_list, key=lambda s: s.get("createdAt") or 0, reverse=True)
    for s in ordered:
        todos = store.get_todos(s["id"]) or []
        for t in todos:
            content = (t.get("content") or "").strip()
            if content:
                return content, s["id"]
    return "", None


def _cosine_similarity(a, b):
    dim = min(len(a), len(b))
    if dim <= 0:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for i in range(dim):
        av = float(a[i])
        bv = float(b[i])
        dot += av * bv
        na += av * av
        nb += bv * bv
    denom = (math.sqrt(na) * math.sqrt(nb)) or 1.0
    return dot / denom


def place_point_by_landmarks(msg_vec, landmarks, agent_center=None, message_radius=0.28):
    """
    Landmark 增量投影（用于新增 message）：
    1) 计算新向量与所有 landmarks 的 cosine 相似度
    2) 用相似度加权求 landmarks 的二维重心
    3) 与 agent 中心做融合，保持“同 agent 聚类”视觉稳定
    4) 最终限制在 message_radius 圆内，避免漂移过远
    """
    if not landmarks:
        cx, cy = agent_center or (0.0, 0.0)
        return cx, cy

    weights = []
    for lm in landmarks:
        sim = _cosine_similarity(msg_vec, lm.get("embedding") or [])
        # 把 [-1, 1] 映射到 [0, 1]，并加 epsilon 防止全 0
        w = max(0.0, (sim + 1.0) * 0.5) + 1e-6
        weights.append(w)
    sw = sum(weights) or 1.0
    gx = sum(weights[i] * float(landmarks[i].get("x", 0.0)) for i in range(len(landmarks))) / sw
    gy = sum(weights[i] * float(landmarks[i].get("y", 0.0)) for i in range(len(landmarks))) / sw

    if agent_center is not None:
        cx, cy = float(agent_center[0]), float(agent_center[1])
        # 以 agent 中心为主，landmark 重心为辅
        x = cx * 0.65 + gx * 0.35
        y = cy * 0.65 + gy * 0.35
        dx = x - cx
        dy = y - cy
        r = math.sqrt(dx * dx + dy * dy) or 1e-12
        if r > message_radius:
            scale = message_radius / r
            x = cx + dx * scale
            y = cy + dy * scale
    else:
        x, y = gx, gy

    x = max(-1.0, min(1.0, x))
    y = max(-1.0, min(1.0, y))
    return x, y
