from __future__ import annotations
import threading
from typing import Dict, List, Optional, Any
from models.types import (
    SessionRecord, MessageRecord, MessagePart,
    ToolCallRecord, TodoItem, SkillRecord,
)


class MemoryStore:
    """Thread-safe in-memory store for all agent cockpit data."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.sessions: Dict[str, SessionRecord] = {}
        self.messages: Dict[str, MessageRecord] = {}           # key: message_id
        self.messages_by_session: Dict[str, List[str]] = {}    # session_id → [msg_id]
        self.tool_calls: Dict[str, ToolCallRecord] = {}        # key: call_id
        self.tool_calls_by_session: Dict[str, List[str]] = {}  # session_id → [call_id]
        self.todos: Dict[str, List[TodoItem]] = {}             # session_id → [TodoItem]
        self.skills: List[SkillRecord] = []

    # ── Sessions ──────────────────────────────────────────────────────────────

    def upsert_session(self, session: SessionRecord) -> None:
        with self._lock:
            existing = self.sessions.get(session.id)
            if existing and session.parent_id is None:
                session.parent_id = existing.parent_id
            if existing:
                session.children = existing.children
                session.system_prompt = session.system_prompt or existing.system_prompt
            self.sessions[session.id] = session
            # Register as child of parent
            if session.parent_id and session.parent_id in self.sessions:
                parent = self.sessions[session.parent_id]
                if session.id not in parent.children:
                    parent.children.append(session.id)

    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        with self._lock:
            return self.sessions.get(session_id)

    def update_session_status(self, session_id: str, status: str) -> Optional[SessionRecord]:
        with self._lock:
            s = self.sessions.get(session_id)
            if s:
                s.status = status
            return s

    def update_session_tokens(
        self, session_id: str,
        token_input: int, token_output: int, token_cache: int, cost: float
    ) -> None:
        with self._lock:
            s = self.sessions.get(session_id)
            if s:
                s.token_input += token_input
                s.token_output += token_output
                s.token_cache_read += token_cache
                s.cost += cost

    def set_system_prompt(self, session_id: str, prompt: str) -> None:
        with self._lock:
            s = self.sessions.get(session_id)
            if s:
                s.system_prompt = prompt

    def all_sessions(self) -> List[Dict]:
        with self._lock:
            return [s.to_dict() for s in self.sessions.values()]

    def get_hierarchy(self) -> List[Dict]:
        """Return root sessions (no parentId) with nested children info."""
        with self._lock:
            roots = [s.to_dict() for s in self.sessions.values() if not s.parent_id]
            return roots

    # ── Messages ──────────────────────────────────────────────────────────────

    def update_session_model(self, session_id: str, model_id: Optional[str] = None,
                             provider_id: Optional[str] = None, agent: Optional[str] = None) -> None:
        """Update model/provider/agent on a session without replacing other fields."""
        with self._lock:
            s = self.sessions.get(session_id)
            if s:
                if model_id:
                    s.model_id = model_id
                if provider_id:
                    s.provider_id = provider_id
                if agent and (s.agent == "unknown" or not s.agent):
                    s.agent = agent

    def upsert_message(self, msg: MessageRecord) -> None:
        with self._lock:
            existing = self.messages.get(msg.id)
            # Preserve accumulated parts — message.updated final event has no parts
            if existing and not msg.parts:
                msg.parts = existing.parts
            self.messages[msg.id] = msg
            bucket = self.messages_by_session.setdefault(msg.session_id, [])
            if msg.id not in bucket:
                bucket.append(msg.id)

    def upsert_message_part(self, message_id: str, session_id: str, part: MessagePart) -> None:
        with self._lock:
            msg = self.messages.get(message_id)
            if msg is None:
                # Create a placeholder message
                msg = MessageRecord(
                    id=message_id,
                    session_id=session_id,
                    role="assistant",
                    timestamp=0,
                )
                self.upsert_message(msg)
            # Replace or append the part (match by callId for tool parts)
            if part.call_id:
                for i, p in enumerate(msg.parts):
                    if p.call_id == part.call_id:
                        msg.parts[i] = part
                        return
            msg.parts.append(part)

    def get_messages(self, session_id: str) -> List[Dict]:
        with self._lock:
            ids = self.messages_by_session.get(session_id, [])
            return [self.messages[i].to_dict() for i in ids if i in self.messages]

    # ── Tool Calls ────────────────────────────────────────────────────────────

    def start_tool_call(self, record: ToolCallRecord) -> None:
        with self._lock:
            self.tool_calls[record.call_id] = record
            bucket = self.tool_calls_by_session.setdefault(record.session_id, [])
            if record.call_id not in bucket:
                bucket.append(record.call_id)

    def finish_tool_call(
        self, call_id: str, status: str,
        title: str, output_snippet: str, ended_at: int
    ) -> Optional[ToolCallRecord]:
        with self._lock:
            r = self.tool_calls.get(call_id)
            if r:
                r.status = status
                r.title = title
                r.output_snippet = output_snippet
                r.ended_at = ended_at
                r.duration_ms = ended_at - r.started_at if r.started_at else None
            return r

    def get_tool_stats(self) -> List[Dict]:
        """Aggregate per-tool statistics across all sessions."""
        with self._lock:
            stats: Dict[str, Any] = {}
            for r in self.tool_calls.values():
                s = stats.setdefault(r.tool, {
                    "toolName": r.tool,
                    "totalCalls": 0,
                    "successCount": 0,
                    "errorCount": 0,
                    "totalDurationMs": 0,
                    "recentCalls": [],
                })
                s["totalCalls"] += 1
                if r.status == "completed":
                    s["successCount"] += 1
                elif r.status == "error":
                    s["errorCount"] += 1
                if r.duration_ms is not None:
                    s["totalDurationMs"] += r.duration_ms
                if len(s["recentCalls"]) < 10:
                    s["recentCalls"].append(r.to_dict())

            result = []
            for s in stats.values():
                total = s["totalCalls"]
                s["avgDurationMs"] = (
                    round(s["totalDurationMs"] / total) if total > 0 else 0
                )
                s["successRate"] = round(s["successCount"] / total, 3) if total > 0 else 0
                del s["totalDurationMs"]
                result.append(s)
            return sorted(result, key=lambda x: x["totalCalls"], reverse=True)

    def get_tool_calls(self, session_id: Optional[str] = None) -> List[Dict]:
        with self._lock:
            if session_id:
                ids = self.tool_calls_by_session.get(session_id, [])
                records = [self.tool_calls[i] for i in ids if i in self.tool_calls]
            else:
                records = list(self.tool_calls.values())
            return [r.to_dict() for r in records]

    # ── Todos ─────────────────────────────────────────────────────────────────

    def set_todos(self, session_id: str, todos: List[TodoItem]) -> None:
        with self._lock:
            self.todos[session_id] = todos

    def get_todos(self, session_id: Optional[str] = None) -> Dict | List:
        with self._lock:
            if session_id:
                return [t.to_dict() for t in self.todos.get(session_id, [])]
            return {
                sid: [t.to_dict() for t in items]
                for sid, items in self.todos.items()
            }

    # ── Skills ────────────────────────────────────────────────────────────────

    def add_skill(self, skill: SkillRecord) -> None:
        with self._lock:
            self.skills.append(skill)

    def get_skills(self, session_id: Optional[str] = None) -> List[Dict]:
        with self._lock:
            records = [s for s in self.skills if not session_id or s.session_id == session_id]
            return [s.to_dict() for s in records]

    # ── Metrics ───────────────────────────────────────────────────────────────

    def get_metrics(self) -> Dict[str, Any]:
        with self._lock:
            active = sum(1 for s in self.sessions.values() if s.status == "busy")
            total_input = sum(s.token_input for s in self.sessions.values())
            total_output = sum(s.token_output for s in self.sessions.values())
            total_cost = sum(s.cost for s in self.sessions.values())
            return {
                "totalSessions": len(self.sessions),
                "activeSessions": active,
                "totalMessages": len(self.messages),
                "totalToolCalls": len(self.tool_calls),
                "totalTokens": {"input": total_input, "output": total_output},
                "totalCost": round(total_cost, 6),
            }
