# 子任务卡片字段：含义、数据来源与计算

本文说明右侧面板 **子任务卡片**（`SubtaskCard` + `buildSubtaskCardMetrics`）上各字段如何得到；与 OpenCode 官方 token 语义对齐处引用仓库 [anomalyco/opencode](https://github.com/anomalyco/opencode) 及本仓分析文档 `opencode-context-panel.md`。

---

## 总览表

| # | 字段（产品名） | 实现属性 | 获取 / 计算方式 | 暂无法精确时 |
|---|----------------|----------|-----------------|--------------|
| 1 | 子任务 title | `title` | 见 §1 | 默认 `子任务 n` |
| 2 | 涉及的 message / part | `assistantMessageIndices` + `partCount`（明细 API 见 §2） | 由分组结果下标 + 遍历 `parts` | — |
| 3 | 本段 token 开销（「新增」） | `tokensSegmentSum` | 见 §3 | 标为**段内合计**，增量待议 |
| 4 | LLM 调用次数 | `llmCallCount` | 本子任务内 assistant **message** 条数 | — |
| 5 | 变更文档数 | `mutatedFileCount` / `mutatedFilePaths` | 见 §5 | 启发式工具名 + input 路径 |
| 6 | 时间总开销 | `durationMs` | 见 §6 | 无时间戳时为 `null` |
| 7 | Token 拆分 | `tokenBreakdown` | 见 §7 | 仅 API 返回分项时有值 |
| 8 | 解决的 todo 数量 | `todosResolvedCount` | `todosNewlyCompleted.length` | 非「完成驱动」切段为 0 |

---

## 1. 子任务 title（`deriveSubtaskTitle`）

**优先级：**

1. 若 `todosNewlyCompleted.length > 0`：取**第一条**新完成项的 `content` 截断展示，多条时后缀「等 n 项」，前缀「完成：」。
2. 否则取本子任务**第一条** assistant message 中**首个**非空 `text` part 的**第一行**，截断约 44 字。
3. 否则：`子任务 ${displayIndex + 1}`。

**说明：** 与业务上「本段完成了什么」对齐；无 todo 完成信息时退化为首条回复摘要。

---

## 2. 涉及的 message 与 part

- **Message：** `AssistantSubtask.assistantMessageIndices` 指向全局 `messages[]` 下标；仅包含 `role === assistant` 的条目（由 `groupAssistantSubtasks` 保证）。
- **Part：** 每条 `OcMessage.parts` 数组；卡片上展示 **part 总数** `partCount`（所有涉及 message 的 `parts.length` 之和）。
- **程序化访问：** `getSubtaskMessagesAndParts(subtask, messages)`（`subtaskMetrics.ts`）返回 `{ messageIndex, message, parts }[]`，供后续可视化使用。

---

## 3. Token 开销：`tokensSegmentSum` 与「新增」说明

### 当前实现（段内合计）

对子任务内**每条** assistant message，读取 `message.info.tokens`，按 OpenCode 前端惯例求**单条合计**（与 `opencode-context-panel.md` §5.1 `tokenTotal` 一致）：

```text
total ≈ input + output + reasoning + cache.read + cache.write
```

若 API 仅提供 `tokens.total` 且分项为 0，则使用 `tokenTotalForMessage` 优先取 `tokens.total`。

**`tokensSegmentSum`** = 上述单条合计对**本子任务内所有 assistant message** 求和。

### 与「新增 token」的差别（待后续）

- **「新增」**若指相对**上一子任务**或相对**会话上一轮**的增量，需要：
  - 要么服务端按 subtask / step 边界落库 cumulative 差分；
  - 要么明确「基准」消息下标后在客户端做差（易受 OpenCode 多步覆盖 `tokens` 行为影响，见 `opencode-context-panel.md` §4.2：多步时 `tokens` 可能被最后一步覆盖）。
- **当前卡片不宣称「增量」**，字段名在 UI 上展示为 **「本段 token 合计」**；文档此处 **mark：真正的「新增」待与后端约定后再算**。

---

## 4. LLM 调用次数（`llmCallCount`）

**定义：** 本子任务包含的 **assistant message 条数** = `assistantMessageIndices.length`。

**说明：** 与 OpenCode 中「一次模型调用 / 一条 assistant 消息」粒度一致；**不是** tool 调用次数。

---

## 5. 变更文档数（`mutatedFileCount` / `mutatedFilePaths`）

### 策略（启发式）

遍历子任务内所有 assistant message 的 `parts`，对 `type === 'tool'`：

1. **工具名**（小写）匹配：`write` / `edit` / `replace` / `patch` / `apply_patch` 等子串（`isFileMutatingTool`）。
2. 从 `part.state.input` 中取路径字段（依次尝试）：`path`、`file_path`、`target_file`、`filepath`、`filePath`。
3. 路径去重（`Set`），得到 `mutatedFilePaths`，**数量**为 `mutatedFileCount`。

### 局限

- 未覆盖所有 MCP / 自定义工具命名；**未**解析纯文本 patch 中的路径。
- 若 OpenCode 把路径放在别的字段，需按真实 payload 扩展 `extractPathFromToolInput`。

---

## 6. 时间总开销（`durationMs`）

**定义：** 子任务内所有涉及 assistant message 的：

- `tMin = min(info.time.created)`
- `tMax = max(info.time.completed ?? info.time.created)`

**`durationMs = tMax - tMin`**（毫秒）。

**说明：** 近似「本段 wall time 跨度」；若只有 `created` 无 `completed`，则退化为单点时间，跨度可能为 0。**无法获取时间戳时** 为 `null`，UI 显示「—」。

---

## 7. Token 拆分（`tokenBreakdown`）

对子任务内各 assistant 的 `info.tokens` **分项求和**：

| 字段 | 来源 |
|------|------|
| `input` | `tokens.input` |
| `output` | `tokens.output` |
| `reasoning` | `tokens.reasoning` |
| `cacheRead` | `tokens.cache?.read` |
| `cacheWrite` | `tokens.cache?.write` |

**`total`（结构内）** = 五项之和（与 `tokensSegmentSum` 在分项齐全时应一致）。

### 与 OpenCode 官方「彩色条」拆分的区别

- 官方 App 的 **system / user / assistant / tool / other** 占比来自 `estimateSessionContextBreakdown`（字符 ÷ 4 估算），见 `opencode-context-panel.md` §6。
- **cockpit-ui 当前无全会话 system prompt 与 user 文本的归账**，因此卡片 **不做** 五段占比条，只做 **API 已给出的** input/output/reasoning/cache 聚合。
- 若未来要对**本子任务**做类似五段估算，需在子任务范围内重跑字符启发式，并以**本子任务各 message 的 input 之和**为缩放基准（对齐 §6.2 缩放逻辑）。

**当 API 只返回 `total`、不返回分项时：** 分项均为 0，卡片仍显示 `tokensSegmentSum`，并提示「分项未返回」。

---

## 8. 解决的 todo 数量（`todosResolvedCount`）

**定义：** `AssistantSubtask.todosNewlyCompleted.length`。

**语义：** 与 `subtaskGrouping` **规则 B** 一致——仅当本段因「同一 `content` 从非 `completed` → `completed`」而切段时，该数组非空。  
**规则 A / C / D** 切段时为空，表示**本段不是「完成 todo」驱动的子任务**，计数为 0。

---

## 代码索引

| 内容 | 路径 |
|------|------|
| 指标计算 | `src/utils/subtaskMetrics.ts` |
| 卡片 UI | `src/components/SubtaskCard.tsx` |
| 右侧面板容器 | `src/components/SubtaskDebugPanel.tsx` |
| 子任务划分 | `src/utils/subtaskGrouping.ts` |
| Message token 类型 | `src/types/opencode.ts` → `OcMessageInfo.tokens` |

---

## 参考

- OpenCode 源码：[github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)（`Session.getUsage`、`processor` finish-step、`session-context-metrics` 等）
- 本仓：`opencode-context-panel.md`（token 生产、汇总与拆分估算）
