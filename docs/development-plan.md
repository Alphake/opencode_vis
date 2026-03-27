# Cockpit UI 开发计划

> 最后更新：2026-03-27 19:22

## 一、架构总览

```
opencode 进程（localhost:4096）
  ↕ HTTP REST + SSE
cockpit-ui/（React + Vite + TypeScript + Tailwind）
  ├── 左侧：MessagePanel（消息流）
  └── 右侧：TodoPanel + D3 EventFlowChart（可视化）
```

**零后端依赖**：前端通过 `@opencode-ai/sdk` 或直接 fetch 直连 opencode 服务端。

---

## 二、API 接口文档（已验证）

### 2.1 基础信息

- **Base URL**：`http://localhost:4096`
- **认证**：无（本地开发，同机访问）
- **数据格式**：JSON

### 2.2 接口清单

#### `GET /session` — Session 列表

- **用途**：获取所有历史会话
- **已验证**：✅ 返回 58 条
- **响应示例**：
```json
{
  "id": "ses_2dff6e4bbffe67Y97g83OFB9gZ",
  "slug": "silent-nebula",
  "projectID": "global",
  "directory": "D:\\projects\\built_by_oc\\test5",
  "title": "New session - 2026-03-24T13:29:20.964Z",
  "version": "1.2.24",
  "summary": { "additions": 0, "deletions": 0, "files": 0 },
  "permission": [{ "permission": "todowrite", "pattern": "*", "action": "deny" }],
  "time": { "created": 1774358960964, "updated": 1774359011790 },
  "parentID": "ses_xxx"
}
```

#### `GET /session/:id/todo` — Todo 列表

- **用途**：获取指定 session 的任务计划
- **已验证**：✅ 返回 6 条
- **响应示例**：
```json
{
  "content": "了解 OpenCode 插件系统架构和可用 hooks",
  "status": "completed",
  "priority": "high"
}
```

#### `GET /session/:id/message` — 消息流

- **用途**：获取完整对话消息（含工具调用）
- **已验证**：✅ 返回 7 条，82KB
- **响应结构**：
```json
{
  "info": {
    "role": "user",
    "time": { "created": 1774358961011, "completed": 1774358967364 },
    "agent": "build",
    "model": { "providerID": "opencode", "modelID": "minimax-m2.5-free" },
    "mode": "build",
    "tokens": { "total": 12101, "input": 65, "output": 81, "reasoning": 0 },
    "cost": 0,
    "finish": "tool-calls",
    "id": "msg_xxx",
    "sessionID": "ses_xxx",
    "parentID": "msg_xxx"
  },
  "parts": [
    { "type": "text", "text": "用户输入的内容" },
    { "type": "step-start" },
    {
      "type": "reasoning",
      "text": "思考过程...",
      "metadata": {},
      "time": { "start": 1774358963164, "end": 1774358964348 }
    },
    {
      "type": "tool",
      "callID": "call_function_xxx_1",
      "tool": "websearch",
      "state": {
        "status": "completed",
        "input": { "query": "搜索内容" },
        "output": "工具返回结果..."
      }
    },
    { "type": "text", "text": "助手回复文本" },
    { "type": "text-file", "path": "...", "content": "..." },
    { "type": "image", "source": { "type": "base64", "media_type": "...", "data": "..." } }
  ]
}
```

#### `GET /session/:id/event` — 实时事件（SSE）

- **用途**：订阅实时会话事件流
- **待验证**：需要 opencode 正在运行且有活动

#### `GET /global/event` — 全局事件（SSE）

- **用途**：订阅所有 session 的事件

#### `POST /session/:id/message` — 发送消息

- **请求体**：`{ "parts": [{ "type": "text", "text": "你好" }] }`

### 2.3 Part 类型汇总

| type | 含义 | 渲染方式 |
|---|---|---|
| `text` | 文本内容 | Markdown 渲染 |
| `reasoning` | 思考过程（CoT） | 折叠展示，淡色 |
| `tool` | 工具调用 | 可折叠卡片 |
| `step-start` | 步骤开始标记 | 分隔线 |
| `text-file` | 文件内容 | 代码块 |
| `image` | 图片 | `<img>` |

---

## 三、开发阶段

### 阶段 1：项目初始化 + API 连通验证

**目标**：能跑起来，能连上 opencode 拿到数据

**交付物**：
- `cockpit-ui/` 目录，Vite + React + TS + Tailwind
- 一个最简页面，显示 session 列表和选中 session 的 todos + messages

**检验方式**：
1. `cd cockpit-ui && npm install && npm run dev`
2. 浏览器打开 `http://localhost:5173`
3. 页面显示 session 列表下拉框
4. 选择一个 session，左侧显示消息，右侧显示 Todo
5. 如果 opencode 的 `localhost:4096` 有数据，应能正常显示

### 阶段 2：左右两栏布局 + 消息面板

**目标**：完整的消息流展示

**交付物**：
- Header：Session 选择器 + 状态指示
- 左侧 MessagePanel：消息气泡、工具调用卡片、思考过程折叠
- 响应式布局

**检验方式**：
1. 选择有消息的 session
2. 左侧看到完整对话流：用户消息 / 助手消息
3. 工具调用以可折叠卡片展示
4. 思考过程折叠显示

### 阶段 3：右侧可视化面板

**目标**：Todo 卡片 + D3 事件序列图

**交付物**：
- 右侧 TodoPanel + D3 EventFlowChart
- 颜色映射：thinking=蓝、tool=橙、file_write=绿、bash=红

### 阶段 4（长期）：样式精修 + 实时更新

---

## 四、目录结构

```
cockpit-ui/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── services/opencodeApi.ts
│   ├── components/
│   │   ├── Header.tsx
│   │   ├── MessagePanel.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ToolCallCard.tsx
│   │   ├── ReasoningBlock.tsx
│   │   ├── TodoPanel.tsx
│   │   └── EventFlowChart.tsx
│   └── types/opencode.ts
```
