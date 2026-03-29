# Assistant 子任务（Subtask）划分规则与实现说明

本文档描述 cockpit-ui 中如何根据会话 `messages` 将 **assistant** 消息划分为子任务（`AssistantSubtask`），以及对应代码位置与数据流。规则会随产品迭代调整，**以 `src/utils/subtaskGrouping.ts` 内注释与实现为准**。

---

## 1. 概念与约束

- **子任务（subtask）**：一组 **连续** 的 assistant **message 下标**（全局 `messages` 数组索引）。用于右侧面板可视化、与 todo 进展对齐等。
- **最小单位是整条 message**：同一条 `OcMessage` **不会**被拆进两个 subtask；一条 message 内若同时存在 todowrite 与 step-finish，**先处理 todowrite 相关逻辑，再处理 step-finish**。
- **仅 role === `assistant`** 会进入累积缓冲区 `currentIndices`；`user` 会触发强制切段（见下）。

---

## 2. 业务规则（切段条件）

按时间顺序扫描 `messages`。在 **本条 assistant** 上，可能触发 **多种** 切段；满足下列 **任一** 即可能产生新的 `AssistantSubtask`（具体顺序见第 3 节）。

### 规则 A：首次出现有效 todo 列表（「第一次生成 todo」）

- 条件：此前 **从未** 成功建立过 todowrite 快照（实现里为 `lastTodowriteSnapshot === null`），且本条 todowrite 解析出 **非空** 的 todo 列表。
- 行为：若当前缓冲里 **除本条外** 还有更早的 assistant，则先把 **本条之前** 的下标 **flush** 为一段独立 subtask（表示「尚无列表 / 规划检索」阶段）；再把缓冲 **只保留本条**，继续后续规则。
- 该段 **`todosNewlyCompleted` 为空**（不是由「新 completed」驱动的切段）。

### 规则 B：相对上一快照出现「非 completed → completed」

- 条件：本条含 **todowrite**，且解析出的列表 `next` 与 **上一快照** `lastTodowriteSnapshot` 按 **`content` 主键** 对齐后，存在条目：**上一快照中该 content 的 `status` 不是 `completed`，本快照中为 `completed`**（`pending` / `in_progress` → `completed` 均算）。
- 行为：**flush** 当前缓冲（含本条）；该 subtask 的 **`todosNewlyCompleted`** 即为这些 **新变为 completed** 的项；子任务语义上对应「本段完成了这些 todo」。
- 若仅有其它状态变化（无上述 transition），**不切段**，只 **更新** `lastTodowriteSnapshot`。

### 规则 C：`step-finish` 且 `reason === "stop"`

- 条件：本条 assistant 的 `parts` 中存在 `type === "step-finish"` 且 `reason === "stop"`（表示 Agent 本步回复终止）。
- 行为：在本条 **跑完 todowrite 分支之后**，若缓冲仍非空，则 **flush** 一段；**`todosNewlyCompleted` 为空**。

### 规则 D：`user` 或消息列表结束（EOF）

- 条件：遇到 **user** message，或遍历结束后缓冲仍非空。
- 行为：**flush** 当前缓冲；**`todosNewlyCompleted` 为空**。

---

## 3. 单条 assistant 上的执行顺序（实现约定）

对每条 assistant，顺序为：

1. `currentIndices.push(i)`。
2. 若含 **todowrite**：解析 `next` → 可能执行 **规则 A**（先 flush pre）→ 再算 **规则 B**（可能 completion flush）→ 只要 `next` 非空则 **更新** `lastTodowriteSnapshot`。
3. 若含 **step-finish(stop)** 且 `currentIndices` 仍非空：**规则 C**（`flushForced`）。

这样保证同一条 message 内逻辑顺序固定，且不会在「已因 completion 清空缓冲」后对同一条再误 flush。

---

## 4. 数据结构

### `AssistantSubtask`（`subtaskGrouping.ts`）

| 字段 | 含义 |
|------|------|
| `subtask_id` | 稳定可读 id，通常基于段内首条 message 的 `info.id` 与末下标 |
| `todos` | 本段 **结束时刻** 的 todo 列表快照（优先来自本条 todowrite 的解析） |
| `todosNewlyCompleted` | **仅规则 B** 切段时非空；规则 A/C/D 切段时为空 |
| `assistantMessageIndices` | 属于本子任务的全局 message 下标列表 |

### Todo 快照从哪里来（段末 `todos`）

解析优先级（`resolveSnapshotForSegment`）：

1. 本条 message 上 **todowrite** 的 `parseTodowriteTodosFromMessage`：`state.input.todos` → `state.metadata.todos` → `state.output` JSON 数组。
2. 否则调用可选的 **`todosAfterMessageIndex(i)`**（例如 App 里按 message 下标缓存的会话 todo）。
3. 再否则沿用 **`lastTodowriteSnapshot`**。
4. 再否则使用 **`fallbackSessionTodos`**（一般为当前 `getTodos` 结果）。

条目字段与 `OcTodo` 对齐：`content`、`status`（`pending` \| `in_progress` \| `completed`）、`priority`。

### 工具名

`todowrite`、`todo_write`、`write_todos`、`update_todos` 及包含 `todo_write` / `_todowrite` 后缀的变体视为 todo 写入工具（`isTodoWriteTool`）。

---

## 5. 代码如何实现

### 5.1 入口

- **`groupAssistantSubtasks(messages, options?)`**  
  - 路径：`cockpit-ui/src/utils/subtaskGrouping.ts`  
  - 返回 `AssistantSubtask[]`。  
  - `options.todosAfterMessageIndex`：按 message 下标提供会话 todo 兜底。  
  - `options.fallbackSessionTodos`：通常为 App 中 `getTodos` 的当前列表。

### 5.2 状态变量

- **`currentIndices`**：当前未切段 assistant 下标缓冲。  
- **`lastTodowriteSnapshot`**：上一次从 todowrite 解析并提交的快照，供 **规则 B** diff 与后续兜底。

### 5.3 核心函数分工

| 函数 | 作用 |
|------|------|
| `isTodoWriteMessage` / `isTodoWriteTool` | 判断是否含 todo 写入 tool |
| `parseTodowriteTodosFromMessage` / `parseTodowriteTodosFromToolPart` | 从 part 拉取 todo 数组并规范化为 `OcTodo[]` |
| `diffTodosNewlyCompleted(prev, next)` | 规则 B：按 content 找 **非 completed → completed** |
| `messageHasAgentStepFinishStop` | 规则 C：是否存在 `step-finish` + `reason === "stop"` |
| `pushForcedSubtask(indices)` | 规则 A 的 pre 段、规则 C、规则 D：push 一段且 `todosNewlyCompleted: []`，必要时更新 `lastTodowriteSnapshot`（若段末 message 含 todowrite 且解析非空） |
| `flushForced` | 将 `currentIndices` 整段交给 `pushForcedSubtask` |
| `buildSubtaskId` | 生成 `subtask_id` |

主循环伪代码：

```
for each message in order:
  if user -> flushForced(); continue
  if not assistant -> continue
  push i to currentIndices
  if todowrite:
    next = resolveSnapshot(i, msg)
    if first list ever and len(currentIndices)>1 -> pushForcedSubtask(pre), currentIndices = [i]
    if next non-empty:
      newly = diff(lastTodowriteSnapshot, next)
      if newly non-empty -> push completion subtask, clear currentIndices
      lastTodowriteSnapshot = next
  if step-finish(stop) and currentIndices non-empty -> flushForced()
end
flushForced()  // EOF
```

### 5.4 UI 与调试

- **`App.tsx`**：`useMemo` 调用 `groupAssistantSubtasks`，并向 **`SubtaskDebugPanel`** 传入结果；`useEffect` 中 `console.log('[AssistantSubtasks]', …)`。
- **`SubtaskDebugPanel.tsx`**：只读展示各段 `todos` / `todosNewlyCompleted` 与 message 摘要。

---

## 6. 已知限制与后续可做

- 若 todowrite 未带可解析的 `input`/`metadata`/`output`，快照依赖 **resolver / fallback**，与工具内真实列表可能短暂不一致。  
- **规则 B** 依赖「上一快照」；首条有效列表之前无快照，**不会出现**「新 completed」diff。  
- 同一条 message **不能**拆成两个 subtask；若产品需要更细粒度，需协议层支持（例如 part 级事件）。

---

## 7. 相关文件一览

| 文件 | 说明 |
|------|------|
| `src/utils/subtaskGrouping.ts` | 规则与分组实现 |
| `src/types/opencode.ts` | `OcMessage`、`ToolPart`、`OcTodo`、`step-finish` 等类型 |
| `src/App.tsx` | 分组调用、todo 快照 map、控制台输出 |
| `src/components/SubtaskDebugPanel.tsx` | 右侧调试展示 |
| `docs/subtask-card-fields.md` | 子任务卡片各字段含义与计算方式 |
