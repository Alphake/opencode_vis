# Overview 投影实现说明（全量 embedding + MDS/t-SNE）

本文档说明当前已实现的初始化投影逻辑，以及后续“上下文组成部分投影”的接口规划。  
重点回答：

1. 降维与布局关系是什么？  
2. 现在每种 message/part 类型取了哪些字段？  
3. 字段是否完整（是否截断）？

---

## 1. 当前接口（初始化）

### 1.1 接口

- `GET /api/overview/projection/init`

### 1.2 查询参数

- `directory`（必填）
- `withEmbedding`（默认 `true`）
- `withPosition`（默认 `true`）
- `embeddingMode`：`dashscope | mock`
- `embeddingModel`（默认 `text-embedding-v4`）
- `reductionAlgo`：`mds | tsne`（默认 `mds`）

### 1.3 返回核心字段

- `nodes[]`：一条 message 一个点
  - `agent`
  - `sessionId`
  - `messageId`
  - `anchorMessageId`
  - `anchorText`（完整，不截断）
  - `embeddingInput`（完整，不截断）
  - `embedding`（全量向量，不裁维）
  - `x`, `y`（后端降维后坐标，范围归一化到 `[-1,1]`）

---

## 2. 降维与布局关系（现在如何做）

### 2.1 关系

- **embedding**：高维语义向量（例如 1024/1536 维）
- **降维**：把高维向量映射到二维坐标
- **布局**：使用降维得到的 `(x,y)` 进行可视化排布

所以当前“布局”就是“降维后坐标”的可视化，不再使用“前两维硬取值”的方式。

### 2.2 已实现算法

后端 `routes.py` 中实现了两种二维投影：

1. **MDS（经典 MDS）**
   - 用全量 embedding 计算两两欧氏距离
   - 双中心化得到 Gram 矩阵
   - 求前两主特征构造二维点

2. **t-SNE（轻量实现）**
   - 高维相似度 `P`（高斯）
   - 二维相似度 `Q`（Student-t）
   - 梯度下降最小化 `KL(P||Q)`

二者最后都归一化到 `[-1,1]`，便于前端统一映射。

---

## 3. 每种 message/part 类型取什么字段（完整版）

初始化布局文本构建使用 `_message_layout_text(message)`，字段映射如下（**全部完整，不截断**）：

1. `text`
   - 使用：`content`

2. `reasoning`
   - 使用：`content`

3. `compaction`
   - 使用：`content`

4. `step-start`
   - 不参与布局（忽略）

5. `tool`
   - 不参与布局（忽略）

6. `step-finish`
   - 不参与布局（忽略）

7. `content == null` 或空串
   - 不参与布局（忽略）

每条 message 把可用的 `text/reasoning/compaction` 内容拼成一个完整字符串作为 `embeddingInput`。

---

## 4. 当前是“一个点还是多个点”

- 当前 `init`：**一个 message 一个点**
- 点的语义来源：该 message 内（仅 `text/reasoning/compaction`）的完整拼接文本

这能先稳定跑通“目录 -> message 点集 -> 后端降维 -> 前端展示”。

---

## 5. 日志可观测（已加）

后端 `logger.info` 输出：

- `[overview.init] input`：请求参数
- `[overview.init] grouped`：agent 数、点数量、丢弃消息数量、参与布局 part 类型
- `[overview.init] embedding`：向量维度与数量
- `[overview.init] positions`：每个 message 点的 `(x,y)`、sessionId、messageCount

前端 `console.info` 输出：

- 接口响应中的 nodes + debug（包含 anchor 文本、坐标等）

---

## 6. 下一步接口规划（上下文组成部分投影）

在保持 `init` 不变的前提下，建议新增：

- `GET /api/overview/projection/parts?directory=...&reductionAlgo=mds|tsne`

语义：

- 一个 part 一个点（多点）
- 与 `init` 共享 embedding + 降维实现
- 返回 `sessionId/messageId/partType/partStatus/embeddingInput/x/y`

这样可以先有“agent 单点初始化”，再叠加“上下文 parts 多点投影”。

