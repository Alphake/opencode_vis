# Cockpit UI：数据流、布局与「中右联动」设计说明

> 面向汇报：说明当前 **左栏 / 中间消息 / 右侧子任务** 的数据从哪来、如何组织与更新、页面如何排版；并单独说明 **中间与右侧联动** 的推荐实现思路（当前代码尚未实现联动，仅架构上完全可做）。

---

## 一、总体架构

- **单一数据源入口**：本地 OpenCode HTTP 服务（默认 `http://127.0.0.1:4096`）。
- **状态提升**：会话列表、当前会话 ID、消息列表、Todo 列表、以及用于子任务切分的快照，都集中在根组件 **`App.tsx`** 的 React `useState` / `useMemo` / `useEffect` 中。
- **向下传递**：通过 props 把数据喂给左栏 `Sidebar`、中间 `MessagePanel`、右侧 `SubtaskDebugPanel`（内部再渲染多个 `SubtaskCard`）。

```
OpenCode API (REST + SSE)
        ↓
     App.tsx  （状态与派生数据）
   ↙    ↓    ↘
Sidebar  MessagePanel  SubtaskDebugPanel → SubtaskCard(s)
```

---

## 二、数据获取方式

### 2.1 REST（`src/services/opencodeApi.ts`）

| 方法 | HTTP | 用途 |
|------|------|------|
| `getSessions()` | `GET /session` | 拉取全部会话，供左侧列表 |
| `getTodos(sessionId)` | `GET /session/:id/todo` | 当前会话的 Todo 列表 |
| `getMessages(sessionId)` | `GET /session/:id/message` | 当前会话的**完整消息时间线**（有序数组） |
| `sendMessage(sessionId, text)` | `POST /session/:id/message` | 用户发送一条用户消息 |

### 2.2 SSE（实时刷新）

- 使用 **`EventSource` 订阅 `GET /global/event`**（`subscribeGlobalEvents`）。
- 收到事件后解析 `payload.type`（或顶层 `type`）：
  - 若以 `message` 或 `session` 开头 → 对**当前选中的 `selectedSessionId`** 再调一次 `getMessages`，用返回结果 **整体替换** `messages`。
  - 若以 `todo` 开头 → 再调 `getTodos`，替换 `todos`。
- 说明：全局流可能包含多个 workspace / session；当前实现是「收到相关事件就刷新**当前选中会话**的消息/Todo」，更精细的按 `directory` / `sessionID` 过滤可在后续加强。

### 2.3 首次进入与切换会话

- **挂载**：`getSessions()` → 默认选中 `time.updated` 最新的一条会话的 `id`。
- **`selectedSessionId` 变化**：`loadSessionData` 并行 `getMessages` + `getTodos`，写入 `messages` / `todos`；并清空 `todosSnapshotAtMessageIndex`（见下节）。

---

## 三、核心数据结构（TypeScript）

定义集中在 **`src/types/opencode.ts`**（节选语义）。

### 3.1 `OcSession`（左侧一条会话）

- 含 `id`、`title`、`directory`、`time.created/updated`、摘要等。
- 左侧按 **`directory`** 分组展示；选中项由 **`selectedSessionId`** 标识。

### 3.2 `OcMessage`（中间一条消息）

- 结构：`{ info: OcMessageInfo, parts: OcMessagePart[] }`。
- **`info`**：`role`（`user` | `assistant`）、`id`、`sessionID`、`time`、`tokens`、`model`、`agent` 等。
- **`parts`**：该条消息内的多段内容（`text`、`reasoning`、`tool`、`compaction` 等），顺序即服务端给出的顺序。

中间列表 **直接使用 `messages: OcMessage[]`**，下标 `idx` 与全局时间线一致。

### 3.3 `OcTodo`

- 字段：`content`、`status`（pending / in_progress / completed）、`priority` 等；来自 `GET .../todo`。

### 3.4 `AssistantSubtask`（右侧一个「子任务段」）

- 定义在 **`src/utils/subtaskGrouping.ts`**，由纯函数 **`groupAssistantSubtasks(messages, options)`** 从同一份 `messages` **派生**，不单独请求接口。
- 字段要点：
  - **`assistantMessageIndices: number[]`**：本段包含的 **assistant 消息在 `messages` 数组中的下标**（有序、连续段逻辑由分组算法保证）。
  - **`todos`**：该段结束时的 Todo 快照（用于卡片展示）。
  - **`todosNewlyCompleted`**：若本段因「Todo 新完成」而切段，则非空。
  - **`subtask_id`**：稳定字符串键，供 React `key` 使用。

**重要结论**：右侧每个子任务卡片 **不拥有另一份消息副本**，而是通过 **`assistantMessageIndices`** 指向中间同一条 `messages` 时间线中的若干条 **assistant** 消息；**user 消息不参与进段下标**，但仍会出现在中间列表中（例如在两段 assistant 之间）。

---

## 四、数据组织与派生逻辑

### 4.1 子任务分组（右侧数据源）

- **`assistantSubtasks = useMemo(() => groupAssistantSubtasks(...), [messages, todosSnapshotAtMessageIndex, todos])`**。
- 分组规则（简化）：按时间顺序扫 `messages`，以 **user 消息** 切段；在 assistant 段内根据 **todowrite 快照变化**、**step-finish + stop** 等规则 flush 为多个 `AssistantSubtask`（详见 `docs/subtask-grouping.md`）。
- **`todosSnapshotAtMessageIndex`**：为解决「历史 todowrite 时刻的 Todo 列表」与当前 `todos` 不一致，对「最后一条 todowrite 所在下标」记录一份 `todos` 快照，供 `todosAfterMessageIndex` 回调使用，从而 **重放 completed diff**。

### 4.2 右侧卡片内的 Action 流

- **`SubtaskCard`** 内：`segmentMessages = assistantMessageIndices.map(i => messages[i])`，再 **`buildMappedActionsFromMessages(segmentMessages)`** 得到本子任务内的动作序列与行号，交给 **`ActionFlowVisualization`** 绘制。

### 4.3 调试输出

- 控制台 **`[AssistantSubtasks]`**：每个子任务的 `assistantMessageIndices`、摘要及 **`flowActions`**，用于核对映射。

---

## 五、更新逻辑小结

| 触发条件 | 行为 |
|----------|------|
| 应用首次加载 | `getSessions` → 选最新 session → `loadSessionData` |
| 用户点击左侧会话 | `setSelectedSessionId` → `loadSessionData` + 清空 todo 快照 map |
| SSE：`message*` / `session*` | `getMessages(selectedSessionId)` → `setMessages` |
| SSE：`todo*` | `getTodos(selectedSessionId)` → `setTodos` |
| 用户发送消息 | `sendMessage` → `getMessages` → `setMessages` |
| `messages` / `todos` / 快照变化 | 重算 `assistantSubtasks`；必要时更新快照 effect |

---

## 六、页面布局（如何呈现）

### 6.1 根布局（`App.tsx`）

- 最外层：`display: flex`、`height: 100vh`、`width: 100vw`、`overflow: hidden`，背景 `#F8F8F8`。
- **左**：`Sidebar` 展开宽约 **240px**（收起为窄条），`flexShrink: 0`。
- **中**：`flex: 1`、`minWidth: 0`，内部再包一层 **`maxWidth: 640px`** 的列，使对话区不要过宽。
- **右**：固定宽 **520px**、`flexShrink: 0`，白底 + 左边框，列内：**顶栏标题** + **可滚动内容区**（`SubtaskDebugPanel`）。

### 6.2 中间 `MessagePanel`

- 列方向 flex：`Header`（会话标题）→ **可滚动消息区**（`flex: 1` + `overflowY: auto`）→ 可选 **`TodoPanel`**（有 todos 时）→ **`MessageInput`**。
- 消息列表：`messages.map((msg, idx) => <MessageBubble key={msg.info.id} ... />)`，**顺序与数组下标一致**。

### 6.3 右侧 `SubtaskDebugPanel` / `SubtaskCard`

- 外层 `flex: 1`、`overflowY: auto`，多个 **`SubtaskCard`** 纵向排列。
- 单卡：固定视觉高度（如 ~380px）、标题、Action 开关、D3 流、底部指标条等（详见 `docs/subtask-card-fields.md`）。

---

## 七、中间与右侧联动（规划说明，尚未实现）

需求理解：点击 **右侧某一子任务卡片** 时，**中间消息列表**里属于该段的 **assistant 消息**（即 `assistantMessageIndices` 对应那些项）被 **高亮**（描边/背景/「点亮」），并有一种 **与子任务卡片之间的连线感**。

### 7.1 是否可做

**可以。** 关联键已经存在：**全局消息下标 `idx`** 与 **`AssistantSubtask.assistantMessageIndices`**，二者指向同一份 `messages`。

### 7.2 推荐状态设计

- 在 **`App.tsx`** 增加状态，例如：`selectedSubtaskIndex: number | null` 或 `selectedSubtaskId: string | null`（与 `st.subtask_id` 对应）。
- **`SubtaskCard`（或卡片容器）** `onClick` → 调用 `onSelectSubtask(si)` 更新选中项；再次点击可取消选中。

### 7.3 中间高亮如何接

- 给 **`MessagePanel`** 传入：
  - `highlightIndices: Set<number>` 或 `highlightRange: { start: number; end: number }`（由当前选中子任务的 `assistantMessageIndices` 计算）。
  - 或传入 `getMessageHighlight(idx): 'none' | 'subtask-selected'`。
- **`MessageBubble`** 外包一层 `div`，根据是否高亮增加 **border / box-shadow / 背景色**；仅对 **`messages[idx].info.role === 'assistant'` 且 idx 在 indices 内** 高亮（若希望 user 也框选，可把规则扩展为「从段首 user 到段末 assistant」的连续区间，需产品定义）。

### 7.4 滚动到可视区域

- 选中子任务后，对 **该段第一条（或全部）消息** 对应 DOM 节点 **`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`**。
- 实现方式：`MessageBubble` 上挂 `ref`（或 `data-message-index={idx}` + `querySelector`），在 `useEffect` 依赖 `selectedSubtask` 时触发。

### 7.5 「连线感」的常见实现（由易到难）

1. **仅视觉关联（无真连线）**  
   - 中间高亮块与右侧卡片 **同一主题色描边**（如共用 `actionFlowPalette.green.stroke`），用户感知为「成对」。

2. **伪连线（CSS）**  
   - 右侧卡片左侧加一条竖线或斜向 `border`，中间消息右侧加短横线，**不计算几何**，靠对齐和颜色统一暗示连接。

3. **真连线（SVG 覆盖层）**  
   - 在 **中间+右侧的父容器** 上使用 `position: relative`，上层绝对定位 **透明 SVG**；选中时用 `getBoundingClientRect()` 取 **右侧卡片左缘中点** 与 **中间某条消息右缘中点**，画 **二次贝塞尔或折线**；`resize` / `scroll` 时重算（中间消息区 scroll 要监听）。

4. **Portal + 线**  
   - 与 3 类似，线画在 `document.body` 下固定层，避免被 `overflow: hidden` 裁剪，坐标同样用 `getBoundingClientRect` 换算。

汇报时可概括为：**数据层已具备一一对应关系；UI 层增加「选中子任务 ID + 高亮下标集合 + 可选 SVG 连线」即可，工作量主要在布局坐标与滚动重绘。**

---

## 八、相关文件索引

| 模块 | 路径 |
|------|------|
| 根状态与布局 | `src/App.tsx` |
| API | `src/services/opencodeApi.ts` |
| 类型 | `src/types/opencode.ts` |
| 子任务分组 | `src/utils/subtaskGrouping.ts`、`docs/subtask-grouping.md` |
| 左侧栏 | `src/components/Sidebar.tsx` |
| 中间消息 | `src/components/MessagePanel.tsx`、`MessageBubble.tsx` |
| 右侧子任务 | `src/components/SubtaskDebugPanel.tsx`、`SubtaskCard.tsx` |
| Action 流 | `src/utils/actionMapping.ts`、`ActionFlowVisualization.tsx`、`docs/action-mapping.md` |

---

## 九、Figma / 汇报一句话

**「三栏共享同一会话的 `messages` 数组；右侧子任务是对该数组下标的分段视图；实时更新靠 SSE 触发重新拉取消息；联动只需在 App 层记录选中的子任务并把其 `assistantMessageIndices` 传给中间列表做高亮与滚动。」**
