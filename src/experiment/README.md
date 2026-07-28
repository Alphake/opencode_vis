# VibeTrace 用户实验埋点说明

本地用户实验用的交互计数与导出流程。数据写在**用户当前工作区文件夹根目录**，不写进本仓库。

---

## 1. 开始 → 结束流程

1. 左侧选好任务文件夹（例如某个 bug 修复目录）。
2. 左侧 **session 历史底部** Experiment 条：填被试号（如 `P01`）→ 点 **Start**（按 **workspace / 文件夹** 绑定）。
3. 同一文件夹内可开多个 session，都会继续记在同一次实验里。
4. 正常做任务（开 session、对话、滚面板、点 todo、看 tooltip、fork、distill…）。
5. 做完点 **End**；换到另一个 workspace 会自动保存当前实验，需在新文件夹再 **Start**。
6. 报告写入该文件夹根目录，文件名形如：

   ```text
   vibetrace-experiment-P01-20260728T024218Z.json
   ```

7. 让被试把这个 JSON 发回即可汇总。

**注意：**

- 换文件夹再 Start，会记到**新文件夹**根目录（以文件夹为单位）。
- 同一 workspace 内切换 / 新建多个 session **不会**中断实验。
- 刷新页面不会丢进行中的实验（`localStorage` 草稿）；点 **End**（或换 workspace 自动结束）才落盘并清空。
- 若 memory-worker 写盘失败，会自动下载 JSON 到浏览器下载目录（兜底）。
- 改过 worker 后需重启 `npm run worker:py`；Vite 代理了 `/experiment-report`。

---

## 2. 架构（怎么落盘）

```text
前端 experimentTelemetry.track(...)
  → 内存 + localStorage 草稿
  → End & Save
  → POST memory-worker /experiment-report
  → 写入 {workspaceDirectory}/vibetrace-experiment-*.json
```

| 模块 | 路径 |
|------|------|
| 类型与计数器定义 | `src/experiment/types.ts` |
| 埋点单例 | `src/experiment/telemetry.ts` |
| 开始/结束 UI | `src/experiment/ExperimentBar.tsx`（左侧 session 历史底部，workspace 级 Start / End） |
| Mock 样例 | `src/experiment/mockReport.example.json` |
| Worker 写盘 | `memory_worker/server.py` → `save_experiment_report` / `POST /experiment-report` |
| 前端 API | `src/services/memoryWorkerApi.ts` → `saveExperimentReport` |
| Vite 代理 | `vite.config.ts` → `/experiment-report` |
| 草稿 key | `STORAGE_KEYS.experimentActive`（`vibetrace.experiment.active.v1`） |

内部 OpenCode 会话（标题含 `[mw-internal]`）**不计入**手动 session。

---

## 3. 计数器字段（`counters`）

| 字段 | 含义 | 统计方式 |
|------|------|----------|
| `manualSessionsCreated` | 手动新建 session 次数 | 侧栏 New Session 成功；不含 mw-internal |
| `conversationTurns` | 对话轮次 | 用户每发出一条消息 +1（含 fork 后首条） |
| `chatPanelScrolls` | 中间对话区滚动次数 | `scroll` 去抖 400ms，一次拖动算 1 次 |
| `trajectoryPanelScrolls` | 右侧轨迹列表滚动次数 | 同上 |
| `trajectoryPanelClicks` | 右侧面板操作次数 | 点子任务卡、切 task tab、切 timeline/summary 等 |
| `todoClicks` | Todo 面板内点击总次数 | 点标题展开、分区折叠、任意 todo 行，**面板内任何可点内容** |
| `actionTooltipShows` | Action tooltip 真正亮起次数 | `react-tooltip` 的 `afterShow`（timeline 节点 + summary 色块） |
| `flowEndSummaryTooltipShows` | 轨迹末端黄色 Summary 节点 tooltip | 悬浮 flow-end 节点且真正弹出 |
| `trajectoriesViewed` | **查看过**几个 panel（去重） | 选中 / 滚入视野 / **鼠标扫过 tooltip 锚点**，按 subtask id **去重**（不必等 tooltip 弹出） |
| `taskTabsSeen` | 出现过几个 Task tab | 实验期间 task tab id **去重** |
| `skillsDistilled` | 沉淀 skill 次数 | Distill **成功**回包后 +1 |
| `forksCompleted` | Fork 次数 | fork API 成功后 +1 |
| `skillPanelClicks` | Skill Panel 点击次数 | 打开某个 skill 详情 |
| `subtaskPanelsGenerated` | **生成了**多少 panel / trace | 实验期间观察到的 subtask id **去重** |
| `chatPanelFocusMs` | 鼠标在中间栏停留总毫秒 | `pointerenter` / `pointerleave` 累计 |
| `trajectoryPanelFocusMs` | 鼠标在右侧栏停留总毫秒 | 同上 |

### 派生字段（`derived`）

由 counters 自动计算，便于直接写进实验分析：

| 字段 | 含义 |
|------|------|
| `chatFocusRatio` | 中间栏焦点时间 / (中间+右侧) |
| `trajectoryFocusRatio` | 右侧栏焦点时间占比 |
| `chatScrollShare` | 中间滚动次数 / 总滚动次数 |
| `trajectoryInteractionShare` | 右侧相关操作 / (左侧操作+右侧操作) 的粗占比 |
| `firstInteractionOrder` | 各区域按「首次交互」时间排序（未碰过的区域不出现） |
| `firstInteractionMs` | 各区域首次交互相对 `startedAt` 的毫秒；未碰为 `null` |
| `panelViewCoverage` | `trajectoriesViewed / subtaskPanelsGenerated`（看了几个 / 生成了几个） |

焦点/滚动拿不到「绝对真实注意力」，只是可复现的代理指标；论文里建议写明定义。

**Panel 覆盖率**：对比 `subtaskPanelsGenerated`（生成数）与 `trajectoriesViewed`（查看数，去重）。也可直接看 `derived.panelViewCoverage`。

### 首次交互（`firstInteractionAt`）

每个区域只记**第一次**点击 / 滚动 / 发消息的 ISO 时间；未使用则为 `null`。用来还原「先摸哪块 UI」的顺序（也可用 `derived.firstInteractionOrder`）。

| 区域 | 触发（任一即可，只取最早） |
|------|---------------------------|
| `chat` | 对话区滚动、发送消息 |
| `trajectory` | 右侧轨迹滚动 / 点击 / 看子任务 / tooltip / 切 task tab |
| `todo` | Todo 面板内任意点击（标题 / 分区 / todo 行） |
| `skill` | Skill Panel 打开详情、或 Distill 成功 |

事件日志里会多一条 `region.first`（`props.region` + `props.via`），之后同区域不再记。

---

## 4. 事件明细（`events[]`）

每条大致为：

```json
{
  "ts": "2026-07-28T02:15:22.440Z",
  "event": "todo.click",
  "sessionId": "ses_...",
  "directory": "/path/to/workspace",
  "props": { "todoId": "..." }
}
```

常见 `event` 名：

- `experiment.start` / `experiment.end`
- `session.create`
- `chat.turn` / `chat.scroll`
- `trajectory.scroll` / `trajectory.click` / `trajectory.view`
- `todo.panel_click`
- `panel.view`（某 panel 首次被查看，含 `via`：select / scroll / tooltip.* / card）
- `tooltip.action` / `tooltip.flow_end_summary`
- `task_tab.seen` / `task_tab.select`
- `skill.distill` / `skill.panel_click`
- `fork.complete`
- `subtask.generated`
- `panel.focus`
- `region.first`（某区域首次交互，仅一次）

事件日志有上限（约 2000 条），超出丢最旧的；汇总分析优先看 `counters` + `firstInteractionAt` + `derived`。

---

## 5. 报告顶层字段

| 字段 | 说明 |
|------|------|
| `schemaVersion` | 固定 `experiment.report.v1` |
| `participantId` | 被试号 |
| `experimentId` | 本次实验唯一 id |
| `directory` | 写入时的工作区路径 |
| `startedAt` / `endedAt` | ISO 时间 |
| `durationMs` | 实验时长 |
| `sessionIds` | 实验期间碰到过的 session id 列表 |
| `counters` / `firstInteractionAt` / `derived` / `events` | 见上 |
| `notes` | 可选备注 |

完整 Mock 见：`src/experiment/mockReport.example.json`。

---

## 6. 挂钩位置（改代码时查这里）

| 行为 | 大致挂钩点 |
|------|------------|
| Start / End UI | `src/experiment/ExperimentBar.tsx`，挂在 `Sidebar` session 列表底部 |
| 新建 session | `App.tsx` → `handleCreateSession` |
| 发消息 / 对话轮 | `App.tsx` → `handleSendMessage`（及 fork 后首条） |
| Todo 点击 | `App.tsx` → `handleTodoClick` |
| 子任务卡 / 轨迹查看 | `App.tsx` → `toggleSubtaskLink` |
| Task tab | `App.tsx` → `handleSelectTaskSegment` + tabs 出现时 `onTaskTabSeen` |
| 子面板生成 | `App.tsx` → `assistantSubtasks` 变化时 `onSubtasksObserved` |
| Fork | `App.tsx` → fork 成功后 `onForkComplete` |
| 中间滚动 | `MessagePanel.tsx` → message list `onScroll` |
| 右侧滚动 | `SubtaskDebugPanel.tsx` → list `onScroll` |
| Action / flow-end tooltip | `ActionFlowVisualization.tsx` → Tooltip `afterShow` |
| Summary 色块 tooltip | `SubtaskDebugPanel.tsx` → summary Tooltip `afterShow` |
| Skill 打开 / Distill | `SubtaskDebugPanel.tsx` → `openSkillDetail` / distill `.then` |
| 左右焦点时间 | `App.tsx` → 中间栏 / 右栏 `onPointerEnter` / `Leave` |

---

## 7. 给被试的一句话指引

> 选好任务文件夹 → 左侧 session 列表底部填编号点 Start → 同文件夹可开多个 session → 点 End（换文件夹会自动保存并需重新 Start）→ 把该文件夹根目录里的 `vibetrace-experiment-*.json` 发给我们。

---

## 8. 已知边界

- Tooltip 按「真正弹出」计，不是每次 mouseenter。
- 滚动按去抖后的「滚动爆发」计，不是原生 scroll 事件次数。
- 「对话轮次」≈ 用户发送次数，不是严格的 user+assistant 配对完成数。
- 焦点时间依赖鼠标进出面板，切换窗口/看别处但鼠标还在面板上时会偏高。
- `firstInteractionAt` 不计纯悬停（`panel.focus`），只计点击 / 滚动 / 发消息；鼠标滑过不算「首次交互」。
- 不默认记录 prompt / 代码全文，只记 id 与计数（隐私友好）。
