"""
监控用关键词提取：用 LLM 从「全量消息文本」中提取「一句话」与「一个关键词」。

- 一句话（intent_sentence）：用于后续计算 embedding。
- 一个关键词（keyword）：用于在等高线图上展示。
- 不依赖现有布局逻辑，可独立调用；当前前端仍用全量消息做 embedding。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

import dashscope


DEFAULT_MODEL = "qwen-plus-2025-07-28"

# 只输出 JSON：一句话（当前目标意图与动作）+ 一个最核心关键词。不假设角色，输入可能是任意一大段内容。
KEYWORD_EXTRACTION_SYSTEM = """你是一个内容分析助手。输入是一段文本，你不知道是谁写的、也没有角色信息。请从中提取两样东西：
1. intent_sentence：用一句话概括「当前目标、意图与动作」（可稍长，用于后续向量化，需信息量足够）；
2. keyword：只提取 1 个最核心的关键词或短语（2～8 字为宜），例如「读取配置」「实现登录」「修复 Bug」。

要求：
- 只输出一个合法的 JSON 对象，不要 markdown 代码块包裹。
- 不要出现「用户希望」「用户想要」等角色表述，只描述目标/意图/动作本身。
- 若内容无法判断，intent_sentence 填「未知」，keyword 填「未知」。

输出格式（严格遵循）：
{"intent_sentence": "一句话概括", "keyword": "一个关键词"}"""


def build_full_message_text(message: Dict[str, Any], max_part_len: int = 2000) -> str:
    """
    从单条 message（含 parts）拼出「完整信息」文本，供 LLM 做关键词提取。

    包含：role、以及各 part 类型（user/assistant 下的 text、reasoning、tool、compaction 等），
    便于模型看到用户意图与 agent 行为全貌。
    """
    parts = message.get("parts") or []
    role = (message.get("role") or "assistant").strip().lower()
    lines: List[str] = [f"[role: {role}]"]

    for p in parts:
        p_type = (p.get("type") or "text").strip().lower()
        if p_type in ("step-start", "step-finish"):
            continue
        content = p.get("content")
        if p_type == "text":
            if content:
                text = _normalize(content, max_part_len)
                lines.append(f"[text]\n{text}")
        elif p_type == "reasoning":
            if content:
                text = _normalize(content, max_part_len)
                lines.append(f"[reasoning]\n{text}")
        elif p_type == "tool":
            name = p.get("toolName") or ""
            status = p.get("toolStatus") or ""
            tool_in = p.get("toolInput")
            tool_out = p.get("toolOutput")
            seg = f"[tool] name={name} status={status}"
            if tool_in is not None:
                seg += f" input={_normalize(str(tool_in), 400)}"
            if tool_out is not None:
                seg += f" output={_normalize(str(tool_out), 400)}"
            lines.append(seg)
        elif p_type == "compaction":
            lines.append("[compaction] context_compacted")
            if content:
                lines.append(_normalize(content, 500))

    return "\n\n".join(lines).strip()


def build_full_session_text(messages: List[Dict[str, Any]], max_part_len: int = 2000) -> str:
    """
    将同一 session 下多条 message 按时间顺序拼成一段完整对话文本，供整 session 级关键词提取。
    """
    sorted_msgs = sorted(messages, key=lambda m: int(m.get("timestamp") or 0))
    return "\n\n---\n\n".join(
        build_full_message_text(m, max_part_len) for m in sorted_msgs
    )


def _normalize(value: Any, max_len: int) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    s = re.sub(r"\s+", " ", s)
    if len(s) > max_len:
        return s[:max_len] + "..."
    return s


def extract_keywords_with_llm(
    text: str,
    model: str = DEFAULT_MODEL,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    调用 DashScope 对话模型，从全量消息文本中提取「一句话」与「一个关键词」。

    返回结构：
    - result: { "intent_sentence": str（用于算 embedding）, "keyword": str（用于等高线图展示） }
    - error: 若调用或解析失败则带 error 字段
    - debug: 含 model、raw_response、usage 等
    """
    key = (api_key or os.environ.get("DASHSCOPE_API_KEY", "")).strip()
    if not key:
        return {
            "result": None,
            "error": "Missing DASHSCOPE_API_KEY",
            "debug": {"model": model},
        }
    dashscope.api_key = key

    if not (text or "").strip():
        return {
            "result": {"intent_sentence": "未知", "keyword": "未知"},
            "error": None,
            "debug": {"model": model, "note": "empty input"},
        }
    # 超长时截断，避免超 token 限制
    input_text = text.strip()
    if len(input_text) > 12000:
        input_text = input_text[:12000] + "\n\n[内容已截断]"

    messages = [
        {"role": "system", "content": KEYWORD_EXTRACTION_SYSTEM},
        {"role": "user", "content": "请从以下内容中提取「当前目标、意图与动作」的一句话，以及一个最核心的关键词，只输出 JSON：\n\n" + input_text},
    ]
    debug: Dict[str, Any] = {"model": model}

    try:
        resp = dashscope.Generation.call(
            model=model,
            messages=messages,
            result_format="message",
        )
        debug["status_code"] = getattr(resp, "status_code", None)
        debug["request_id"] = getattr(resp, "request_id", None)
        if getattr(resp, "usage", None):
            debug["usage"] = getattr(resp.usage, "__dict__", None) or {}

        if resp.status_code != 200:
            return {
                "result": None,
                "error": getattr(resp, "message", None) or f"status_code={resp.status_code}",
                "debug": debug,
            }
        content = ""
        choices = getattr(getattr(resp, "output", None), "choices", None) or []
        if choices:
            msg = getattr(choices[0], "message", None)
            if msg:
                content = (getattr(msg, "content", None) or "").strip()
        debug["raw_response"] = content[:500] + ("..." if len(content) > 500 else "")

        # 解析 JSON：允许被 markdown 代码块包裹
        content_clean = content.strip()
        for prefix in ("```json\n", "```\n"):
            if content_clean.startswith(prefix):
                content_clean = content_clean[len(prefix) :].strip()
        for suffix in ("\n```", "```"):
            if content_clean.endswith(suffix):
                content_clean = content_clean[: -len(suffix)].strip()
        try:
            obj = json.loads(content_clean)
        except json.JSONDecodeError as e:
            return {
                "result": None,
                "error": f"JSON parse error: {e}",
                "debug": debug,
            }
        intent_sentence = obj.get("intent_sentence") or obj.get("intent_phrase")
        keyword = obj.get("keyword")
        if not isinstance(keyword, str):
            keyword = ""
        keyword = keyword.strip() or "未知"
        result = {
            "intent_sentence": str(intent_sentence).strip() if intent_sentence else "未知",
            "keyword": keyword,
        }
        return {"result": result, "error": None, "debug": debug}
    except Exception as e:
        debug["exception"] = str(e)
        return {
            "result": None,
            "error": str(e),
            "debug": debug,
        }
