# OpenCode 数据捕获插件说明


## 一、概述

针对 [OpenCode]实时监控系统，由三个部分组成：

| 组件 | 技术 | 职责 |
|------|------|------|
| **Plugin**（插件） | TypeScript / Bun | 挂载在 OpenCode 进程内部，捕获事件并转发 |
| **Backend**（后端） | Python / Flask + SQLite | 接收事件、解析存储、对外提供 REST API 和 SSE |
| **Frontend**（前端） | React + Vite | 可视化展示 Agent 拓扑、任务、消息、工具调用 |

**数据流向：**

```
OpenCode 进程
  └─ Plugin（Hook 回调）
       └─ HTTP POST /api/events/batch（批量推送）
            └─ Flask Backend（event_router 解析 → store）
                 ├─ SSE /api/events/stream → React（snapshot + 增量事件）
                 └─ REST API（/api/sessions 等）→ React 前端
```

- **Plugin** 只负责把事件类型（如 `session.created`、`message.updated`、`message.part.updated` 等）及 `properties` 批量 POST 到后端，不存状态。
- **Backend** 的 `dispatch(store, event)` 根据事件类型更新内存/持久化 store；所有“能拿到的信息”都来自这批事件。
- **Session 必含字段**：后端存入 session 时包含 **`agent`**（general / build / explore / plan / unknown）和 **`directory`**（项目目录）。Overview 依赖这两项：从 sessions 取全部 directory，再按 directory 展示该目录下「出现过的 agent」。

- **Overview 面板**：只展示「有 session 的 agent」，但数据仍是 session。流程：前端用 **store.sessions**（SSE snapshot）→ 解析出全部 directory → 用户选一个 directory → 该 directory 下按 `session.agent` 去重得到 agent 列表，**一个 agent 一个节点**，写死布局（当前为一行圆点）；点击 agent 节点时选中该 directory+agent 下的一个 session（当前写死：`createdAt` 最新的一条），供 Agent tab 使用。后端无需新接口，snapshot 已有 sessions。

#### 前端 Agent 页：消息怎么来、左侧怎么展示、Tab 怎么分

1. **消息是怎么捕获的**
   - Plugin 把 `message.updated`、`message.part.updated` 等 POST 到 `POST /api/events/batch`，后端 `dispatch(store, event)` 写入 **store**。前端 snapshot 里只有 **sessions / toolStats / todos / skills / metrics**，不包含消息正文。

2. **左侧面板（Agent 图）**
   - **AgentGraph** 数据源是 **store.sessions**（全量），用于选中一个 session 后在右侧看 Agent / Task / Msg。

3. **Tab 与上下文**
   - **Overview**：按 directory 展示该目录下的 agent 节点，点击后选中对应 session（见上）。
   - **Agent / Task / Msg**：都是对**当前选中的 session** 的视图，消息通过 **GET /api/sessions/:id/messages** 按需拉取。

---

## 二、部署说明

### 2.1 环境依赖

| 环境 | 要求 |
|------|------|
| Python | ≥ 3.10，推荐 Anaconda |
| Node.js / Bun | Node ≥ 18 或 Bun ≥ 1.0 |
| OpenCode | 桌面端或 `dev:desktop` 源码开发版均可 |

### 2.2 后端部署

```bash
cd agent-cockpit/backend

# 安装依赖
pip install flask flask-cors

# 启动（默认 5000 端口）
python app.py


```

验证后端正常：

```bash
curl http://localhost:5000/api/health
# {"ok": true, "sessions": 0}
```

SQLite 数据库自动创建于 `backend/data/cockpit.db`，**重启后数据不丢失**。

### 2.3 前端部署

```bash
cd agent-cockpit/frontend

npm install    
npm run dev    
```

### 2.4 插件注册
插件部分如果修改需要重新编译

插件源码是 TypeScript，需要先用 Bun 编译为 JS 才能被 OpenCode 加载：

```bash
cd agent-cockpit/plugin
bun run build
# 输出：dist/index.js
```

修改插件源码后需重新编译。开发时可用 watch 模式自动重建：

```bash
bun run dev  
```

> 每次重新编译后需**重启 OpenCode**，插件在启动时加载，不支持热更新。

全局配置：

- Windows：`%USERPROFILE%\.config\opencode\opencode.json`（例如：`C:\Users\DELL\.config\opencode\opencode.json`）
- （补充）部分环境也可能在：`%APPDATA%\opencode\opencode.json`
- macOS / Linux：`~/.config/opencode/opencode.json`
没有的话自己新建
在$schema字段后添加plugin字段像这样
    "$schema": "https://opencode.ai/config.json",
    "plugin": [
        "D:/GitHub/test_opencode/agent-cockpit/plugin/dist/index.js"
    ],
> 
**路径写绝对路径**



**验证插件加载成功：**
启动 OpenCode 后，Flask 后端控制台应出现：

```
127.0.0.1 - - "POST /api/events/batch HTTP/1.1" 200 -
```

同时前端刷新后应看到 session 节点出现在 Agent Graph 中。

---
## 三、REST API（我捕获了哪些数据，学姐可以怎么获取） 

Base URL：`http://localhost:5000/api`

### Sessions

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sessions` | 所有 Session 列表 |
| GET | `/sessions/:id` | 单个 Session 详情 |
| GET | `/sessions/:id/messages` | Session 的消息列表（含 parts） |

### Agents

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/agents/hierarchy` | 父子层级列表 |
| GET | `/agents/status` | 所有 Agent 当前状态（轻量） |

### Tools

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tools/stats` | 全局工具调用统计（按工具聚合） |
| GET | `/tools/calls?sessionId=` | 工具调用记录，`sessionId` 可选过滤 |

### Todos / Skills / Metrics

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/todos` | 所有 Session 的 Todo 列表 |
| GET | `/todos/:sessionId` | 指定 Session 的 Todo |
| GET | `/skills?sessionId=` | Skill 记录，`sessionId` 可选过滤 |
| GET | `/metrics` | 汇总指标（总 Token、总费用、活跃 Session 数等） |

### 实时推送

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/events/stream` | SSE 长连接，订阅实时事件；连接时推送全量 `__snapshot__` |
| POST | `/events/batch` | 插件批量上报事件（内部使用） |

### 调试

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 存活检查 |
| GET | `/logs/raw?n=50` | 最近 N 条原始事件日志 |
| GET | `/logs/parsed?n=50` | 最近 N 条解析结果日志 |

---

### 返回数据结构说明

#### Session 对象

`GET /api/sessions` 返回 Session 数组，`GET /api/sessions/:id` 返回单个对象，结构如下：

```json
{
  "id": "ses_01abc...",          // Session 唯一 ID
  "agent": "general",            // Agent 类型：general / build / explore / plan / unknown
  "parentId": "ses_00xyz...",    // 父 Session ID，主 Agent 为 null
  "status": "idle",              // idle / busy / error
  "modelId": "claude-sonnet-4",  // 使用的模型
  "providerId": "anthropic",     // 模型提供商
  "systemPrompt": "You are...",  // 系统提示词（可能为 null，子 Agent 通常有）
  "title": "搜索游戏技能设计最佳实践",  // 任务标题，子 Agent 尤其有意义
  "directory": "D:/my-project",  // 项目目录
  "createdAt": 1741234567000,    // 创建时间戳（毫秒）
  "updatedAt": 1741234599000,
  "tokens": {
    "input": 12400,
    "output": 3200,
    "cacheRead": 8000            // 缓存命中节省的 token
  },
  "cost": 0.00421,               // 美元，累计费用
  "children": ["ses_02def..."]   // 该 Agent 生成的子 Agent ID 列表
}
```

#### Message 对象

`GET /api/sessions/:id/messages` 返回 Message 数组：

```json
{
  "id": "msg_01abc...",
  "sessionId": "ses_01abc...",
  "role": "assistant",           // user / assistant
  "agent": "general",
  "timestamp": 1741234570000,
  "tokens": { "input": 1200, "output": 800 },
  "cost": 0.00120,
  "isCompaction": false,         // true 表示这是上下文压缩记录
  "parts": [                     // 消息内容片段（见下方 Part 类型）
    {
      "type": "text",
      "content": "好的，我来帮你搜索..."
    },
    {
      "type": "tool",
      "toolName": "bash",
      "callId": "call_01...",
      "toolStatus": "completed", // pending / running / completed / error
      "toolInput": { "command": "grep -r ..." },
      "toolOutput": "找到 12 个结果..."
    },
    {
      "type": "reasoning",       // CoT 推理过程（部分模型）
      "content": "用户要搜索..."
    },
    {
      "type": "step-finish",     // 单步结束，携带 token 统计
      "tokenInput": 800,
      "tokenOutput": 200,
      "cost": 0.00060
    }
  ]
}
```

#### ToolCall 对象

`GET /api/tools/calls` 返回 ToolCall 数组：

```json
{
  "callId": "call_01abc...",
  "sessionId": "ses_01abc...",
  "tool": "bash",                // 工具名；含 __ 的为 MCP 工具
  "args": { "command": "ls -la" },
  "startedAt": 1741234570000,
  "endedAt": 1741234572500,
  "durationMs": 2500,
  "status": "completed",         // running / completed / error
  "title": "列出项目文件",
  "outputSnippet": "total 48\ndrwxr-xr-x...",  // 截断至 500 字符
  "isMcp": false,                // 是否为 MCP 工具调用
  "isSkill": false               // 是否为 Skill 调用
}
```

---

### 使用示例

#### 示例一：获取所有 Agent 的完整对话 Context

> 场景：研究不同类型 Agent 的上下文窗口内容，或对比主/子 Agent 的消息流。

```python
import requests

BASE = "http://localhost:5000/api"

# 第一步：获取所有 session，按 agent 类型分组
sessions = requests.get(f"{BASE}/sessions").json()

# 过滤出特定类型的 agent（如 explore 类型）
target_sessions = [s for s in sessions if s["agent"] == "explore"]

# 第二步：对每个 session 获取完整消息（含 parts）
for session in target_sessions:
    sid = session["id"]
    messages = requests.get(f"{BASE}/sessions/{sid}/messages").json()

    print(f"\n=== {session['title']} ({session['agent']}) ===")
    for msg in messages:
        role = msg["role"]
        # 拼接所有文本 parts
        text = " ".join(
            p["content"] for p in msg["parts"]
            if p["type"] == "text" and p.get("content")
        )
        print(f"[{role}] {text[:200]}")
```

#### 示例 2：获取父子 Agent 的任务分发与汇报

> 场景：查看主 Agent 分配了哪些子任务，以及各子 Agent 的结果。

```python
sessions_by_id = {s["id"]: s for s in requests.get(f"{BASE}/sessions").json()}

# 找到主 Agent（无 parentId 且有子 Agent 的）
root_sessions = [s for s in sessions_by_id.values()
                 if not s["parentId"] and s["children"]]

for root in root_sessions:
    print(f"\n主 Agent：{root['agent']} — {root['title']}")

    for child_id in root["children"]:
        child = sessions_by_id.get(child_id)
        if not child:
            continue

        # 子 Agent 第一条 user 消息 = 收到的任务指令
        child_msgs = requests.get(f"{BASE}/sessions/{child_id}/messages").json()
        task_msg = next((m for m in child_msgs if m["role"] == "user"), None)
        result_msg = next((m for m in reversed(child_msgs) if m["role"] == "assistant"), None)

        task_text = " ".join(p["content"] for p in (task_msg or {}).get("parts", [])
                             if p["type"] == "text" and p.get("content"))
        result_text = " ".join(p["content"] for p in (result_msg or {}).get("parts", [])
                               if p["type"] == "text" and p.get("content"))

        print(f"  └ 子 Agent [{child['agent']}] {child['title']}")
        print(f"    任务：{task_text[:150]}")
        print(f"    结果：{result_text[:150]}")
```

#### 示例 3：统计每个 Agent 的工具使用情况

> 场景：分析哪个 Agent 用了哪些工具、耗时多少、成功率如何。

```python
from collections import defaultdict

all_calls = requests.get(f"{BASE}/tools/calls").json()

# 按 sessionId 分组
calls_by_session = defaultdict(list)
for call in all_calls:
    calls_by_session[call["sessionId"]].append(call)

sessions_by_id = {s["id"]: s for s in requests.get(f"{BASE}/sessions").json()}

for sid, calls in calls_by_session.items():
    session = sessions_by_id.get(sid, {})
    completed = [c for c in calls if c["status"] == "completed"]
    avg_ms = sum(c["durationMs"] or 0 for c in completed) / len(completed) if completed else 0

    print(f"{session.get('agent','?')} | {session.get('title','')[:30]}")
    print(f"  工具调用：{len(calls)} 次，成功 {len(completed)} 次，平均耗时 {avg_ms:.0f}ms")

    # 按工具名汇总
    tool_count = defaultdict(int)
    for c in calls:
        tool_count[c["tool"]] += 1
    for tool, cnt in sorted(tool_count.items(), key=lambda x: -x[1]):
        mcp = " [MCP]" if "__" in tool else ""
        print(f"    {tool}{mcp}: {cnt} 次")
```



#### 示例 5：导出某个 Agent 的完整上下文为文本

> 场景：把一次 Agent 运行的完整过程导出成可读文档。

```python
def export_context(session_id: str) -> str:
    session = requests.get(f"{BASE}/sessions/{session_id}").json()
    messages = requests.get(f"{BASE}/sessions/{session_id}/messages").json()

    lines = [
        f"# Agent: {session['agent']} — {session['title']}",
        f"Model: {session['modelId']} ({session['providerId']})",
        f"Tokens: {session['tokens']['input']} in / {session['tokens']['output']} out",
        f"Cost: ${session['cost']:.5f}",
        "---",
    ]

    for msg in messages:
        lines.append(f"\n## [{msg['role'].upper()}]")
        for part in msg["parts"]:
            if part["type"] == "text" and part.get("content"):
                lines.append(part["content"])
            elif part["type"] == "tool":
                lines.append(f"> 工具调用：{part['toolName']} [{part['toolStatus']}]")
                if part.get("toolOutput"):
                    lines.append(f"> 输出：{part['toolOutput'][:300]}")
            elif part["type"] == "reasoning" and part.get("content"):
                lines.append(f"<推理> {part['content'][:200]}")

    return "\n".join(lines)

# 使用
sid = "ses_01abc..."
print(export_context(sid))
```

---

## 四、捕获数据说明（我是怎么获取，从opencode哪里获取的）

插件通过 OpenCode 的 Plugin Hook 系统运行在 **OpenCode 进程内部**，钩子定义见源码：
`opencode/packages/plugin/src/index.ts`（`Hooks` 接口）

### 3.1 事件型 Hook：`event`

**触发时机：** OpenCode 内部 Bus 系统广播任意事件时触发。
**源码位置：** `opencode/packages/opencode/src/bus/`

插件过滤并转发以下事件类型：

#### `session.created` / `session.updated`

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.info.id` | string | Session ID（UUID） |
| `properties.info.agent` | string | Agent 类型（general / build / explore / plan） |
| `properties.info.parentID` | string? | 父 Session ID（子智能体时存在） |
| `properties.info.title` | string | Session 标题（任务描述） |
| `properties.info.directory` | string | 项目目录路径 |
| `properties.info.time.created` | number | 创建时间戳（ms） |

> **注意：** `session.created` 时 `agent` 字段通常为空，真实 agent 类型最早在 `message.updated` 事件中通过 `info.agent` 字段获取，随后回写到 Session。

#### `session.deleted`

子智能体完成任务后 OpenCode 会发送此事件。插件将其记录为 `status: idle`（保留历史，不删除）。

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.info.id` | string | 被删除的 Session ID |
| `properties.info.title` | string | 最终标题 |

#### `session.status`

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.sessionID` | string | Session ID |
| `properties.status` | string \| `{type: string}` | 状态，**实际为对象格式** `{"type": "busy"}`，需解包 |

状态映射：`busy` → 运行中，`idle` / `completed` → 空闲，`error` → 出错，`retry` → 重试中（归为 busy）

#### `message.updated`

消息元数据更新（角色、token、费用、模型信息）。

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.info.id` | string | Message ID |
| `properties.info.sessionID` | string | 所属 Session |
| `properties.info.role` | `"user"` \| `"assistant"` | 消息角色 |
| `properties.info.agent` | string | Agent 类型（此处是最可靠的来源） |
| `properties.info.modelID` | string | 使用的模型 ID |
| `properties.info.providerID` | string | 模型提供商 ID |
| `properties.info.tokens.input` | number | 输入 Token 数 |
| `properties.info.tokens.output` | number | 输出 Token 数 |
| `properties.info.tokens.cache.read` | number | 缓存命中 Token 数 |
| `properties.info.cost` | number | 本条消息费用（美元） |

#### `message.part.updated`

消息内容片段实时更新（流式输出）。

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.part.messageID` | string | 所属 Message ID（**在 part 子对象内**，不在顶层） |
| `properties.part.sessionID` | string | 所属 Session ID（同上） |
| `properties.part.type` | string | 片段类型（见下表） |

Part 类型及对应字段：

| type | 关键字段 | 说明 |
|------|----------|------|
| `text` | `part.text` | 文本内容（流式追加） |
| `reasoning` | `part.text` | 推理过程（CoT） |
| `tool` | `part.tool`、`part.callID`、`part.state.status`、`part.state.input`、`part.state.output` | 工具调用，status: pending→running→completed/error |
| `step-finish` | `part.tokens`、`part.cost` | 单步结束，携带 token 统计 |
| `compaction` | — | 上下文压缩标记 |

#### `todo.updated`

| 字段路径 | 类型 | 说明 |
|----------|------|------|
| `properties.sessionID` | string | 所属 Session |
| `properties.todos[]` | array | Todo 列表（全量替换） |
| `properties.todos[].content` | string | 任务内容 |
| `properties.todos[].status` | `pending\|in_progress\|completed\|cancelled` | 状态 |
| `properties.todos[].priority` | `high\|medium\|low` | 优先级 |

---

### 3.2 工具执行 Hook：`tool.execute.before`

**触发时机：** 任意工具被调用前，同步执行。
**源码位置：** `opencode/packages/opencode/src/agent/agent.ts`（工具调用链路）

| 字段 | 类型 | 说明 |
|------|------|------|
| `input.tool` | string | 工具名称（如 `bash`、`read`、`skill`、`mcp__server__tool`） |
| `input.sessionID` | string | 所属 Session |
| `input.callID` | string | 本次调用唯一 ID |
| `output.args` | object | 工具入参（可被 hook 修改） |

**MCP 工具识别：** 工具名称含 `__` 的为 MCP 工具（如 `server__toolname`）。
**Skill 识别：** 工具名为 `skill` 时，`args.name` 即为技能名称。

---

### 3.3 工具执行 Hook：`tool.execute.after`

**触发时机：** 工具执行完成（成功或失败）后。

| 字段 | 类型 | 说明 |
|------|------|------|
| `input.tool` | string | 工具名称 |
| `input.sessionID` | string | 所属 Session |
| `input.callID` | string | 对应 before 的 callID |
| `input.args` | object | 实际使用的入参 |
| `output.title` | string | 工具执行标题（可读描述） |
| `output.output` | string | 工具输出（截断至 500 字符） |
| `output.metadata` | object | 元数据，含 `truncated: true` 表示输出被截断 |

**错误判断：** `output.metadata` 中含 `error` 字段时视为执行失败。

---

### 3.4 消息发送 Hook：`chat.message`

**触发时机：** 每次向 LLM 发送消息前。
**源码位置：** `opencode/packages/opencode/src/agent/agent.ts`

| 字段 | 类型 | 说明 |
|------|------|------|
| `input.sessionID` | string | 所属 Session |
| `input.agent` | string | Agent 类型 |
| `input.model.modelID` | string | 模型 ID |
| `input.model.providerID` | string | Provider ID |
| `input.messageID` | string | 本次消息 ID |
| `output.message.role` | string | 消息角色 |
<!-- | `output.message.system` | string? | 系统提示词（Anthropic 格式） | -->
| `output.parts` | array | 消息 Part 列表；`role=system` 时 text part 即为系统提示词 |



---


## 五、数据持久化

- **存储引擎：** SQLite（WAL 模式，读写并发安全）
- **数据库路径：** `backend/data/cockpit.db`
- **重启恢复：** 后端启动时自动从 SQLite 加载所有历史数据到内存，SSE 连接时推送全量快照（`__snapshot__`）

表结构简述：

| 表名 | 内容 |
|------|------|
| `sessions` | Session 元数据 |
| `messages` | 消息记录（含 parts JSON） |
| `tool_calls` | 工具调用记录 |
| `todos` | 每个 Session 的 Todo 列表（JSON blob） |
| `skills` | Skill 加载记录 |

---


## 六、目录结构参考

```
agent-cockpit/
├── plugin/
│   └── src/
│       └── index.ts          # OpenCode 插件主文件（运行在 OpenCode 进程内）
├── backend/
│   ├── app.py                # Flask 应用入口
│   ├── api/routes.py         # REST API 路由
│   ├── handlers/event_router.py  # 事件解析分发
│   ├── store/
│   │   ├── memory_store.py   # 内存存储层
│   │   └── persistent_store.py   # SQLite 持久化层
│   ├── models/types.py       # 数据模型定义
│   └── data/cockpit.db       # SQLite 数据库（自动创建）
└── frontend/
    └── src/
        ├── App.tsx            # 主布局（左：Agent Graph，右：三标签页）
        ├── store/cockpitStore.ts  # Zustand 全局状态
        ├── services/
        │   ├── api.ts         # REST API 调用
        │   └── socket.ts      # SSE 连接管理
        └── components/        # UI 组件
```
