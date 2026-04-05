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

*记录用途：避免重复讨论「为什么现在是这样」；排期时从此列表拆任务。*
