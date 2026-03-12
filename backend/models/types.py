from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any


@dataclass
class SessionRecord:
    id: str
    agent: str                          # build / general / explore / plan
    parent_id: Optional[str] = None
    status: str = "idle"               # idle / busy / error
    model_id: Optional[str] = None
    provider_id: Optional[str] = None
    system_prompt: Optional[str] = None
    title: str = ""
    directory: str = ""
    created_at: int = 0
    updated_at: int = 0
    token_input: int = 0
    token_output: int = 0
    token_cache_read: int = 0
    cost: float = 0.0
    children: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "agent": self.agent,
            "parentId": self.parent_id,
            "status": self.status,
            "modelId": self.model_id,
            "providerId": self.provider_id,
            "systemPrompt": self.system_prompt,
            "title": self.title,
            "directory": self.directory,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "tokens": {
                "input": self.token_input,
                "output": self.token_output,
                "cacheRead": self.token_cache_read,
            },
            "cost": self.cost,
            "children": self.children,
        }


@dataclass
class MessagePart:
    type: str                           # text / tool / step-start / step-finish / reasoning / compaction
    content: Optional[str] = None
    tool_name: Optional[str] = None
    call_id: Optional[str] = None
    tool_status: Optional[str] = None  # pending / running / completed / error
    tool_input: Optional[Any] = None
    tool_output: Optional[str] = None
    token_input: int = 0
    token_output: int = 0
    cost: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "content": self.content,
            "toolName": self.tool_name,
            "callId": self.call_id,
            "toolStatus": self.tool_status,
            "toolInput": self.tool_input,
            "toolOutput": self.tool_output,
            "tokenInput": self.token_input,
            "tokenOutput": self.token_output,
            "cost": self.cost,
        }


@dataclass
class MessageRecord:
    id: str
    session_id: str
    role: str                           # user / assistant
    agent: Optional[str] = None
    timestamp: int = 0
    parts: List[MessagePart] = field(default_factory=list)
    token_input: int = 0
    token_output: int = 0
    cost: float = 0.0
    is_compaction: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "sessionId": self.session_id,
            "role": self.role,
            "agent": self.agent,
            "timestamp": self.timestamp,
            "parts": [p.to_dict() for p in self.parts],
            "tokens": {
                "input": self.token_input,
                "output": self.token_output,
            },
            "cost": self.cost,
            "isCompaction": self.is_compaction,
        }


@dataclass
class ToolCallRecord:
    call_id: str
    session_id: str
    tool: str
    args: Dict[str, Any]
    started_at: int = 0
    ended_at: Optional[int] = None
    duration_ms: Optional[int] = None
    status: str = "running"            # running / completed / error
    title: str = ""
    output_snippet: str = ""
    is_mcp: bool = False
    is_skill: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "callId": self.call_id,
            "sessionId": self.session_id,
            "tool": self.tool,
            "args": self.args,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "durationMs": self.duration_ms,
            "status": self.status,
            "title": self.title,
            "outputSnippet": self.output_snippet,
            "isMcp": self.is_mcp,
            "isSkill": self.is_skill,
        }


@dataclass
class TodoItem:
    content: str
    status: str                        # pending / in_progress / completed / cancelled
    priority: str = "medium"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "content": self.content,
            "status": self.status,
            "priority": self.priority,
        }


@dataclass
class SkillRecord:
    name: str
    description: str
    session_id: str
    loaded_at: int = 0
    source: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "sessionId": self.session_id,
            "loadedAt": self.loaded_at,
            "source": self.source,
        }
