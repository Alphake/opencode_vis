# Overview 面板说明（当前实现）

本文档说明 Overview 的数据流、接口、字段和动态更新机制（含父子连线与等高线）。

## 1. 接口与数据源

- `GET /api/events/stream`（SSE）：提供 `sessions` 基线数据，前端用于目录列表与状态联动。
- `GET /api/overview/projection/init`（REST）：后端执行 embedding + 降维 + 位置分配，返回可视化点位。
- 前端不会在本地做降维，所有 `x/y` 都以后端返回为准。

## 2. projection/init 返回结构

- `agentNodes`：大点（每个 agent 一个）
  - 字段：`agent`、`status`、`sessionId`、`sessionCount`、`embeddingInput`、`initSource`、`x`、`y`
- `messageNodes`：小点（每条 message 一个）
  - 字段：`agent`、`sessionId`、`messageId`、`role`、`timestamp`、`embeddingInput`、`x`、`y`
- `agentEdges`：父子关系连线
  - 字段：`sourceAgent`、`targetAgent`、`count`
- `nodes`：向后兼容（等于 `messageNodes`）

## 3. 后端布局代码位置

- 已从 `routes.py` 拆分到独立模块：`backend/services/overview_layout.py`
- 模块职责：
  - 文本提取：`message_layout_text()`（仅 `text/reasoning/compaction`，不截断）
  - 降维算法：`classical_mds_2d()`、`tsne_2d()`
  - 向量工具：`pairwise_sqdist()`、`normalize_points()`、`power_iteration()`
  - 业务辅助：`agent_group_status()`、`first_user_message_text()`、`first_todo_text()`

## 4. 前端渲染层（D3 + SVG）

- 文件：`frontend/src/components/agents/OverviewPanel.tsx`
- 渲染顺序：
  1) KDE 等高线（`d3-contour` 的 `contourDensity`，按 agent 分组）
  2) agent 父子连线（`agentEdges`）
  3) message 小点
  4) agent 大点 + halo + 标签
- 点击任意点会展示该点的 `embeddingInput`（即向量输入文本）。

## 5. 动态更新机制

- `store.handleAgentEvent` 收到 `message.updated` / `message.part.updated` 时，递增 `overviewTick`。
- `OverviewPanel` 监听 `overviewTick`，做 500ms 防抖后重新请求 `projection/init`。
- 效果：随着新消息进入，Overview 自动重布局并更新点位、等高线、连线。

## 6. 关键说明

- agent 列表不写死，完全来自当前 directory 下的 `session.agent` 聚合结果。
- embedding 输入不做截断；message 只取 `text/reasoning/compaction` 的非空内容。
- 父子连线基于 session 的 `parentId` 关系，聚合到 agent 维度并返回 `count`。
