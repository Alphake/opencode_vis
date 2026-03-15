# Overview 调用链与缓存说明

本文档把「Plugin → 后端 → 前端」的整条链路、谁调谁、缓存何时命中/失效说清楚，方便排查「命中缓存出问题」或「新 session/新消息不更新」等情况。

---

## 一、总览：两条入口

| 入口 | 谁触发 | 后端做什么 | 前端谁响应 |
|-----|--------|-------------|------------|
| **Init（全量）** | 前端切 directory / 点刷新 | `GET /api/overview/projection/init` → 算 agent + 全部 message 的 x,y，写 state，返回 | OverviewPanel 的 `useEffect([effectiveDirectory, refreshTrigger])` 调 API，写 `agentNodes` / `messageNodes` / `OVERVIEW_INIT_CACHE` |
| **Incremental（增量）** | Plugin 推送 message 更新 | `POST /api/events/batch` 里检测到 `message.updated` / `message.part.updated` → 调 `compute_overview_incremental()` → 若有多出的 message 则 SSE 推 `overview.incremental` | Store 收 SSE 写 `overviewIncrementalEvent`，OverviewPanel 的 `useEffect([overviewIncrementalEvent])` 把 `addedMessageNodes` 追到本地 `messageNodes` |

Init 决定「当前 directory 下有哪些 agent、哪些 message、坐标是多少」；Incremental 只负责「新多出来的 message 点」追加，不新增 agent，不重算已有点的坐标。

---

## 二、新开一个 Session 时（Plugin → 后端 → 前端）

### 2.1 Plugin 发什么

- Plugin 把事件发给后端：**`POST /api/events/batch`**，body 形如 `{ "events": [ { "type": "session.created", "info": { "id", "agent", "directory", ... } } ] }`。
- 新开 session 时通常会有 **`session.created`**（或 `session.updated`），不会因为「开 session」就发 `message.updated`。

### 2.2 后端收到后做了什么

- **文件**：`backend/app.py`，`receive_events()`（约 211 行起）。
- 对每个 event 调用 **`dispatch(store, event)`**（`handlers/event_router.py`）。
- `session.created` → **`handle_session_created()`**：把 session 写入 store，返回 `{ "action": "session.created", "sessionId", "session" }`。
- 然后 **`_broadcast({ type: event.type, data: result })`**，把同一条结果推给所有 SSE 客户端（前端）。
- **重要**：这里**没有**调 `compute_overview_incremental()`，也没有调 init。Overview 的增量只会在 **`message.updated` / `message.part.updated`** 时触发（见下一节）。

### 2.3 前端收到后怎样

- 前端连的是 **`GET /api/events/stream`**（SSE），在 **`frontend/src/services/socket.ts`** 里 `EventSource` 收消息，解析后调 **`store.handleAgentEvent(msg.type, msg.data)`**。
- `session.created` / `session.updated` 时：**`cockpitStore.ts`** 里走 `case "session.created"` / `"session.updated"`，执行 **`state.upsertSession(d.session)`**，即更新 `sessions`。
- **没有任何地方**在 session 创建/更新时调 overview init 或清 Overview 缓存，所以：
  - 左侧 session 列表会更新（因为 `sessions` 变了）。
  - **Overview 图不会自动重算**；要看到「新 session 对应的新 agent 大点」，需要**点一次「刷新」**或**切走再切回该 directory**（并保证没命中前端缓存，见下）。

### 2.4 为何会「看起来只有一个 agent」或数据旧

- **后端**：init 的缓存是「按 directory 的 state」：`knownMessageIds == current_ids` 且 `cacheReady` 才命中；新 session 带来新 messageId，`current_ids` 会变，所以**后端**一般不会在「新 session 已进 store」之后还给你旧 init 结果。
- **前端**：Overview 结果还缓存在 **`OVERVIEW_INIT_CACHE.get(effectiveDirectory)`**。只要你不点「刷新」、不触发 `refreshTrigger`，下次进该 directory 时还会用这份缓存，**不会**再请求 init，所以图上仍是旧的 agent/message 数量。
- 结论：**新开 session 后，若想 Overview 立刻出现新 agent，需要在前端点「刷新」**（或我们可以在检测到「当前 directory 的 session 数变多」时自动清缓存并触发一次 init，见文末实现建议）。

---

## 三、Session 里新增一条对话（Message）时

### 3.1 Plugin 发什么

- 仍然通过 **`POST /api/events/batch`** 推送事件。
- 新增一条 message（或 part 更新）时会有 **`message.updated`** 或 **`message.part.updated`**。

### 3.2 后端收到后做了什么

- 同上，**`dispatch(store, event)`**：
  - **`message.updated`** → `handle_message_updated()`：把整条 message 写入 store，返回 `{ "action": "message.updated", "messageId", "sessionId" }`。
  - **`message.part.updated`** → `handle_message_part_updated()`：更新 part，返回 `{ "action": "message.part.updated", "messageId", "sessionId", "partType" }`。
- 然后 **`_broadcast({ type, data: result })`**，前端先收到这条「消息已更新」的 SSE。
- 紧接着（仍在 `receive_events()` 里）：  
  **若 `result.action` 为 `message.updated` 或 `message.part.updated`**，则取该 session 的 `directory`，调 **`compute_overview_incremental(directory)`**（`api/routes.py` 的 `compute_overview_incremental`）：
  - 用 `_overview_states()[norm_dir]` 里的 `landmarks`、`agentCenters`、`knownMessageIds`；
  - 找出该 directory 下**尚未在 knownMessageIds 里**的、有 layout_text 的 message，做 embedding，再用 **`place_point_by_landmarks()`** 算 x,y；
  - 把这些新节点 append 到 `state["messageNodes"]`，更新 `knownMessageIds`；
  - 返回 `{ directory, addedMessageNodes, debug }`。
- 若 **`inc_status == 200` 且 `addedMessageNodes` 非空**，再 **`_broadcast({ type: "overview.incremental", data: inc_payload })`**，即再推一条 SSE 给前端。

### 3.3 前端收到后怎样

- **第一条 SSE**（`message.updated` / `message.part.updated`）：  
  `handleAgentEvent()` 里对 `message.updated` 会执行 **`overviewTick++`**（仅用于可选抖动防重），**不会**把这条 message 写入 Overview 的节点列表；Overview 的「新点」完全来自第二条 SSE。
- **第二条 SSE**（`overview.incremental`）：  
  `handleAgentEvent("overview.incremental", data)` 时，把 **`data.addedMessageNodes`** 写成 store 的 **`overviewIncrementalEvent`**：
  - `overviewIncrementalEvent = { directory, nodes: addedMessageNodes, at }`。
- **OverviewPanel** 里 **`useEffect([overviewIncrementalEvent, effectiveDirectory])`**：
  - 若当前 `effectiveDirectory` 与事件里的 `directory` 一致，且已 init 过（`initializedRef.current`），则把 `overviewIncrementalEvent.nodes` 里尚未在 `messageNodeMapRef` 里的节点**追加**到本地 state 的 **`messageNodes`**，并同步进 **`OVERVIEW_INIT_CACHE`**（方便下次进同一 directory 仍能看到这些点）。

所以：**新增对话 → Plugin 发 message.updated → 后端算 incremental 并推 overview.incremental → 前端只根据 overview.incremental 追加新点**。整条链用到的接口和函数就是上面这些。

---

## 四、Init 的调用关系与缓存（前端何时调、后端何时命中）

### 4.1 前端何时调 Init

- **唯一调用点**：**`OverviewPanel`** 的 **`useEffect(() => { ... }, [effectiveDirectory, refreshTrigger])`**（约 127–220 行）。
- 当 **`effectiveDirectory`** 有值（左侧选的 workspace 或默认第一个 directory）且**未命中前端缓存**时，会调 **`api.overview.projectionInit(effectiveDirectory, { ..., clearCache: skipCache })`**；**`skipCache === (refreshTrigger > 0)`**，即只有点了「刷新」才带 `clearCache: true`。

### 4.2 前端缓存（OVERVIEW_INIT_CACHE）

- **位置**：`OverviewPanel.tsx` 里模块级 **`OVERVIEW_INIT_CACHE`**（Map，key = directory 字符串）。
- **写入**：init 请求成功后，用 **`OVERVIEW_INIT_CACHE.set(effectiveDirectory, { agentNodes, messageNodes, agentEdges })`**。
- **读取**：同一 `useEffect` 里，若 **未** `skipCache`，则 **`cached = OVERVIEW_INIT_CACHE.get(effectiveDirectory)`**；若存在则直接用 cached 设 `setAgentNodes` / `setMessageNodes` / `setAgentEdges`，**不再请求后端**。
- **失效**：  
  - 点「刷新」时会 **`OVERVIEW_INIT_CACHE.delete(effectiveDirectory)`** 并 `refreshTrigger++`，下次 effect 就会带 `clearCache: true` 请求后端。  
  - 若**不点刷新**，新 session 出现后，前端不会自动清该 directory 的缓存，所以会一直用旧数据直到你点刷新或我们加上「当前 directory session 数变化时清缓存」（见下）。

### 4.3 后端缓存（state = _overview_states()[norm_dir]）

- **位置**：**`api/routes.py`** 里 **`_overview_states()`**（Flask app config 的 `OVERVIEW_STATES`），key 为 **`norm_dir`**（规范化后的 directory）。
- **写入**：只有在 **init 全量计算** 结束时（未命中后端缓存的那次请求）会 **`_overview_states()[norm_dir] = { directory, landmarks, agentCenters, knownMessageIds, agentNodes, messageNodes, agentEdges, cacheReady, ... }`**；**incremental** 只在该 state 上 **append messageNodes 并更新 knownMessageIds**，不重算全量。
- **命中条件**：  
  **`not clear_cache and state.get("cacheReady") and known_ids == current_ids and ...`**  
  - `current_ids`：当前该 directory 下所有「有 layout_text 的 message」的 messageId 集合（本次请求时从 store 现算）；  
  - `known_ids`：state 里存的 **`knownMessageIds`**（上次 init 或 incremental 更新后的集合）。  
  两者相等才认为「没有新 message」，直接 **`return jsonify(cached_resp)`**，cached_resp 来自 **`state.get("agentNodes/messageNodes/agentEdges")`**。
- **失效**：  
  - 请求里带 **`clearCache=true`** 时，会先 **`_overview_states().pop(norm_dir)`**，再按正常逻辑重算并写回 state。  
  - 若**没有** clearCache，但 **新 session / 新 message 已进 store**，则 **`current_ids` 会大于或不同于 `known_ids`**，后端**不会**命中缓存，会重新跑全量 init 并更新 state。

因此：**后端**的「命中缓存」只看 messageId 集合是否变化；**前端**的「命中缓存」只看是否点刷新或是否做了「session 数变化时清缓存」（目前未做，建议做）。

---

## 五、一张表：事件 ↔ 接口/函数 ↔ 前端字段

| 事件 / 操作 | 后端接口/函数 | 前端 Store 字段 / 组件状态 |
|-------------|----------------|----------------------------|
| Plugin 推送 `session.created` / `session.updated` | `POST /api/events/batch` → `dispatch` → `handle_session_*` → `_broadcast(type, data)` | `sessions` 更新（`upsertSession`） |
| Plugin 推送 `message.updated` / `message.part.updated` | 同上 → `handle_message_*` → `_broadcast`；再 **`compute_overview_incremental(directory)`** → 若有新点则 **`_broadcast("overview.incremental", inc_payload)`** | 先 `overviewTick++`；收到 `overview.incremental` 后 **`overviewIncrementalEvent = { directory, nodes: addedMessageNodes, at }`** |
| 用户切 directory / 点刷新 | **`GET /api/overview/projection/init?directory=...&clearCache=...`** → `get_overview_projection_init()` → 可能命中后端缓存返回 state，否则全量算完写 state 再返回 | **`effectiveDirectory` / `refreshTrigger`** 变化 → effect 调 init；结果写 **`agentNodes` / `messageNodes` / `agentEdges`** 和 **`OVERVIEW_INIT_CACHE`** |
| 收到 `overview.incremental` | （上表已写：由 batch 里 message 事件触发） | **`overviewIncrementalEvent`** 更新 → OverviewPanel 的 effect 把 **`nodes`**（即 addedMessageNodes）追到 **`messageNodes`** 并同步到 **`OVERVIEW_INIT_CACHE`** |

---

## 六、新 Session 时自动清前端缓存并重拉 Init（已实现）

在 **OverviewPanel** 中已做：

- 用 **`sessionCountInDirectory`**（当前 `effectiveDirectory` 下 session 数量，directory 统一用 `/` 比较）和 **`prevSessionCountRef`** 记录上次数量。
- **`useEffect([effectiveDirectory, sessionCountInDirectory])`**：当 **`sessionCountInDirectory > prevSessionCountRef.current`** 且不是首次挂载（prev > 0）时：
  - **`OVERVIEW_INIT_CACHE.delete(effectiveDirectory)`**；
  - **`setRefreshTrigger(t => t + 1)`**，触发 init 的 effect，带 **`clearCache: true`** 重新请求，Overview 会显示新 agent。

---

以上即「谁调谁、用什么接口、做什么计算、推什么、前端哪个字段会更新」的完整说明；按此可以逐环节排查「命中缓存」或「新 session/新消息不更新」的问题。
