"""
Routes raw events from the OpenCode plugin to the appropriate store mutations.
Each handler receives (store, event_dict) and returns a dict describing what changed.
"""
from __future__ import annotations
import time
from typing import Any, Dict, Optional
from store.memory_store import MemoryStore
from models.types import (
    SessionRecord, MessageRecord, MessagePart,
    ToolCallRecord, TodoItem, SkillRecord,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.time() * 1000)


def _get(d: Dict, *keys, default=None):
    for k in keys:
        if not isinstance(d, dict):
            return default
        d = d.get(k, default)  # type: ignore
    return d


def _parse_status(raw) -> str:
    """OpenCode sends status as either a string or {"type": "busy"}."""
    if isinstance(raw, dict):
        raw = raw.get("type", "idle")
    status_map = {"busy": "busy", "idle": "idle", "retry": "busy", "error": "error", "completed": "idle"}
    return status_map.get(raw, "idle")


# ── session handlers ──────────────────────────────────────────────────────────

def handle_session_created(store: MemoryStore, props: Dict) -> Dict:
    info = props.get("info", props)
    s = SessionRecord(
        id=info.get("id", ""),
        agent=info.get("agent") or "unknown",
        parent_id=info.get("parentID") or info.get("parent_id"),
        status="idle",
        title=info.get("title", ""),
        directory=info.get("directory", ""),
        created_at=_get(info, "time", "created") or _now_ms(),
        updated_at=_now_ms(),
    )
    store.upsert_session(s)
    return {"action": "session.created", "sessionId": s.id, "session": s.to_dict()}


def handle_session_updated(store: MemoryStore, props: Dict) -> Dict:
    info = props.get("info", props)
    session_id = info.get("id", "")
    existing = store.get_session(session_id)
    s = SessionRecord(
        id=session_id,
        agent=(existing.agent if existing and existing.agent != "unknown" else None)
              or info.get("agent") or "unknown",
        parent_id=info.get("parentID") or info.get("parent_id")
                  or (existing.parent_id if existing else None),
        status=existing.status if existing else "idle",
        model_id=existing.model_id if existing else None,
        provider_id=existing.provider_id if existing else None,
        system_prompt=existing.system_prompt if existing else None,
        title=info.get("title") or (existing.title if existing else ""),
        directory=info.get("directory") or (existing.directory if existing else ""),
        created_at=existing.created_at if existing else _now_ms(),
        updated_at=_now_ms(),
    )
    store.upsert_session(s)
    return {"action": "session.updated", "sessionId": s.id, "session": s.to_dict()}


def handle_session_status(store: MemoryStore, props: Dict) -> Dict:
    session_id = props.get("sessionID") or props.get("session", {}).get("id", "")
    # status can be a string OR {"type": "busy"} dict
    mapped = _parse_status(props.get("status", "idle"))
    s = store.update_session_status(session_id, mapped)
    return {"action": "session.status", "sessionId": session_id, "status": mapped,
            "session": s.to_dict() if s else None}


def handle_session_idle(store: MemoryStore, props: Dict) -> Dict:
    session_id = props.get("sessionID") or props.get("session", {}).get("id", "")
    s = store.update_session_status(session_id, "idle")
    return {"action": "session.idle", "sessionId": session_id,
            "session": s.to_dict() if s else None}


def handle_session_error(store: MemoryStore, props: Dict) -> Dict:
    session_id = props.get("sessionID") or props.get("session", {}).get("id", "")
    s = store.update_session_status(session_id, "error")
    return {"action": "session.error", "sessionId": session_id,
            "session": s.to_dict() if s else None}


def handle_session_deleted(store: MemoryStore, props: Dict) -> Dict:
    """Subagents are deleted when they finish. Mark them idle/completed so they stay in history."""
    info = props.get("info", props)
    session_id = info.get("id", "")
    s = store.update_session_status(session_id, "idle")
    # Also update title if available (final state)
    if s and info.get("title"):
        s.title = info["title"]
    return {"action": "session.deleted", "sessionId": session_id,
            "session": s.to_dict() if s else None}


# ── message handlers ──────────────────────────────────────────────────────────

def handle_message_updated(store: MemoryStore, props: Dict) -> Dict:
    info = props.get("info", props)
    msg_id = info.get("id", "")
    session_id = info.get("sessionID", "")
    role = info.get("role", "assistant")
    agent = info.get("agent") or info.get("mode")

    ts = _get(info, "time", "created") or _now_ms()

    tokens = info.get("tokens", {}) or {}
    cost = info.get("cost", 0.0) or 0.0
    t_input = tokens.get("input", 0)
    t_output = tokens.get("output", 0)
    t_cache = _get(tokens, "cache", "read") or 0

    msg = MessageRecord(
        id=msg_id,
        session_id=session_id,
        role=role,
        agent=agent,
        timestamp=ts,
        token_input=t_input,
        token_output=t_output,
        cost=cost,
    )
    store.upsert_message(msg)  # will preserve existing parts

    if t_input or t_output:
        store.update_session_tokens(session_id, t_input, t_output, t_cache, cost)

    # Update session model/provider/agent from message info (most reliable source)
    model_id = info.get("modelID")
    provider_id = info.get("providerID")
    if model_id or provider_id or agent:
        store.update_session_model(session_id, model_id=model_id,
                                   provider_id=provider_id, agent=agent)

    return {"action": "message.updated", "messageId": msg_id, "sessionId": session_id}


def handle_message_part_updated(store: MemoryStore, props: Dict) -> Dict:
    raw_part = props.get("part", {}) or {}

    # msg_id and session_id are INSIDE the part object (not top-level properties)
    msg_id = raw_part.get("messageID", "") or _get(props, "message", "id") or props.get("messageID", "")
    session_id = raw_part.get("sessionID", "") or _get(props, "session", "id") or props.get("sessionID", "")

    if not msg_id:
        return {"action": "message.part.updated", "error": "missing messageID"}

    part_type = raw_part.get("type", "text")
    part = MessagePart(type=part_type)

    if part_type == "text":
        part.content = raw_part.get("text", "")
    elif part_type == "reasoning":
        part.content = raw_part.get("text", "")
    elif part_type == "tool":
        state = raw_part.get("state", {}) or {}
        part.tool_name = raw_part.get("tool", "")
        part.call_id = raw_part.get("callID") or state.get("callID")
        part.tool_status = state.get("status", "pending")
        part.tool_input = state.get("input")
        if state.get("status") in ("completed", "error"):
            part.tool_output = state.get("output") or state.get("error")
    elif part_type == "step-finish":
        tokens = raw_part.get("tokens", {}) or {}
        part.token_input = tokens.get("input", 0)
        part.token_output = tokens.get("output", 0)
        part.cost = raw_part.get("cost", 0.0) or 0.0
    elif part_type == "compaction":
        part.content = "context_compacted"

    store.upsert_message_part(msg_id, session_id, part)
    return {"action": "message.part.updated", "messageId": msg_id, "sessionId": session_id,
            "partType": part_type}


# ── tool call handlers ────────────────────────────────────────────────────────

def handle_tool_before(store: MemoryStore, props: Dict) -> Dict:
    call_id = props.get("callID", "")
    session_id = props.get("sessionID", "")
    tool = props.get("tool", "")
    args = props.get("args", {}) or {}

    is_mcp = "__" in tool
    is_skill = tool == "skill"

    record = ToolCallRecord(
        call_id=call_id,
        session_id=session_id,
        tool=tool,
        args=args,
        started_at=_now_ms(),
        status="running",
        is_mcp=is_mcp,
        is_skill=is_skill,
    )
    store.start_tool_call(record)

    if is_skill and args.get("name"):
        skill = SkillRecord(
            name=args["name"],
            description=args.get("description", ""),
            session_id=session_id,
            loaded_at=_now_ms(),
        )
        store.add_skill(skill)

    return {"action": "tool.execute.before", "callId": call_id, "tool": tool, "sessionId": session_id}


def handle_tool_after(store: MemoryStore, props: Dict) -> Dict:
    call_id = props.get("callID", "")
    title = props.get("title", "")
    output_snippet = props.get("outputSnippet", "")
    is_error = "error" in (props.get("metadata") or {})
    status = "error" if is_error else "completed"
    ended_at = _now_ms()

    record = store.finish_tool_call(call_id, status, title, output_snippet, ended_at)
    return {"action": "tool.execute.after", "callId": call_id,
            "status": status, "durationMs": record.duration_ms if record else None}


# ── todo handler ──────────────────────────────────────────────────────────────

def handle_todo_updated(store: MemoryStore, props: Dict) -> Dict:
    session_id = props.get("sessionID") or props.get("session", {}).get("id", "")
    raw_todos = props.get("todos", []) or []
    todos = [
        TodoItem(
            content=t.get("content", ""),
            status=t.get("status", "pending"),
            priority=t.get("priority", "medium"),
        )
        for t in raw_todos
    ]
    store.set_todos(session_id, todos)
    return {"action": "todo.updated", "sessionId": session_id,
            "todos": [t.to_dict() for t in todos]}


# ── chat.message handler ──────────────────────────────────────────────────────

def handle_chat_message(store: MemoryStore, props: Dict) -> Dict:
    session_id = props.get("sessionID", "")
    agent = props.get("agent")
    model = props.get("model") or {}
    model_id = model.get("modelID")
    provider_id = model.get("providerID")
    system_prompt = props.get("systemPrompt")
    role = props.get("role", "user")

    # role="system" message means the whole content IS the system prompt
    if not system_prompt and role == "system":
        system_prompt = props.get("content")

    # Always update model/agent on session (regardless of system_prompt)
    if model_id or provider_id or agent:
        store.update_session_model(session_id, model_id=model_id,
                                   provider_id=provider_id, agent=agent)

    if system_prompt:
        store.set_system_prompt(session_id, system_prompt)

    # Create session if it doesn't exist yet
    existing = store.get_session(session_id)
    if not existing:
        s = SessionRecord(
            id=session_id,
            agent=agent or "unknown",
            model_id=model_id,
            provider_id=provider_id,
            created_at=_now_ms(),
            updated_at=_now_ms(),
        )
        store.upsert_session(s)

    return {"action": "chat.message", "sessionId": session_id}


# ── dispatcher ────────────────────────────────────────────────────────────────

HANDLERS = {
    "session.created":      handle_session_created,
    "session.updated":      handle_session_updated,
    "session.deleted":      handle_session_deleted,
    "session.status":       handle_session_status,
    "session.idle":         handle_session_idle,
    "session.error":        handle_session_error,
    "message.updated":      handle_message_updated,
    "message.part.updated": handle_message_part_updated,
    "tool.execute.before":  handle_tool_before,
    "tool.execute.after":   handle_tool_after,
    "todo.updated":         handle_todo_updated,
    "chat.message":         handle_chat_message,
}


def dispatch(store: MemoryStore, event: Dict[str, Any]) -> Optional[Dict]:
    event_type = event.get("type", "")
    props = event.get("properties", {}) or {}
    handler = HANDLERS.get(event_type)
    if handler:
        try:
            return handler(store, props)
        except Exception as exc:
            return {"action": event_type, "error": str(exc)}
    return None
