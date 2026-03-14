# Agent Cockpit API 与数据结构

本文档聚焦三件事：

1. `store.loadSnapshot(msg.data)` 的真实结构（当前版本）
2. 当前可访问的 API 文档 URL（本地 Swagger 页面）
3. Overview 实时投影的前后端流程设计（后端计算布局）

---

## 1) 可直接打开的 API 文档 URL

后端启动后可直接访问：

- `http://localhost:5000/api/docs`（Swagger UI 页面）
- `http://localhost:5000/api/docs/openapi.yaml`（OpenAPI 原始文件）

---

## 2) SSE Snapshot：`loadSnapshot(msg.data)` 入参结构

前端在 `socket.ts` 里连接 `GET /api/events/stream`。  
首条消息 `type=__snapshot__`，会执行 `store.loadSnapshot(msg.data)`。

当前 `msg.data` 结构：

```json
{
  "sessions": [ { /* Session */ } ],
  "toolStats": [ { /* ToolStat */ } ],
  "todos": {
    "<sessionId>": [ { /* TodoItem */ } ]
  },
  "skills": [ { /* SkillRecord */ } ],
  "metrics": { /* Metrics */ }
}
```

> 注意：`usedAgents` 已删除，不再出现在 snapshot。

### 2.1 Session 关键字段（Overview 相关）

- `id`: session 唯一 ID
- `agent`: agent 类型（general/build/explore/plan/unknown，或其它字符串）
- `directory`: 所属目录（Overview 按目录分组）
- `createdAt`: 时间戳（可用于选“代表 session”）

### 2.2 前端 store 实际写入

`loadSnapshot` 映射关系：

- `snap.sessions` -> `store.sessions`（转为 `Record<id, Session>`）
- `snap.toolStats` -> `store.toolStats`
- `snap.todos` -> `store.todos`
- `snap.skills` -> `store.skills`
- `snap.metrics` -> `store.metrics`

---

## 3) 每个 session 怎么捕捉、怎么处理、怎么传前端（顺序）

1. **Plugin 捕捉 OpenCode 事件**  
   事件如：`session.created`、`session.updated`、`message.updated`、`message.part.updated`、`tool.execute.*` 等。

2. **Plugin 批量上报后端**  
   `POST /api/events/batch`，body：`{ events: [{ type, properties, timestamp }, ...] }`

3. **后端 dispatch 写入 store**  
   `dispatch(store, event)` 按事件类型更新：
   - session 数据 -> `store.sessions`
   - message / message parts -> `store.messages`
   - tool calls / todos / skills -> 对应 store

4. **后端 SSE 广播增量事件**  
   前端 `handleAgentEvent(type, data)` 做增量更新（status、tool call、todo 等）。

5. **前端连接时先收 snapshot**  
   `loadSnapshot(msg.data)` 先拿全量，再接增量。

> 结论：  
> - **存什么在 store**：由后端 event_router 的 handler 决定。  
> - **给前端什么**：通过 snapshot（全量）+ SSE 事件（增量）+ 按需 REST（详情查询）三种方式。

---

## 4) Overview 实时投影：推荐架构（后端算布局）

你的目标：
- 先拿当前有哪些 agent
- 用每个 agent 的第一条 user message 做初始化
- 上下文实时更新后，位置可能要动态调整
- 布局复杂逻辑放后端

### 4.1 前端职责（轻）

- 用 `store.sessions` 做目录与 agent 列表基础展示。
- 当选中某个 `directory` 时，请求后端投影接口拿 **已算好的坐标**。
- 只做渲染与交互（hover/click/filter），不做 embedding 和布局优化。

### 4.2 后端职责（重）

新增一个面向 Overview 的接口（建议）：

- `GET /api/overview/projection?directory=...&mode=init|realtime&embeddingMode=dashscope|mock`

后端处理步骤：

1. 获取该 `directory` 下所有 session
2. 按 agent 分组
3. 每个 agent 找“初始化锚点文本”：
   - 优先该 agent 第一条 `role=user` 的 text part
   - 没有则 fallback 到第一条 assistant text
4. 对锚点文本做 embedding，得到 agent 初始向量
5. 布局算法（MDS/t-SNE/force）算出 agent 级初始 `(x,y)`
6. 实时阶段可结合增量上下文（最近 N 条文本或摘要向量）更新向量和位置
7. 返回节点列表（每个 agent 一个节点，带可追溯字段）

建议返回结构：

```json
{
  "directory": "D:/projects/x",
  "layoutVersion": 1,
  "generatedAt": 1742000000000,
  "nodes": [
    {
      "agent": "general",
      "sessionId": "ses_xxx",
      "x": 0.31,
      "y": -0.52,
      "anchorMessageId": "msg_xxx",
      "anchorText": "...",
      "contextScore": 0.78,
      "messageCount": 42,
      "updatedAt": 1742000000000
    }
  ]
}
```

### 4.3 实时更新策略（两档）

- **档 A（先落地）**：前端每 3-5 秒轮询 `GET /api/overview/projection`，后端返回最新坐标。实现简单稳定。
- **档 B（进阶）**：后端在 `message.updated` 后重算增量并通过 SSE 推 `overview.projection.updated`，前端直接更新节点位置。

建议先做 **档 A**，验证布局质量后再升级到 SSE 增量推送。

---

## 5) 最小 snapshot 示例（当前真实）

```json
{
  "sessions": [
    {
      "id": "ses_01abc",
      "agent": "general",
      "parentId": null,
      "status": "idle",
      "modelId": "claude-sonnet-4",
      "providerId": "anthropic",
      "systemPrompt": null,
      "title": "My task",
      "directory": "D:/projects/my-app",
      "createdAt": 1742000000000,
      "updatedAt": 1742000100000,
      "tokens": { "input": 100, "output": 50, "cacheRead": 0 },
      "cost": 0.001,
      "children": []
    }
  ],
  "toolStats": [],
  "todos": {},
  "skills": [],
  "metrics": {
    "totalSessions": 1,
    "activeSessions": 0,
    "totalMessages": 0,
    "totalToolCalls": 0,
    "totalTokens": { "input": 100, "output": 50 },
    "totalCost": 0.001
  }
}
```
