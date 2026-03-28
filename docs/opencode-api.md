# OpenCode API 文档

## 基础信息

- **Base URL**: `http://127.0.0.1:4096`
- **前提条件**: 必须运行 `opencode serve`（Server 模式）
- **数据格式**: JSON

---

## REST API

### 1. 获取 Session 列表

```
GET /session
```

**响应示例**:
```json
[
  {
    "id": "ses_xxxxx",
    "slug": "project-name",
    "directory": "D:/path/to/project",
    "title": "Session Title",
    "version": "1.2.27",
    "time": {
      "created": 1743187200000,
      "updated": 1743187500000
    }
  }
]
```

---

### 2. 获取 Session 的 Todos

```
GET /session/:sessionId/todo
```

**响应示例**:
```json
[
  {
    "content": "Task 1",
    "status": "completed",
    "priority": "high"
  },
  {
    "content": "Task 2",
    "status": "pending",
    "priority": "medium"
  }
]
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| content | string | 任务描述 |
| status | "pending" \| "in_progress" \| "completed" | 任务状态 |
| priority | "high" \| "medium" \| "low" | 优先级 |

---

### 3. 获取 Session 的消息

```
GET /session/:sessionId/message
```

**响应示例**:
```json
[
  {
    "info": {
      "id": "msg_xxxxx",
      "role": "user",
      "time": {
        "created": 1743187200000
      },
      "sessionID": "ses_xxxxx"
    },
    "parts": [
      {
        "type": "text",
        "text": "Hello world",
        "id": "part_xxxxx",
        "sessionID": "ses_xxxxx",
        "messageID": "msg_xxxxx"
      }
    ]
  },
  {
    "info": {
      "id": "msg_yyyyy",
      "role": "assistant",
      "time": {
        "created": 1743187201000,
        "completed": 1743187205000
      },
      "agent": "agent-name",
      "model": {
        "providerID": "openai",
        "modelID": "gpt-4"
      },
      "tokens": {
        "total": 1500,
        "input": 500,
        "output": 1000,
        "reasoning": 200
      },
      "finish": "stop",
      "sessionID": "ses_xxxxx"
    },
    "parts": [
      {
        "type": "text",
        "text": "I'll help you with that.",
        "id": "part_yyyyy1",
        "sessionID": "ses_xxxxx",
        "messageID": "msg_yyyyy"
      },
      {
        "type": "reasoning",
        "text": "Let me think about this...",
        "time": { "start": 1743187201000, "end": 1743187202000 },
        "id": "part_yyyyy2",
        "sessionID": "ses_xxxxx",
        "messageID": "msg_yyyyy"
      },
      {
        "type": "tool",
        "callID": "call_xxxxx",
        "tool": "read_file",
        "state": {
          "status": "completed",
          "input": { "path": "test.js" },
          "output": "file content..."
        },
        "id": "part_yyyyy3",
        "sessionID": "ses_xxxxx",
        "messageID": "msg_yyyyy"
      }
    ]
  }
]
```

**字段说明**:

#### OcMessageInfo
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 消息 ID |
| role | "user" \| "assistant" | 消息角色 |
| time.created | number | 创建时间戳 |
| time.completed | number | 完成时间戳（仅 assistant） |
| agent | string | Agent 名称（仅 assistant） |
| model | object | 模型信息（仅 assistant） |
| model.providerID | string | 模型提供商 |
| model.modelID | string | 模型 ID |
| tokens | object | Token 统计（仅 assistant） |
| tokens.total | number | 总 token 数 |
| tokens.input | number | 输入 token |
| tokens.output | number | 输出 token |
| tokens.reasoning | number | 思考 token |
| finish | string | 结束原因（仅 assistant） |
| sessionID | string | Session ID |

#### Part 类型
| type | 说明 | 关键字段 |
|------|------|----------|
| text | 文本内容 | text: string |
| reasoning | 思考过程 | text: string, time: {start, end} |
| tool | 工具调用 | tool: string, callID: string, state: {status, input, output} |
| step-start | 步骤开始标记 | - |
| step-end | 步骤结束标记 | - |
| image | 图片 | source: {type, media_type, data} |

---

### 4. 发送消息

```
POST /session/:sessionId/message
Content-Type: application/json
```

**请求体**:
```json
{
  "parts": [
    {
      "type": "text",
      "text": "Hello"
    }
  ]
}
```

**响应**: 空（成功时）

---

### 5. 获取 Diff

```
GET /session/:sessionId/diff
```

**响应**: 文件变更列表

---

## SSE (Server-Sent Events)

### 全局事件流

```
GET /global/event
```

**事件格式**:
```json
{
  "directory": "D:/path/to/project",
  "payload": {
    "type": "server.connected" | "message.created" | "todo.updated" | ...",
    "properties": { ... }
  }
}
```

**事件类型**:
| type | 说明 |
|------|------|
| server.connected | Server 连接成功 |
| message.created | 新消息创建 |
| message.updated | 消息更新 |
| todo.created | 新任务创建 |
| todo.updated | 任务更新 |
| session.updated | Session 更新 |

---

## 启动方式

```bash
# Terminal A: 启动 OpenCode Server
opencode serve

# Terminal B: 启动前端
cd cockpit-ui && npm run dev
```

---

## 注意事项

1. **必须运行 `opencode serve`**：普通 `opencode` 命令不会启动 4096 端口的 Server
2. **没有 `/session/:id/event` 端点**：这个路径会 fallthrough 到 OpenCode 云端代理
3. **正确的事件端点**：`/global/event` 或 `/event`
