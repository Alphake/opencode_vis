# OpenCode 桌面端架构分析文档

## 📅 更新日期：2026-03-27

## 1. 技术栈概览

| 层级 | 技术 |
|------|------|
| 框架 | SolidJS (桌面端) |
| UI 组件库 | `@opencode-ai/ui` (内部 SolidJS 组件库) |
| SDK | `@opencode-ai/sdk/v2` |
| 样式 | Tailwind CSS + CSS Variables |
| 主题系统 | 支持 light/dark 主题，通过 `useTheme` hook 切换 |

## 2. 核心 API 接口（来自 `@opencode-ai/sdk/v2`）

### 2.1 Session 相关

```typescript
// 获取 session 列表
client.session.list() → { data: Session[] }

// 获取单个 session
client.session.get({ sessionID }) → { data: Session }

// 获取消息列表
client.session.messages({ sessionID, limit }) → { data: Message[] }

// 获取文件变更（diff）
client.session.diff({ sessionID }) → { data: FileDiff[] }

// 获取 todo 列表
client.session.todo({ sessionID }) → { data: Todo[] }
```

### 2.2 数据类型

```typescript
// Session
interface Session {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  summary: { additions: number; deletions: number; files: number }
  time: { created: number; updated: number }
  parentID?: string
  permission?: Permission[]
}

// Message
interface Message {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  time: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  // ... 其他字段
}

// FileDiff
interface FileDiff {
  file: string
  status: 'added' | 'deleted' | 'modified'
  hunks: Hunk[]
}

// Todo
interface Todo {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}
```

## 3. 桌面端布局结构

```
┌─────────────────────────────────────────────────────────────────┐
│  Titlebar (系统原生或自定义)                                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┬────────────────────────────────────┬─────────────┐ │
│  │          │                                    │             │ │
│  │ Sidebar  │        Main Content Area          │   Right     │ │
│  │          │   (消息对话 / 文件编辑区域)          │   Panel     │ │
│  │ - 项目    │                                    │             │ │
│  │ - 文件    │                                    │ - Review    │ │
│  │ - 终端    │                                    │ - Context   │ │
│  │          │                                    │ - FileTree  │ │
│  │          │                                    │             │ │
│  └──────────┴────────────────────────────────────┴─────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 4. 右侧面板功能详解

### 4.1 Review Tab（审查标签页）

**用途**：显示代码变更（Diff）列表

**数据来源**：
```typescript
// 通过 sync.context 获取
const diffs = createMemo(() => sync.data.session_diff[params.id] ?? [])
```

**FileDiff 结构**：
```typescript
interface FileDiff {
  file: string          // 文件路径
  status: 'added' | 'deleted' | 'modified'  // 变更状态
  hunks: Hunk[]         // 变更块
}
```

**组件**：`SessionReview` (来自 `@opencode-ai/ui/session-review`)

**功能**：
- Unified/Split 视图切换
- 逐文件查看变更
- 行内评论功能
- 跳转到文件编辑器

### 4.2 Context Tab（上下文标签页）

**用途**：显示 Token 使用情况和上下文消耗

**数据来源**：
```typescript
const messages = createMemo(() => sync.data.message[params.id] ?? [])
const metrics = createMemo(() => getSessionContextMetrics(messages(), sync.data.provider.all))
```

**显示内容**：
- 总 Token 数量
- 上下文使用百分比
- 预计成本（USD）
- Provider 使用统计

**组件**：`SessionContextUsage` + `SessionContextTab`

### 4.3 File Tree（文件树）

**用途**：浏览项目文件结构

**数据来源**：通过 `file.tree` context 管理

**功能**：
- 显示所有文件
- 显示变更文件（与 Review Tab 联动）
- 文件图标（根据文件类型）
- 点击跳转到编辑器

## 5. 主题系统

### 5.1 主题结构

```typescript
// desktop-theme.schema.json
interface DesktopTheme {
  name: string
  id: string
  light: ThemeVariant   // 浅色主题配置
  dark: ThemeVariant   // 深色主题配置
}
```

### 5.2 预设主题

| 主题 ID | 名称 |
|---------|------|
| oc-1 | OC-1 (OpenCode 默认) |
| oc-2 | OC-2 |
| dracula | Dracula |
| nord | Nord |
| monokai | Monokai |
| tokyonight | Tokyo Night |
| ... | ... |

### 5.3 浅色主题示例 (OC-1 Light)

关键颜色变量：
```css
--background-base: #f8f7f7
--background-weak: #f0efee
--background-strong: #e8e7e6
--background-stronger: #fcfcfc

--surface-base: rgba(0, 0, 0, 0.02)
--surface-raised-base: rgba(0, 0, 0, 0.04)
--surface-raised-stronger: #ffffff

--text-base: #1a1a1a
--text-weak: #666666
--text-strong: #000000

--border-base: rgba(0, 0, 0, 0.1)
--border-interactive: #034cff
```

## 6. 数据流（Sync Context）

```
┌─────────────────────────────────────────────────────────────────┐
│                     GlobalSync Context                          │
├─────────────────────────────────────────────────────────────────┤
│  session: Session[]              // 所有 session                 │
│  message: Record<string, Message[]>  // sessionID → messages    │
│  session_diff: Record<string, FileDiff[]>  // sessionID → diffs │
│  todo: Record<string, Todo[]>     // sessionID → todos         │
│  provider: ProviderInfo           // 模型提供商信息              │
│  project: Project[]               // 项目列表                    │
└─────────────────────────────────────────────────────────────────┘
                              ↑
                    SDK Client API (HTTP/WebSocket)
                              ↑
                    OpenCode Server (localhost:4096)
```

## 7. 我们能获取的接口总结

| 接口 | 端点 | 用途 | 状态 |
|------|------|------|------|
| Session 列表 | `GET /session` | 显示所有历史 session | ✅ 已验证 |
| Session 详情 | `GET /session/:id` | 单个 session 信息 | ✅ 已封装 |
| Messages | `GET /session/:id/message` | 消息流 | ✅ 已验证 |
| Todos | `GET /session/:id/todo` | 任务列表 | ✅ 已验证 |
| **Diff** | `GET /session/:id/diff` | **文件变更** | ⚠️ **未测试** |
| SSE Events | `GET /session/:id/event` | 实时事件流 | ✅ 已封装 |
| Global Events | `GET /global/event` | 全局事件流 | ✅ 已封装 |

## 8. 下一步建议

### 优先级 P0（Demo 必须）
1. ✅ Session 列表和选择 - 已完成
2. ✅ 消息流展示 - 已完成
3. ✅ Todo 列表 - 已完成
4. ⚠️ **Diff 接口测试** - 需要验证 `http://127.0.0.1:4096/session/:id/diff`

### 优先级 P1（功能完整）
1. 实现浅色主题切换
2. 实现 Context Tab（Token 使用统计）
3. 实现 Review Tab（代码变更展示）

### 优先级 P2（增强体验）
1. SSE 实时更新
2. D3 可视化增强
3. 左右联动（Todo ↔ 消息高亮）

---

## 附录：OpenCode 源码位置参考

| 功能 | 文件路径 |
|------|----------|
| Session 列表 | `packages/app/src/context/sync.tsx` |
| Review Tab | `packages/app/src/pages/session/review-tab.tsx` |
| Side Panel | `packages/app/src/pages/session/session-side-panel.tsx` |
| Context Usage | `packages/app/src/components/session-context-usage.tsx` |
| 主题定义 | `packages/ui/src/theme/themes/*.json` |
| SDK 类型 | `packages/sdk/src/client.ts` |
