# MEMORY.md - opencode harness 项目长期记忆

## 项目基本信息
- **项目路径**：`D:\projects\opencode_harness\agent-cockpit\agent-cockpit`
- **性质**：为 opencode 搭建监控 harness 平台，服务于导师的 D3 可视化研究
- **仓库策略**：继续在此仓库开发，不新建仓库

## 技术栈
- Plugin：TypeScript + Bun（`plugin/src/index.ts`），Hook 进 opencode 进程捕获事件
- Backend：Python Flask + SQLite，端口 5000，REST + SSE 双模式
- Frontend：React + Vite + Tailwind，端口 5173

## 数据流
opencode 进程 → Plugin (Hook) → POST /api/events/batch → Flask → SSE → React 前端

## 当前前端组件状态
- `OverviewPanel`：有 D3 KDE 等高线可视化（d3-contour）
- `AgentStatsPanel`：工具调用统计表格
- `AgentTreePanel`：左侧 session 树
- **待开发**：TodoFlowPanel（D3 event 序列图）、MessageStreamPanel

## cockpit-ui（新前端，2026-03-27 创建）
- **位置**：`cockpit-ui/`（Vite + React 19 + TS + Tailwind v4 + D3）
- **数据源**：直连 opencode API `localhost:4096`，零后端依赖
- **CORS**：已验证 opencode 完美支持 CORS
- **组件**：Header / MessagePanel / MessageBubble / ToolCallCard / ReasoningBlock / TodoPanel / EventFlowChart
- **开发计划**：`docs/development-plan.md`

## UI 目标（导师演示用）
左侧：对话消息面板（MVP：只读；后期：iframe 嵌 opencode --web）
右侧：每个 Todo 任务一个卡片，卡片内 D3 event flow 图（矩形序列 + 颜色 = event type）

## opencode 配置技巧
- 配置文件：`%USERPROFILE%\.config\opencode\opencode.json`
- 用 `instructions` 字段注入系统级提示（让 agent 每次先生成 Todo 计划）
- 用 `plugin` 字段加载编译后的 plugin dist/index.js

## 可用 API

### opencode 原生 API（`localhost:4096`，MVP 优先使用）
- `GET /session` → session 列表（含 id、slug、title、directory、time）
- `GET /session/:id/todo` → Todo 列表（含 content、status、priority）✅已验证
- `GET /session/:id/message` → 消息流（结构待确认）
- SSE `GET /session/:id/event` → 实时会话事件
- SSE `GET /global/event` → 全局事件
- `POST /session/:id/message` → 发送消息

### 自有 backend API（`localhost:5000`，长期保留用于历史数据）
- `GET /api/todos/:sessionId` → 任务列表
- `GET /api/tools/calls?sessionId=` → 工具调用序列（含时间戳、状态）
- `GET /api/sessions/:id/messages` → 完整消息流（含 parts）
- SSE `GET /api/events/stream` → 实时事件推送

## 架构决策（2026-03-27 确定）
- **MVP Demo**：只用 opencode API（`localhost:4096`），前端直连，零额外依赖
- **长期**：加回 plugin + backend，提供历史持久化和更丰富可视化
- **前端样式**：无法复用 opencode SolidJS 组件（非公开 npm 包），改为视觉参考 + React/Tailwind 重新实现
- **新布局**：Header（session 选择下拉）+ 左侧 MessagePanel + 右侧 TodoPanel（D3 矩形序列图）

## 用户信息
- 研究生，导师做可视化研究，下周一要演示
- **项目周期：2个月**，目标可以公开开源
- 重视 D3 可视化的复杂度
- 希望有 left↔right 联动映射（Todo 卡片 ↔ 消息高亮）
- 认为现有代码是 vibe coding，质量草率，第二个月需要重构

## 清空历史数据方法
（backend 停止后）删除以下文件即可清空所有历史数据：
- `backend/data/cockpit.db` + 同名 .db-shm / .db-wal
- `backend/logs/events_raw.jsonl` 和 `events_parsed.jsonl`（清空内容而非删除）
- `backend/data/keyword_extraction_result.json`
重启 backend 会自动创建新空数据库。
内存慢的真实原因是 DashScope embedding 网络延迟 + 可能的 HF 模型，不是数据量（DB 只有 1.5MB）

## 两个月路线图摘要
- 第1个月：MVP Demo（第1周）→ 功能完整（第2-3周）→ 稳定（第4周）
- 第2个月：架构重构（去 DashScope 依赖、Docker化）→ 测试文档 → 开源发布
- 重构原则：下周一 demo 前不动 embedding 相关代码，先 demo 后重构
