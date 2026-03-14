#!/usr/bin/env python3
"""
仅用 mock embedding 跑通「文本 -> embedding -> 2D 布局」链路，不启动 Flask，不下载任何模型。

用法（在 backend 目录下）：
    python test_embedding_pipeline.py

可选环境变量：
    REDUCTION_ALGO=mds  或  tsne  默认 mds
"""
from __future__ import annotations

import os
import sys

# 保证从 backend 根目录运行时能导入 services
_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from services.projection_service import build_mock_embeddings
from services.overview_layout import reduce_vectors_2d


def main():
    reduction_algo = (os.environ.get("REDUCTION_ALGO") or "mds").strip().lower()
    texts = [
        "Hello world",
        "Overview projection with MDS",
        "Mock embedding and 2D layout",
    ]
    print("输入文本:", texts)
    print("---")

    vectors = build_mock_embeddings(texts)
    print("Mock embedding: vectorCount=%d, dim=%d" % (len(vectors), len(vectors[0]) if vectors else 0))
    print("---")

    points = reduce_vectors_2d(vectors, reduction_algo=reduction_algo)
    print("2D 布局 (%s):" % reduction_algo)
    for i, (x, y) in enumerate(points):
        print("  [%d] (%+.4f, %+.4f)  <- %r" % (i, x, y, texts[i]))
    print("---")
    print("OK: embedding -> layout 链路跑通（无网络、无 HF 模型）。")


if __name__ == "__main__":
    main()
