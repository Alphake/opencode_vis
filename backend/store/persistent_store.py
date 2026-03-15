"""
PersistentStore — MemoryStore + SQLite backend.
All sessions, messages, tool calls, todos, and skills survive backend restarts.
"""
from __future__ import annotations
import json
import sqlite3
import time
import threading
from pathlib import Path
from typing import Optional

from store.memory_store import MemoryStore
from models.types import (
    SessionRecord, MessageRecord, MessagePart,
    ToolCallRecord, TodoItem, SkillRecord,
)

_DEFAULT_DB = Path(__file__).parent.parent / "data" / "cockpit.db"


class PersistentStore(MemoryStore):
    """MemoryStore backed by SQLite — survives backend restarts."""

    def __init__(self, db_path: Optional[Path] = None) -> None:
        super().__init__()
        if db_path is None:
            db_path = _DEFAULT_DB
        db_path.parent.mkdir(exist_ok=True)
        self._db_path = db_path

        self._db_lock = threading.Lock()
        # check_same_thread=False is safe because we guard with _db_lock
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")  # better concurrent read
        self._create_tables()
        self._load_all()

    # ── internal helpers ──────────────────────────────────────────────────────

    def _exec(self, sql: str, params=()) -> None:
        with self._db_lock:
            self._conn.execute(sql, params)
            self._conn.commit()

    def _now(self) -> int:
        return int(time.time() * 1000)

    # ── schema ────────────────────────────────────────────────────────────────

    def _create_tables(self) -> None:
        with self._db_lock:
            self._conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id               TEXT PRIMARY KEY,
                    agent            TEXT NOT NULL DEFAULT '',
                    parent_id        TEXT,
                    status           TEXT NOT NULL DEFAULT 'idle',
                    model_id         TEXT,
                    provider_id      TEXT,
                    system_prompt    TEXT,
                    title            TEXT NOT NULL DEFAULT '',
                    directory        TEXT NOT NULL DEFAULT '',
                    created_at       INTEGER NOT NULL DEFAULT 0,
                    updated_at       INTEGER NOT NULL DEFAULT 0,
                    token_input      INTEGER NOT NULL DEFAULT 0,
                    token_output     INTEGER NOT NULL DEFAULT 0,
                    token_cache_read INTEGER NOT NULL DEFAULT 0,
                    cost             REAL    NOT NULL DEFAULT 0,
                    children_json    TEXT    NOT NULL DEFAULT '[]',
                    error_history_json TEXT NOT NULL DEFAULT '[]'
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id           TEXT PRIMARY KEY,
                    session_id   TEXT NOT NULL,
                    role         TEXT NOT NULL,
                    agent        TEXT,
                    timestamp    INTEGER NOT NULL DEFAULT 0,
                    token_input  INTEGER NOT NULL DEFAULT 0,
                    token_output INTEGER NOT NULL DEFAULT 0,
                    cost         REAL    NOT NULL DEFAULT 0,
                    is_compaction INTEGER NOT NULL DEFAULT 0,
                    parts_json   TEXT    NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

                CREATE TABLE IF NOT EXISTS tool_calls (
                    call_id        TEXT PRIMARY KEY,
                    session_id     TEXT NOT NULL,
                    tool           TEXT NOT NULL,
                    args_json      TEXT NOT NULL DEFAULT '{}',
                    started_at     INTEGER NOT NULL DEFAULT 0,
                    ended_at       INTEGER,
                    duration_ms    INTEGER,
                    status         TEXT NOT NULL DEFAULT 'running',
                    title          TEXT NOT NULL DEFAULT '',
                    output_snippet TEXT NOT NULL DEFAULT '',
                    is_mcp         INTEGER NOT NULL DEFAULT 0,
                    is_skill       INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);

                CREATE TABLE IF NOT EXISTS todos (
                    session_id TEXT PRIMARY KEY,
                    todos_json TEXT NOT NULL DEFAULT '[]'
                );

                CREATE TABLE IF NOT EXISTS skills (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    description TEXT,
                    session_id  TEXT NOT NULL,
                    loaded_at   INTEGER NOT NULL DEFAULT 0,
                    source      TEXT NOT NULL DEFAULT ''
                );
            """)
            self._conn.commit()

    # ── load on startup ───────────────────────────────────────────────────────

    def _load_all(self) -> None:
        c = self._conn

        # Migrate: add error_history_json column if missing (old DB)
        try:
            c.execute("SELECT error_history_json FROM sessions LIMIT 1")
        except sqlite3.OperationalError:
            c.execute("ALTER TABLE sessions ADD COLUMN error_history_json TEXT NOT NULL DEFAULT '[]'")
            c.commit()

        for row in c.execute("SELECT * FROM sessions ORDER BY created_at"):
            s = SessionRecord(
                id=row["id"], agent=row["agent"], parent_id=row["parent_id"],
                status=row["status"], model_id=row["model_id"],
                provider_id=row["provider_id"], system_prompt=row["system_prompt"],
                title=row["title"], directory=row["directory"],
                created_at=row["created_at"], updated_at=row["updated_at"],
                token_input=row["token_input"], token_output=row["token_output"],
                token_cache_read=row["token_cache_read"], cost=row["cost"],
                children=json.loads(row["children_json"] or "[]"),
                error_history=json.loads(row["error_history_json"] or "[]"),
            )
            self.sessions[s.id] = s

        for row in c.execute("SELECT * FROM messages ORDER BY timestamp"):
            parts = [
                MessagePart(
                    type=p.get("type", "text"),
                    content=p.get("content"),
                    tool_name=p.get("toolName"),   # to_dict() uses camelCase
                    call_id=p.get("callId"),
                    tool_status=p.get("toolStatus"),
                    tool_input=p.get("toolInput"),
                    tool_output=p.get("toolOutput"),
                    token_input=p.get("tokenInput", 0),
                    token_output=p.get("tokenOutput", 0),
                    cost=p.get("cost", 0.0),
                )
                for p in json.loads(row["parts_json"] or "[]")
            ]
            msg = MessageRecord(
                id=row["id"], session_id=row["session_id"], role=row["role"],
                agent=row["agent"], timestamp=row["timestamp"],
                token_input=row["token_input"], token_output=row["token_output"],
                cost=row["cost"], is_compaction=bool(row["is_compaction"]),
                parts=parts,
            )
            self.messages[msg.id] = msg
            bucket = self.messages_by_session.setdefault(msg.session_id, [])
            if msg.id not in bucket:
                bucket.append(msg.id)

        for row in c.execute("SELECT * FROM tool_calls ORDER BY started_at"):
            r = ToolCallRecord(
                call_id=row["call_id"], session_id=row["session_id"],
                tool=row["tool"], args=json.loads(row["args_json"] or "{}"),
                started_at=row["started_at"], ended_at=row["ended_at"],
                duration_ms=row["duration_ms"], status=row["status"],
                title=row["title"], output_snippet=row["output_snippet"],
                is_mcp=bool(row["is_mcp"]), is_skill=bool(row["is_skill"]),
            )
            self.tool_calls[r.call_id] = r
            bucket = self.tool_calls_by_session.setdefault(r.session_id, [])
            if r.call_id not in bucket:
                bucket.append(r.call_id)

        for row in c.execute("SELECT * FROM todos"):
            self.todos[row["session_id"]] = [
                TodoItem(
                    content=t.get("content", ""),
                    status=t.get("status", "pending"),
                    priority=t.get("priority", "medium"),
                )
                for t in json.loads(row["todos_json"] or "[]")
            ]

        for row in c.execute("SELECT * FROM skills ORDER BY id"):
            self.skills.append(SkillRecord(
                name=row["name"], description=row["description"] or "",
                session_id=row["session_id"], loaded_at=row["loaded_at"],
                source=row["source"] or "",
            ))

        self._recalculate_session_tokens()

    def _recalculate_session_tokens(self) -> None:
        """Rebuild session tokens from stored messages to fix historical data corruption."""
        for s in self.sessions.values():
            s.token_input = 0
            s.token_output = 0
            s.cost = 0.0

        for msg in self.messages.values():
            self._msg_token_snapshot[msg.id] = (msg.token_input, msg.token_output, 0, msg.cost)
            s = self.sessions.get(msg.session_id)
            if s and (msg.token_input or msg.token_output or msg.cost):
                s.token_input += msg.token_input
                s.token_output += msg.token_output
                s.cost += msg.cost

        for s in self.sessions.values():
            self._exec(
                "UPDATE sessions SET token_input=?, token_output=?, cost=? WHERE id=?",
                (s.token_input, s.token_output, s.cost, s.id),
            )

    # ── override writes to also persist ──────────────────────────────────────

    def upsert_session(self, session: SessionRecord) -> None:
        super().upsert_session(session)
        s = self.sessions.get(session.id, session)  # super() may mutate in-place
        self._exec(
            """INSERT OR REPLACE INTO sessions
               (id, agent, parent_id, status, model_id, provider_id, system_prompt,
                title, directory, created_at, updated_at,
                token_input, token_output, token_cache_read, cost,
                children_json, error_history_json)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (s.id, s.agent, s.parent_id, s.status, s.model_id, s.provider_id,
             s.system_prompt, s.title, s.directory, s.created_at, s.updated_at,
             s.token_input, s.token_output, s.token_cache_read, s.cost,
             json.dumps(s.children), json.dumps(s.error_history)),
        )
        # Parent's children list may have been updated
        if s.parent_id and s.parent_id in self.sessions:
            p = self.sessions[s.parent_id]
            self._exec(
                "UPDATE sessions SET children_json=? WHERE id=?",
                (json.dumps(p.children), p.id),
            )

    def update_session_model(self, session_id: str, model_id=None, provider_id=None, agent=None) -> None:
        super().update_session_model(session_id, model_id=model_id, provider_id=provider_id, agent=agent)
        s = self.sessions.get(session_id)
        if s:
            self._exec(
                "UPDATE sessions SET model_id=?, provider_id=?, agent=? WHERE id=?",
                (s.model_id, s.provider_id, s.agent, session_id),
            )

    def update_session_status(self, session_id: str, status: str):
        result = super().update_session_status(session_id, status)
        if result:
            self._exec(
                "UPDATE sessions SET status=?, updated_at=? WHERE id=?",
                (status, self._now(), session_id),
            )
        return result

    def update_session_tokens(self, session_id, token_input, token_output, token_cache, cost):
        super().update_session_tokens(session_id, token_input, token_output, token_cache, cost)
        s = self.sessions.get(session_id)
        if s:
            self._exec(
                "UPDATE sessions SET token_input=?, token_output=?, token_cache_read=?, cost=? WHERE id=?",
                (s.token_input, s.token_output, s.token_cache_read, s.cost, session_id),
            )

    def sync_message_tokens(self, msg_id, session_id, token_input, token_output, token_cache, cost):
        super().sync_message_tokens(msg_id, session_id, token_input, token_output, token_cache, cost)
        s = self.sessions.get(session_id)
        if s:
            self._exec(
                "UPDATE sessions SET token_input=?, token_output=?, token_cache_read=?, cost=? WHERE id=?",
                (s.token_input, s.token_output, s.token_cache_read, s.cost, session_id),
            )

    def add_session_error(self, session_id, error_entry):
        result = super().add_session_error(session_id, error_entry)
        if result:
            self._exec(
                "UPDATE sessions SET error_history_json=? WHERE id=?",
                (json.dumps(result.error_history), session_id),
            )
        return result

    def set_system_prompt(self, session_id: str, prompt: str) -> None:
        super().set_system_prompt(session_id, prompt)
        self._exec(
            "UPDATE sessions SET system_prompt=? WHERE id=?",
            (prompt, session_id),
        )

    def upsert_message(self, msg: MessageRecord) -> None:
        super().upsert_message(msg)
        self._exec(
            """INSERT OR REPLACE INTO messages
               (id, session_id, role, agent, timestamp,
                token_input, token_output, cost, is_compaction, parts_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (msg.id, msg.session_id, msg.role, msg.agent, msg.timestamp,
             msg.token_input, msg.token_output, msg.cost, int(msg.is_compaction),
             json.dumps([p.to_dict() for p in msg.parts])),
        )

    def upsert_message_part(self, message_id: str, session_id: str, part: MessagePart) -> None:
        super().upsert_message_part(message_id, session_id, part)
        msg = self.messages.get(message_id)
        if msg:
            self._exec(
                "UPDATE messages SET parts_json=? WHERE id=?",
                (json.dumps([p.to_dict() for p in msg.parts]), message_id),
            )

    def start_tool_call(self, record: ToolCallRecord) -> None:
        super().start_tool_call(record)
        self._exec(
            """INSERT OR REPLACE INTO tool_calls
               (call_id, session_id, tool, args_json, started_at, ended_at,
                duration_ms, status, title, output_snippet, is_mcp, is_skill)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (record.call_id, record.session_id, record.tool,
             json.dumps(record.args), record.started_at, record.ended_at,
             record.duration_ms, record.status, record.title,
             record.output_snippet, int(record.is_mcp), int(record.is_skill)),
        )

    def finish_tool_call(self, call_id, status, title, output_snippet, ended_at):
        result = super().finish_tool_call(call_id, status, title, output_snippet, ended_at)
        if result:
            self._exec(
                "UPDATE tool_calls SET status=?, title=?, output_snippet=?, ended_at=?, duration_ms=? WHERE call_id=?",
                (status, title, output_snippet, ended_at, result.duration_ms, call_id),
            )
        return result

    def set_todos(self, session_id: str, todos) -> None:
        super().set_todos(session_id, todos)
        self._exec(
            "INSERT OR REPLACE INTO todos (session_id, todos_json) VALUES (?,?)",
            (session_id, json.dumps([t.to_dict() for t in todos])),
        )

    def add_skill(self, skill: SkillRecord) -> None:
        super().add_skill(skill)
        self._exec(
            "INSERT INTO skills (name, description, session_id, loaded_at, source) VALUES (?,?,?,?,?)",
            (skill.name, skill.description, skill.session_id, skill.loaded_at, skill.source),
        )
