"""
测试「LLM 提取关键词」联调：不启动 Flask，直接调 keyword_extraction_service。

- 提取「一句话」（用于后续算 embedding）和「一个关键词」（用于等高线图展示）。
- 跑完后将原始文本、一句话、关键词写入本地文件，便于检查逻辑是否跑通。
- API Key 从 backend/.env 的 DASHSCOPE_API_KEY 读取。

用法：
  cd agent-cockpit/backend && python test_keyword_extraction.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# 确保 backend 在 path 上，并加载 .env
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

from services.keyword_extraction_service import (
    build_full_message_text,
    build_full_session_text,
    extract_keywords_with_llm,
)

# 结果写入路径（与 store 的 data 目录一致）
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "keyword_extraction_result.json")


def main():
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not key:
        print("请在 backend/.env 中配置 DASHSCOPE_API_KEY 后重试")
        sys.exit(1)

    # 用一段示例对话测试
    sample_text = """
让我搜索一下代码，看看错误是如何处理的，以及是否有pending状态。
"""
    origin_text = sample_text.strip()
    print("输入文本长度:", len(origin_text))
    print("调用 LLM 提取（一句话 + 一个关键词）...")
    out = extract_keywords_with_llm(origin_text)
    if out.get("error"):
        print("错误:", out["error"])
        print("debug:", out.get("debug"))
        sys.exit(2)
    result = out.get("result") or {}
    intent_sentence = result.get("intent_sentence", "")
    keyword = result.get("keyword", "")
    print("一句话（用于 embedding）:", intent_sentence)
    print("关键词（用于等高线图）:", keyword)
    print("debug.usage:", out.get("debug", {}).get("usage"))

    # 写入本地文件：保留 origin 文本、提取出的一句话、关键词
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    payload = {
        "origin_text": origin_text,
        "intent_sentence": intent_sentence,
        "keyword": keyword,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print("已写入:", OUTPUT_FILE)
    print("OK: 提取逻辑跑通，前端仍用全量消息做 embedding，未改布局。")


if __name__ == "__main__":
    main()
