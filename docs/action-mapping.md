# 12 类 Action 映射与可视化

本文说明 cockpit-ui 如何将 OpenCode 的 message parts 与 SSE 事件映射为 **12 种 `ActionType`**，如何估算 **耗时** 与 **token**，以及右侧 **Action 流（D3）** 的布局与开关含义。

---

## 一、12 类动作与数据来源

| # | ActionType | 来源 | 识别方式 |
|---|------------|------|----------|
| 1 | Think | 消息部件 | `part.type === 'reasoning'` |
| 2 | Clarify | 工具 | `tool` 归一化名为 `question` |
| 3 | Plan | 工具 | `todowrite` / `todoread`（与 `subtaskGrouping` 中 todo 别名一致） |
| 4 | Permission | SSE | `permission.asked`；**兼容** `permission.updated`（映射为同一 Permission 动作） |
| 5 | Subagent | 工具 | `task` / `subtask` / `subagent` / `agent` |
| 6 | Response | 消息部件 | `part.type === 'text'` |
| 7 | Read | 工具 | `glob` / `grep` / `read` |
| 8 | Write | 工具 | `write` / `edit` / `multiedit` / `patch` |
| 9 | Shell | 工具 | `bash` / `shell` |
| 10 | Search | 工具 | `websearch` / `webfetch` / `web_fetch` |
| 11 | Skill | 工具 | `skill` |
| 12 | Compaction | 部件 + SSE | `part.type === 'compaction'` **或** `session.compacted` |

未匹配到的 `tool` 名称不会生成动作（避免噪声）；若后续需要「其他」类，可在 `actionMapping.ts` 的 `mapToolToActionType` 中扩展。

---

## 二、OpenCode 源码侧：Permission 与 Compaction 如何拿到

以下路径基于 [anomalyco/opencode](https://github.com/anomalyco/opencode) 仓库的常见结构（`packages/opencode`）；具体文件名可能随版本微调，可在仓库内搜索符号确认。

### 2.1 Permission（`permission.asked`）

- 权限系统在新实现中通过 **`PermissionNext.ask()`** 走内部 Bus，发布 **`permission.asked`** 一类事件，供 UI / 插件订阅；**HTTP 消息列表**里通常**没有**独立「permission 部件」，因此 cockpit 侧 **必须** 从 **SSE（`/global/event` 或 `/event`）** 合并。
- 社区 issue 中可见：插件文档里的 `permission.ask` hook 与运行时 `permission.asked` 事件路径不完全一致，实际集成宜监听 **通用 `event` 流** 中的 `permission.*`（与本项目 `plugin/src/index.ts` 中 `permission.updated` / `permission.replied` 等并列观察）。
- 本 UI 在 `opencodeSse.ts` 中解析 `payload.type` / `sessionID` / 时间戳，将 **`permission.asked` 与 `permission.updated`** 统一成内部 **`permission.asked`** 再映射为 `ActionType: Permission`（状态默认 `pending`，黄色）。

### 2.2 Compaction（部件 + `session.compacted`）

- **REST 消息**：当会话触发上下文压缩时，序列化里可出现 **`type: "compaction"`** 的 part（与 `text` / `reasoning` 并列）。cockpit 已在 `types/opencode.ts` 中增加 `CompactionPart`，并在 `MessageBubble` 里简单渲染占位。
- **SSE**：压缩完成时常有 **`session.compacted`**（与本仓库插件 `RELEVANT_TYPES` 一致）。`actionMapping.ts` 将其映射为 `Compaction`，与部件二选一或并存；若同一会话两次出现，时间轴上会有两个块，属预期可观察行为。

---

## 三、字段：`durationMs` 与 `tokenEstimate`

实现位置：`utils/actionMapping.ts`。

- **`tokenEstimate`**：对可读文本（reasoning / text / tool 的 input+output JSON 字符串）做 **字符数 / 4** 取整，仅作可视化用粗估。
- **`durationMs`**：
  - **reasoning**：优先 `part.time.start` ~ `part.time.end`；否则按文本长度给上限内的估计。
  - **tool**：若 `state.status === 'running'` 为 `0`（宽度在 duration 模式下仍受下限约束）；否则尝试用 **整条 assistant 消息的 `info.time.created` ~ `completed`** 或按 I/O 长度估计。
  - **text**：随文本长度单调增加的上限内估计。

---

## 四、行号（Think/Response 第 1 行，子智能体内第 3 行）

规则：

- **第 0 行**：仅 `Think`、`Response`。
- **第 1 行**：其余类型在 **当前子智能体深度为 0** 时。
- **第 2 行**：其余类型在 **已进入子智能体工具**（`task` / `subtask` 等非终态使深度 +1，`completed` / `error` 使深度 −1）时。

若历史快照里只有 `task(completed)` 而无 `running` 中间态，深度栈可能无法还原，子行可能偏少；以流式实时会话为准更准确。

---

## 五、控制台调试

切换会话或消息刷新后，控制台输出：

```text
[ActionMapping] Array<{ actionType, status, durationMs, tokenEstimate, sortTime, source, row, ... }>
```

用于核对映射是否与预期一致。

---

## 六、D3 可视化说明（`ActionFlowVisualization.tsx`）

### 6.1 在 React 里用 D3 的常见写法

1. **`useRef<SVGSVGElement>`** 指向空 `<svg />`。
2. **`useLayoutEffect`**（或 `useEffect`）在 **依赖** `[actions, durationMode, colorMode]` 变化时：
   - `d3.select(svgRef.current).selectAll('*').remove()` 清空；
   - 用 **布局函数**算出每个块的 `x, y, width, height`；
   - `append('path')` 画折线箭头，`append('rect')` / `circle` 画块；
   - 设置 `viewBox` 与 `width`/`height` 以撑开横向滚动区域。

### 6.2 本图元素

- **起点**：左侧空方块；**终点**：黄色圆点（与参考图一致）。
- **等距**：在 **非 duration 模式** 下块宽固定 **28px**，`GAP` 固定；**左缘**由常量 `MARGIN_LEFT` 控制。
- **Duration 模式**：块宽随 `durationMs` 单调增加并有上下限，避免极端值。
- **颜色**：`status` 模式为绿/黄/红及 running 闪烁（CSS `.action-flow-running`）；`tokens` 模式用 **d3 连续色标**（`interpolateBlues`）按 `tokenEstimate` 着色。

### 6.3 建议阅读

- [D3 官方文档](https://d3js.org/) 中 *Selections*、*Shapes*、*Scales* 三章即可覆盖本组件用法。

---

## 七、相关文件

| 文件 | 作用 |
|------|------|
| `src/utils/actionMapping.ts` | 从 messages 构建动作 + 行号；SSE 动作合并 |
| `src/utils/opencodeSse.ts` | 从全局 SSE 解析 permission / compaction（若需与会话级流合并时使用） |
| `src/components/ActionFlowVisualization.tsx` | D3 SVG 绘制（`durationMode` / `colorMode` 由父组件传入） |
| `src/components/SubtaskCard.tsx` | **按子任务**取 `assistantMessageIndices` 对应消息，调用 `buildMappedActionsFromMessages` 后嵌入 Action 流 |
| `src/App.tsx` | `[AssistantSubtasks]` 调试输出中带每段的 `flowActions` |
| `src/types/opencode.ts` | `ActionType`、`MappedAction`、`CompactionPart` |

---

## 八、与 OpenCode 官方的关系

本面板为 **Agent Cockpit** 实验 UI，与 [OpenCode](https://github.com/anomalyco/opencode) 官方发布无隶属关系；事件与部件形态以你本机运行的 opencode 版本为准。
