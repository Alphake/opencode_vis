# 延期处理事项（已知限制）

> 以下问题**暂不改造**，但长期存在；后续若排期再处理。更新时请改本文档并同步相关代码注释（如有）。

---

## 1. 消息列表不依赖 SSE 推送正文

**现状：** 完整对话内容以 **`GET /session/:id/message`** 为准。`GET /global/event` 仅作「有动静再拉一次」的触发器，收到 `message*` / `session*` 类事件后仍会 **整表拉取 REST**，而不是从 SSE payload 里拼消息。

**影响：** 流量与延迟略高于「真流式/增量 SSE」方案；逻辑简单、与 OpenCode 文档「正文以 message API 为准」一致。

**后续方向（若做）：** 评估是否消费更细粒度 SSE 做增量合并、或与 `prompt_async` 等异步 API 配合，需再对齐 OpenCode 版本与契约。

---

## 2. 模型选择与配置未接入 Cockpit UI

**现状：** **本应用不配置、也不展示模型下拉框。** 对话使用的模型由 **本机 OpenCode 服务** 决定（例如全局/项目 `opencode.json` 的 `model`、`agent.*.model`，以及 TUI `/models`、`/connect` 等），与 cockpit-ui 仓库无关。

**影响：** 用户须在 OpenCode 侧改默认模型；无法在 Agent Cockpit 页面内切换。

**后续方向（若做）：** 调用 OpenCode `GET /config`、`GET /provider` 或等价接口，在 UI 中展示并 `PATCH /config`（或官方支持的模型切换方式）；需处理多目录、`x-opencode-directory` 与权限。

---

## 3. Packing View 入口已下线（保留代码逻辑）

**记录日期：** 2026-04-20

**现状：** 右侧「子任务分组（调试）」头部不再展示两个入口按钮（展开 Overview / 全屏 Packing View），避免继续暴露该交互。

**保留说明：** 仅下线入口，**底层逻辑与组件仍保留**，请勿轻易删除或重写，后续若要恢复入口可直接复用。

**代码位置（请优先在这些位置检索与评估）：**
- `src/App.tsx`：`subtaskPanelExpanded` / `subtaskFullscreenOpen` 状态、`SubtaskDebugPanel` 的 `leadingTreemapSize` 注入、`FullscreenSubtaskPanel` 渲染挂载。
- `src/components/SubtaskDebugPanel.tsx`：packing 布局下子任务列表与联动透传。
- `src/components/SubtaskCard.tsx`：`leadingTreemapSize` 触发左侧 treemap + ActionFlow 联动。
- `src/components/FullscreenSubtaskPanel.tsx`：全屏 packing view 对话层主体实现。
- `src/components/SubtaskActionTypeTreemap.tsx`：action type treemap 可视化与选中联动。

---

*记录用途：避免重复讨论「为什么现在是这样」；排期时从此列表拆任务。*
