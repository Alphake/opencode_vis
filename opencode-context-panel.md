# OpenCode 上下文面板 — 数据来源与计算逻辑

> 基于 `packages/app` + `packages/opencode` 源码分析，版本截至 2026-03-29。

---

## 一、上下文面板在哪里

### 入口位置

| 层级 | 文件 | 说明 |
|------|------|------|
| 顶栏圆形进度指示器 | `packages/app/src/components/session-context-usage.tsx` | 悬停显示简要信息，点击打开面板 |
| 面板主体 | `packages/app/src/components/session/session-context-tab.tsx` | 完整上下文统计面板 |
| 指标计算 | `packages/app/src/components/session/session-context-metrics.ts` | 汇总 token、成本等指标 |
| 拆分估算 | `packages/app/src/components/session/session-context-breakdown.ts` | 计算各部分占比 |
| 后端数据源 | `packages/opencode/src/session/index.ts` → `getUsage()` | 将 AI SDK 返回的 usage 转为内部 token 结构 |
| 写入存储 | `packages/opencode/src/session/processor.ts` | 每步完成时把 token 写入 AssistantMessage |

用户点击会话顶栏右侧的圆形进度圆环，或在右侧面板打开 `context` 标签页，即可看到完整面板。

---

## 二、面板展示的所有数据项

### 2.1 统计指标网格（Stats Grid）

共 16 项，以 `<label>: <value>` 形式两列排布：

| 标签 key | 显示内容 | 数据来源 |
|----------|---------|---------|
| `context.stats.session` | 会话标题 | `session.title` |
| `context.stats.messages` | 总消息数 | `messages.length` |
| `context.stats.provider` | Provider 名称 | `provider.name` 或 `message.providerID` |
| `context.stats.model` | 模型名称 | `model.name` 或 `message.modelID` |
| `context.stats.limit` | 上下文长度上限（token） | `model.limit.context` |
| `context.stats.totalTokens` | 最近一轮累计 token 总数 | `input + output + reasoning + cache.read + cache.write` |
| `context.stats.usage` | 上下文使用率（%） | `round(total / limit * 100)` |
| `context.stats.inputTokens` | 输入 token 数 | `message.tokens.input` |
| `context.stats.outputTokens` | 输出 token 数 | `message.tokens.output` |
| `context.stats.reasoningTokens` | 推理 token 数 | `message.tokens.reasoning` |
| `context.stats.cacheTokens` | 缓存命中 / 写入 token | `message.tokens.cache.read / cache.write` |
| `context.stats.userMessages` | 用户消息数量 | `messages.filter(role=user).length` |
| `context.stats.assistantMessages` | AI 消息数量 | `messages.filter(role=assistant).length` |
| `context.stats.totalCost` | 累计花费（USD） | 所有 assistant 消息 `cost` 求和 |
| `context.stats.sessionCreated` | 会话创建时间 | `session.time.created` |
| `context.stats.lastActivity` | 最后活动时间 | 最近有 token 数据的 assistant 消息创建时间 |

### 2.2 Token 拆分彩色条（Breakdown Bar）

一条横向彩色进度条，将输入 token 拆分为 5 个色块：

| 颜色 | key | 含义 |
|------|-----|------|
| 蓝色 `--syntax-info` | `system` | 系统提示（system prompt） |
| 绿色 `--syntax-success` | `user` | 用户消息内容 |
| 紫色 `--syntax-property` | `assistant` | AI 回复文本 + 推理文本 |
| 黄色 `--syntax-warning` | `tool` | 工具调用输入 + 工具输出结果 |
| 灰色 `--syntax-comment` | `other` | 无法归类的剩余 token |

每块下方附有标签 + 百分比文字说明。

### 2.3 System Prompt 展示

显示当前会话最新的系统提示文本（Markdown 渲染）。

### 2.4 Raw Messages 展示

折叠列表，每条消息展开后显示完整的 JSON（message + parts），便于调试。

---

## 三、数据如何得到——完整流转路径

```
AI Provider API
    │  返回 LanguageModelV2Usage + ProviderMetadata
    ▼
Session.getUsage()          ← packages/opencode/src/session/index.ts
    │  解析各 token 分类
    ▼
processor.ts "finish-step"  ← packages/opencode/src/session/processor.ts
    │  将 tokens/cost 写入 AssistantMessage
    ▼
数据库（SQLite）
    │  通过 sync 同步到前端
    ▼
getSessionContextMetrics()  ← session-context-metrics.ts
    │  汇总成 Context 对象
    ▼
estimateSessionContextBreakdown() ← session-context-breakdown.ts
    │  按字符数估算各部分占比
    ▼
SessionContextTab UI 渲染
```

---

## 四、后端：Token 数据的生产过程

### 4.1 Session.getUsage()（核心转换函数）

**文件**：`packages/opencode/src/session/index.ts:784`

```ts
export const getUsage = fn(
  z.object({
    model: z.custom<Provider.Model>(),
    usage: z.custom<LanguageModelV2Usage>(),
    metadata: z.custom<ProviderMetadata>().optional(),
  }),
  (input) => { ... }
)
```

该函数接收 AI SDK 标准的 `LanguageModelV2Usage` 对象，返回内部 `tokens` 结构和 `cost`。

#### 关键逻辑：Provider 差异处理

| Provider | `inputTokens` 是否包含缓存 | 处理方式 |
|----------|--------------------------|---------|
| Anthropic / Amazon Bedrock | **不包含**（缓存单独报告） | 直接使用，`cacheWrite` 从 `metadata.anthropic.cacheCreationInputTokens` 读取 |
| OpenAI / Gemini / OpenRouter 等 | **包含**（缓存混在一起） | 需要减去 `cachedInputTokens` 和 `cacheWriteInputTokens` 得到净输入数 |

```ts
const excludesCachedTokens = !!(input.metadata?.["anthropic"] || input.metadata?.["bedrock"])
const adjustedInputTokens = excludesCachedTokens
  ? inputTokens
  : inputTokens - cacheReadInputTokens - cacheWriteInputTokens
```

#### 最终 tokens 结构

```ts
const tokens = {
  total,               // 各项求和（或取 usage.totalTokens）
  input: adjustedInputTokens,
  output: outputTokens,
  reasoning: reasoningTokens,
  cache: {
    write: cacheWriteInputTokens,
    read: cacheReadInputTokens,
  },
}
```

#### 成本计算（单位：百万 token 定价）

```ts
cost = tokens.input    × model.cost.input    / 1_000_000
     + tokens.output   × model.cost.output   / 1_000_000
     + tokens.cache.read  × model.cost.cache.read  / 1_000_000
     + tokens.cache.write × model.cost.cache.write / 1_000_000
     + tokens.reasoning   × model.cost.output / 1_000_000  // 推理按 output 价格计
```

> 注：若模型有 `experimentalOver200K` 超阶梯定价，`input + cache.read > 200_000` 时切换到高档费率。

### 4.2 processor.ts：写入 AssistantMessage

```ts
case "finish-step":
  const usage = Session.getUsage({ model, usage: value.usage, metadata })
  input.assistantMessage.cost += usage.cost      // 累加成本
  input.assistantMessage.tokens = usage.tokens   // 写入 token（以最后一步为准）
```

> 注意：多步（multi-step）会话中，`tokens` 字段会被**最后一个 finish-step 覆盖**，`cost` 则是**累加**。

---

## 五、前端：指标计算逻辑

### 5.1 getSessionContextMetrics()

**文件**：`packages/app/src/components/session/session-context-metrics.ts`

#### 核心逻辑

1. **找到最近一条有 token 的 Assistant 消息**（`lastAssistantWithTokens`）：
   ```ts
   for (let i = messages.length - 1; i >= 0; i--) {
     const msg = messages[i]
     if (msg.role !== "assistant") continue
     if (tokenTotal(msg) <= 0) continue
     return msg
   }
   ```

2. **计算 total**（`tokenTotal`）：
   ```ts
   const tokenTotal = (msg) =>
     msg.tokens.input + msg.tokens.output + msg.tokens.reasoning
     + msg.tokens.cache.read + msg.tokens.cache.write
   ```

3. **计算上下文使用率**（`usage`）：
   ```ts
   usage = limit ? Math.round((total / limit) * 100) : null
   ```
   `limit` 来自 `model.limit.context`（从 Provider 配置/models.dev 元数据中读取）。

4. **累计总成本**：
   ```ts
   totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
   ```

---

## 六、Token 拆分占比的计算逻辑（核心）

### 6.1 estimateSessionContextBreakdown()

**文件**：`packages/app/src/components/session/session-context-breakdown.ts`

这是**估算**，不是精确计数，因为前端没有独立的 tokenizer。

#### 核心公式

```ts
const estimateTokens = (chars: number) => Math.ceil(chars / 4)
```

每 4 个字符估算为 1 个 token（通用的英文 token 平均近似值）。

#### 各部分字符数统计

**System（系统提示）**：
```ts
counts.system = args.systemPrompt?.length ?? 0
```
直接取 systemPrompt 字符串长度。

**User（用户消息）**：

遍历所有 `role === "user"` 消息的 parts：

| Part 类型 | 字符数来源 |
|-----------|-----------|
| `text` | `part.text.length` |
| `file` | `part.source.text.value.length`（文件文本内容） |
| `agent` | `part.source.value.length`（agent 结果内容） |

**Assistant（AI 回复）** 和 **Tool（工具调用）**：

遍历所有 `role === "assistant"` 消息的 parts：

| Part 类型 | 归入 assistant | 归入 tool |
|-----------|--------------|----------|
| `text` | `part.text.length` | 0 |
| `reasoning` | `part.text.length` | 0 |
| `tool`（pending） | 0 | `Object.keys(input).length × 16 + part.state.raw.length` |
| `tool`（completed） | 0 | `Object.keys(input).length × 16 + part.state.output.length` |
| `tool`（error） | 0 | `Object.keys(input).length × 16 + part.state.error.length` |

> 工具输入参数个数 × 16 是对参数 key 开销的粗略估算。

#### 缩放修正（避免超出 input）

各部分估算 token 求和后，与实际 `input` 对比：

**情况 A：估算总量 ≤ 实际 input**

多余的 token 归入 `other`（其他不可见 token，如隐藏注入的提示词等）：
```ts
other = args.input - estimated
```

**情况 B：估算总量 > 实际 input**（估算偏高）

按比例缩放所有部分，使总量等于 input：
```ts
const scale = args.input / estimated
scaled.system   = Math.floor(tokens.system   * scale)
scaled.user     = Math.floor(tokens.user     * scale)
scaled.assistant = Math.floor(tokens.assistant * scale)
scaled.tool     = Math.floor(tokens.tool     * scale)
// 剩余舍入误差归入 other
other = Math.max(0, args.input - (scaled.system + ... + scaled.tool))
```

#### 最终 percent 计算

```ts
width   = (segmentTokens / input) * 100        // 用于 CSS width
percent = Math.round(width * 10) / 10          // 保留一位小数，用于显示
```

---

## 七、圆形进度指示器（顶栏）

**文件**：`packages/app/src/components/session-context-usage.tsx`

悬停 tooltip 显示：
- `total`（最近一轮 token 总数）
- `usage`（使用率 %）
- `cost`（累计 USD 花费）

圆弧填充比例直接使用 `context.usage`（即 `total / limit * 100`），若 limit 未知则显示 0。

---

## 八、精度说明与局限性

| 项目 | 精确程度 | 原因 |
|------|---------|------|
| `input/output/reasoning/cache` token 数 | **精确** | 直接来自 AI Provider API 返回值 |
| 上下文使用率 | **精确**（取决于 limit） | limit 来自 models.dev 静态数据，可能与 provider 实际限制有偏差 |
| 总成本 | **近似**（~精确） | 存在 Anthropic vs 其他 provider 的 inputTokens 计算差异 bug（代码注释已标注） |
| token 拆分占比（system/user/assistant/tool/other） | **估算** | 字符数 ÷ 4 的启发式方法，中文/代码等内容会有较大误差 |

---

## 九、关键文件索引

```
packages/
├── app/src/components/
│   ├── session-context-usage.tsx          # 顶栏圆形进度 + tooltip
│   └── session/
│       ├── session-context-tab.tsx        # 面板主体 UI
│       ├── session-context-metrics.ts     # 指标计算（token汇总、使用率、成本）
│       ├── session-context-breakdown.ts   # 拆分占比估算（核心算法）
│       └── session-context-format.ts      # 数字/时间格式化工具
└── opencode/src/session/
    ├── index.ts                           # Session.getUsage()（token解析 + 成本计算）
    ├── processor.ts                       # finish-step：写入AssistantMessage
    └── message-v2.ts                      # AssistantMessage数据结构定义
```
