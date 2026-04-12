# Message / Part 字段与 Tooltip 内容映射（对照 OpenCode 源码）

> 本文档回答三件事：**(1) 协议里有哪些原始字段（完整枚举）**；**(2) OpenCode 在桌面端 / Web 分享页如何展示各类 Part（折叠行 vs 展开区）**；**(3) 对 cockpit-ui 的 Tooltip 建议从哪些字段取「短摘要」**。
>
> **依据来源（仓库内克隆路径）**：`d:\projects\cockpit-ui\.opencode-src\`，对应上游 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的 `dev` 分支（浅克隆日期以本机为准）。

---

## 1. 会话消息的顶层结构（你提供的 JSON）

一次「助手轮次」通常包含：

- **外层 `message`（AssistantMessage）**：描述这一轮助手消息是谁发的、用的什么模型、耗时、token 等。
- **`parts[]`（Part 数组）**：按时间顺序排列的片段；**每个元素是一个 `Part` 联合类型**，用 `type` 区分。

`AssistantMessage` 的字段定义见：

- **依据**：`.opencode-src/packages/sdk/js/src/v2/gen/types.gen.ts` → `export type AssistantMessage`（约 L567–607）

主要字段包括：`id`, `sessionID`, `role: "assistant"`, `time.created` / `time.completed`, `parentID`, `modelID`, `providerID`, `mode`, `agent`, `path.cwd` / `path.root`, `cost`, `tokens`（`input` / `output` / `reasoning` / `cache`）, `error?`, `finish?` 等。

---

## 2. Part 联合类型：「完整」列表（协议层）

OpenCode SDK v2 生成的 TypeScript 中，`Part` 定义为若干子类型的并集：

- **依据**：`.opencode-src/packages/sdk/js/src/v2/gen/types.gen.ts` → `export type Part`（约 L875–887）

包含：

| `type` 值 | TypeScript 类型名 | 说明 |
|-----------|-------------------|------|
| `text` | `TextPart` | 助手或用户的可见文本 |
| `subtask` | `SubtaskPart` | 子任务相关 |
| `reasoning` | `ReasoningPart` | 模型「思考 / 推理」文本（若提供商支持） |
| `file` | `FilePart` | 用户附件等 |
| `tool` | `ToolPart` | 工具调用（`tool` 字段为工具名，如 `read` / `glob` / `bash`） |
| `step-start` | `StepStartPart` | 一步推理/工具回合的开始标记 |
| `step-finish` | `StepFinishPart` | 一步结束，带 `reason`、`tokens`、`cost` |
| `snapshot` | `SnapshotPart` | 快照 |
| `patch` | `PatchPart` | 补丁 |
| `agent` | `AgentPart` | Agent 相关 |
| `retry` | `RetryPart` | 重试 |
| `compaction` | `CompactionPart` | 上下文压缩标记 |

各 Part 的字段见同文件：`TextPart`（约 L627+）、`ReasoningPart`（约 L659+）、`ToolPart`（约 L783+）、`StepStartPart` / `StepFinishPart`（约 L796+）等。

---

## 3. Tool Part：`state` 与 `metadata`（工具层「完整」形态）

`ToolPart`：

- **依据**：`.opencode-src/packages/sdk/js/src/v2/gen/types.gen.ts` → `export type ToolPart`（约 L783–794）

字段：`id`, `sessionID`, `messageID`, `type: "tool"`, `callID`, `tool`（字符串，工具名）, `state: ToolState`, 以及可选的顶层 `metadata`。

`ToolState` 为 discriminated union，按 `status` 区分：

- **依据**：同文件 `ToolStatePending` / `ToolStateRunning` / `ToolStateCompleted` / `ToolStateError`（约 L726–779）

要点：

- **`completed`**：`input`（对象）, `output`（字符串）, `title`, `metadata`（对象）, `time`, 可选 `attachments`。
- **`running`**：可有 `title`, `metadata`, `time.start`。
- **`error`**：`error` 字符串等。

因此：**不同 `tool` 名的「语义字段」主要在 `state.input` 与 `state.metadata` 里**，而不是统一键名；UI 层按工具名分支解析（见下节）。

---

## 4. OpenCode 如何展示（桌面 / App UI：`packages/ui`）

### 4.1 统一入口：`PART_MAPPING` + `ToolRegistry`

- **依据**：`.opencode-src/packages/ui/src/components/message-part.tsx`
  - `PART_MAPPING["tool"]` → `ToolPartDisplay`（约 L1302–1379）：根据 `part.tool` 取 `ToolRegistry.render(tool)`，把 **`input` / `metadata` / `output` / `status`** 传给具体工具组件。
  - `PART_MAPPING["text"]` / `["reasoning"]` 等同文件（约 L1401+ / L1513+）。
  - 各内置工具通过 `ToolRegistry.register({ name: "read" | "glob" | "bash" | ... })` 注册（同文件后部，如 read 约 L1531+）。

### 4.2 折叠行 vs 完整 I/O：`BasicTool` + `Collapsible`

- **依据**：`.opencode-src/packages/ui/src/components/basic-tool.tsx`

行为摘要：

- **默认折叠**：`open` 默认为 `false`（约 L45–47），即 **先展示 trigger（标题行）**，用户再展开看子内容。
- **进行中**：`pending()` 时 **禁止展开**（`handleOpenChange` 里 `if (pending()) return`，约 L121–124）。
- **`hideDetails`**：为 `true` 时 **不展示展开箭头**，且子内容区域按条件隐藏（约 L192–194、以及后续 `Collapsible` 部分，需结合全文）——例如 `webfetch` 的注册里使用了 `hideDetails`（`message-part.tsx` 约 L1653+）。

**结论（可借鉴点）**：OpenCode **并不是在列表里默认铺满 tool 的完整 input/output**，而是：

- **折叠行（trigger）**：用 **本地化标题 + 一行 subtitle（路径/命令摘要）+ 少量 args 标签**；
- **展开区**：才显示 `output` 的 Markdown、diff、终端输出等。

这与你在 cockpit 里做「Tooltip = 折叠行信息量、详情面板 = 展开区」是对齐的。

---

## 5. OpenCode Web 分享页：`packages/web` 中的「处理后字段」

分享页对每个 `tool` 有独立小组件，**优先用 `metadata` 与短字段**，而不是把原始 `output` 整块顶在标题上。

- **依据**：`.opencode-src/packages/web/src/components/share/part.tsx`

示例（与 Tooltip 设计直接相关）：

| 工具 | 展示的「标题行」逻辑 | 展开区 |
|------|----------------------|--------|
| **read** | `ReadTool`：`tool-title` 为 `Read` + `target` = 相对 `cwd` 的路径（`stripWorkingDirectory`）；`title` 属性用完整 `filePath`（约 L513–524） | 优先 `metadata.preview` 作为代码预览；否则退回 `output` 文本（约 L530–538） |
| **glob** | `GlobTool`：标题 `Glob` + `target` = **引号包裹的 `input.pattern`**（约 L629–631） | 若有 `metadata.count > 0`，按钮文案用 `formatCount` 显示 **匹配数量**，展开为 `output` 列表文本（约 L633–645） |
| **bash** | `BashTool`：交给 `ContentBash`，传入 `command`、`metadata.output`/`stdout`、`metadata.description`（约 L614–620） | 具体渲染在 `ContentBash` |

**reasoning（分享页）**：

- **依据**：同文件约 L155–169  
- 结构：`tool-title` 显示本地化「思考」标题 + `ResultsButton` **默认折叠**，内部才是完整 Markdown。

**glob 在干什么（语义）**：在工程内按 **glob pattern**（如 `**/*`）**枚举匹配文件路径**；**匹配个数**来自服务端写入的 **`state.metadata.count`**（你的样例里为 `8`），列表正文在 `state.output`（多行路径）。

---

## 6. 核心速查：有多少种 Part / Tool，字段是什么，Tooltip 取什么、怎么得到

本节是你实现 **action 流 Tooltip** 时直接对照的表：**类型数量 → 每类原始字段 → 与 OpenCode 桌面折叠行对齐的取法 → Tooltip 上展示的「键 → 值」**。

**通用约定（所有 `type === "tool"`）**

- 协议里每条工具调用都有 **`state.title`**：一般是 **服务端生成的人类可读一行**，和桌面「折叠行主标题/副标题」高度重合，**应作为 Tooltip 的第一候选**（再按需用 `input` / `metadata` 补全或覆盖）。
- 第二候选：**`state.status`**（pending / running / completed / error）。
- 长正文几乎总在 **`state.output`**：Tooltip **默认不展示全文**，只给「摘要行 + 详见左栏/展开」。
- **依据**：`ToolState*` 与 `ToolPart` — `.opencode-src/packages/sdk/js/src/v2/gen/types.gen.ts`。

### 6.1 Part 类型（message part 的 `type`）有多少种？

SDK v2 中 **`Part` 联合类型共 12 种**（数 `type` 字面量）：

`text` · `subtask` · `reasoning` · `file` · `tool` · `step-start` · `step-finish` · `snapshot` · `patch` · `agent` · `retry` · `compaction`

- **依据**：`.opencode-src/packages/sdk/js/src/v2/gen/types.gen.ts` → `export type Part`

**非 `tool` 的 Part：Tooltip 建议只放「类型标签 + 极短摘要」**（全文在对话区）。

| `part.type` | 关键字段（含义） | Tooltip 展示什么 | 怎么得到 |
|-------------|------------------|------------------|----------|
| `text` | `text`：可见 Markdown/纯文 | **不写长文**。一行：`文本` + 前 **80～120 字符**截断，或仅 `字符数` | `stripMarkdown` 可选；`text.slice(0,120)` |
| `reasoning` | `text`：链式思考 | `推理` + 同上截断或 `约 N 字` | `text.length`；截断同上 |
| `file` | `filename`, `mime`, `url` | `附件` + `filename` | 直接用 `filename` |
| `step-start` | 常与父 `AssistantMessage` 一起用 | `一步开始` + `providerID` · `modelID` | 父 message 字段 |
| `step-finish` | `reason`, `tokens`, `cost` | `结束` + `reason`；可选一行 token | `reason`；`tokens.total` 等 |
| `subtask` | `prompt`, `description`, `agent` | `子任务` + `description` 截断 | 优先 `description` |
| `snapshot` / `patch` / `agent` / `retry` / `compaction` | 各类型自有字段 | 固定短标签 + 1 个标识字段 | 见 `types.gen.ts` 对应类型 |

### 6.2 Tool 类型（`part.tool` 字符串）有多少种？

OpenCode **桌面 UI** 在 `ToolRegistry.register({ name: "..." })` 里 **显式实现** 的**内置工具名**（当前 `dev` 分支）共 **16 个**：

`read` · `list` · `glob` · `grep` · `webfetch` · `websearch` · `codesearch` · `task` · `bash` · `edit` · `write` · `apply_patch` · `todowrite` · `question` · `skill` ·（另有 `GenericTool` 兜底未注册名）

- **依据**：`.opencode-src/packages/ui/src/components/message-part.tsx` 中全部 `ToolRegistry.register` 的 `name` 字段（约 L1531–2326）

**说明**：实际会话里还可能出现 **MCP / 插件** 等 **未在上表注册** 的 `tool` 字符串，此时桌面走 **通用工具**；Tooltip 仍可用 **`state.title` + `state.status`**。

### 6.3 每种 Tool：字段含义 + 与桌面折叠行对应 + Tooltip 行怎么填

下表 **「桌面折叠行怎么来的」** 指 `message-part.tsx` 里各 `ToolRegistry.register` 传给 `BasicTool` 的 `trigger`（title / subtitle / args）。

| `tool` | 你应关心的字段（completed 时） | 桌面折叠行大致是什么 | Tooltip 建议（主行 → 副行） | 取值 / 提取规则 |
|--------|----------------------------------|----------------------|-----------------------------|-------------------|
| **read** | `input.filePath`；`metadata.preview`；`metadata.loaded[]`；`title` | 图标「Read」+ 副标题 **文件名**（`getFilename(filePath)`） | `读取` + **basename(`title` 或 `input.filePath`)** → 若有 `loaded.length`：`+N 个附加` | 主名：`title` 常为完整路径，与 read 一致；附加文件数：`metadata.loaded?.length` |
| **write** | `input.filePath`, `input.content`；`metadata.filepath`；`metadata.diagnostics`；`title`；`output` | 「写入」+ **文件名**（`getFilename(filePath)`） | `写入` + **basename(`title` 或 `input.filePath` 或 `metadata.filepath`)** → `output` 一句如成功可省略或显示「已完成」 | 你提供的样例：`title` / `metadata.filepath` 均为目标路径；**不要**在 Tooltip 塞 `input.content` |
| **edit** | `input.filePath`；`metadata.filediff` / diff 信息 | 「编辑」+ **文件名** | `编辑` + basename → 若有 diff 可加 `+/-/行数`（从 metadata 取） | 与 write 同：`title` 常用完整路径，取 basename |
| **bash** | `input.command`；**`input.description`**；`title`；`metadata.output` / stdout | 「Shell」+ **`description` 动效行**（完成后显示） | `Shell` → **优先 `input.description`，否则 `title`，再否则 `command` 前 60 字** | 与桌面一致：`message-part.tsx` bash 的 trigger 用 `input.description` |
| **glob** | `input.pattern`；`input.path`；`metadata.count`；`metadata.truncated` | 「Glob」+ 目录 + `pattern=` 参数 | `Glob` + **`pattern`** → **`N 个匹配`**（`metadata.count`）+ 若 truncated 标「已截断」 | `count` 用结构化字段，**不要**数 output 行（除非 metadata 缺失） |
| **grep** | `input.pattern`, `input.path`, `input.include` | 「Grep」+ 目录 + pattern/include 参数 | `Grep` + `pattern` → `path` 截断 | args 与 UI 一致 |
| **list** | `input.path` | 「列出」+ 目录 | `列出` + `path` basename 或全路径截断 | `input.path` |
| **webfetch** | `input.url`；`output` | 标题「Web fetch」+ **URL** | `抓取` + **host 或 URL 截断** | 优先 `input.url` |
| **websearch** | `input.query`；**`input.numResults`**；`title`；`output`（大块文本） | 「Web search」+ **query 一行**（`trigger.subtitle = query`） | **主行**：`网络搜索` + **关键词** → **副行**：`请求 N 条`（`numResults`）+ 可选「解析得 M 条结果」 | **关键词**：优先 **`input.query`**（与桌面一致）；若缺失，从 **`title`** 去掉前缀：`/^Web search:\s*/i` 或 `^.*?：\s*` 后即为 query。**条数**：请求数 = `input.numResults`；**实际返回条数**（无结构化字段时）：对 `output` 用正则 **`^URL:\s*`（多行模式）** 计数，或数分隔块 `---` +1；URL 列表可用 **`/^URL:\s*(https?:\/\/\S+)/gm`** 抽取前 1～3 个用于 Tooltip |
| **codesearch** | `input.query`；`output` | 「代码搜索」+ query | 同 websearch 结构，换标签为 `代码搜索` | `input.query` |
| **task** | `input.description`；`metadata.sessionId`；子 agent 名 | 子代理色条 + **description 或 sessionId** | `子任务` + `description` 或短 sessionId | 与 `ToolPartDisplay` 中 task 一致 |
| **apply_patch** | `metadata.files` 等 | 单文件显示文件名；多文件显示「N 个文件」 | `补丁` + 单文件 basename 或 `N 个文件` | `patchFiles(metadata.files)` 逻辑同 UI |
| **todowrite** | `metadata.todos` 或 `input.todos` | 「待办」+ `完成数/总数` | `待办` + `x/y` | 过滤 `completed` 计数 |
| **question** | `input.questions`；`metadata.answers` | 「问题」+ 题数 / 已答 | `提问` + `N 个问题` | `questions.length` |
| **skill** | `input.name` | 技能名 | `技能` + `input.name` | `hideDetails`，Tooltip 一行即可 |
| **（未知）** | 任意 | 通用 | `tool` 名字 + **`state.title`** + `status` | 兜底 |

**`websearch` 补充（你的 JSON）**

- `title`: `"Web search: UIST \"agent\" visualization..."` → 若只做展示，**可直接整行作 Tooltip 一行**（已与桌面语义一致）；若只要关键词，**优先 `input.query`**，与 `title` 中冒号后内容应对齐。
- `input.numResults`: `10` → Tooltip 写 **「请求 10 条结果」**。
- **具体 URL**：在 **`state.output`** 中用正则提取，例如多行匹配 `^URL:\s*(https?://\S+)`；Tooltip 里只显示 **前 2 个 host** 或 **「共 M 条链接」**（M = 匹配数），避免贴全文。

### 6.4 错误与进行中

| `state.status` | Tooltip |
|----------------|---------|
| `pending` / `running` | 工具中文名 + `进行中…`；若有 `state.title` 可显示 |
| `error` | 工具名 + **`state.error` 单行截断**（`ToolErrorCard` 同源） |

---

## 7. cockpit-ui 实现时注意

实现时 **以 §6 表格为准**；全局规则：**优先 `state.title` 与 `input` 的结构化字段**，**避免把 `output` 整段放进 Tooltip**（错误态见 §6.4）。

---

## 8. 桌面端 vs Web：是否同一套逻辑？

- **主应用 UI（Solid，`packages/ui`）**：工具展示以 **`ToolRegistry` + `BasicTool`** 为准（折叠、标题行、展开内容）。
- **Web 分享页（`packages/web`）**：**另一套 JSX**，但 **信息层级一致**（标题短、详情可折叠），见 `share/part.tsx` 中 `ReadTool` / `GlobTool` / `BashTool` 等。

二者都可作为你在 **cockpit 的 Tooltip / 固定面板** 的「字段来源表」，优先复用 **OpenCode 已选过的短字段**（`pattern`、`count`、`description`、`preview`），避免直接塞满 `output`。

---

## 9. 维护说明

- 若上游升级 OpenCode，**以 `packages/sdk/js/src/v2/gen/types.gen.ts` 的 `Part` / `ToolState` 为准**核对是否有新 `part.type` 或 `ToolState` 变体。
- 若工具新增字段，**以 `packages/ui/src/components/message-part.tsx` 内对应 `ToolRegistry.register` 为准**看官方如何展示。
