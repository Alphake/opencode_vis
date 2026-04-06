# Assistant 子任务（Subtask）划分规则与实现说明

本文档描述 cockpit-ui 中如何根据会话 `messages` 将 **assistant** 消息划分为子任务（`AssistantSubtask`），以及 **三类阶段** 如何区分。实现以 **`src/utils/subtaskGrouping.ts`** 为准。

---

## 1. 与「上一版仅展示条款间工作」的区别

| | 上一版（中间迭代） | 当前 |
|---|-------------------|------|
| 右栏条目 | 只含 **两条 todowrite 之间** 的纯 assistant + 最后 todowrite 后的尾部 | **全部**子任务都展示 |
| 第一条 todowrite | 不单独成段 | 归入 **planning**（含「写出列表」的那条 message） |
| 阶段语义 | 不区分 | 区分 **planning / execution / wrap_up**（见 §2） |

---

## 2. 三类阶段（`SubtaskPhase`）

按 **user** 切「一轮」assistant 序列，在该轮内根据 **非空 todowrite** 快照判断。

### 2.1 `planning`（前期调研与计划生成）

- **首轮**：从本轮 **第一条** assistant 起，直到 **第一次** 写出非空 todo 列表的 **todowrite**（**含**该条 message）。
- **再次规划**：当上一条 todowrite 的快照为 **「已全部 completed」或空列表」** 时，从 **下一条** assistant 起直到 **下一次** todowrite（**含**）为一段 planning。  
  - 语义：**从没有列表 → 有列表**，或 **从上一轮全部勾完 → 生成新一轮列表**（中间可有说明文字，与 **写出 todowrite** 同属本段）。

### 2.2 `execution`（推进 todo）

- 上一条 todowrite 的快照里 **仍存在未完成** todo 时：到 **下一次** todowrite 之间的 assistant（**不含**两端 todowrite）为 execution。
- **尾部**：若最后一条 todowrite 快照 **仍有未完成**，其后的 assistant 亦为 execution。

### 2.3 `wrap_up`（总结归纳与结果输出）

- **仅当**最后一条 todowrite 的快照为 **列表非空且全部 completed**，且其后 **仍有** assistant message。

---

## 3. 第一类 vs 第三类怎么区分（设计约定）

| 疑问 | 约定 |
|------|------|
| 「全部完成」之后又说话，再 **todowrite** 出新列表 | **整段**（含中间文案 + 新 todowrite）归为 **planning**（新一轮「从全完成到生成列表」） |
| 「全部完成」之后 **没有** 再出现 todowrite，只有 assistant 收尾 | **wrap_up** |
| 本轮 **从未出现** todowrite（整轮无列表） | 单段 **planning**（仍用标题「前期调研与计划生成」） |

核心判据：**是否还会出现下一条 todowrite**。会 → 下一段 todowrite 及之前归 **planning**；不会且快照已全完成 → 尾部归 **wrap_up**。

---

## 4. 划分方式（非「先切再并」）

在同一 user 轮次内，**前期调研与计划生成**在扫描时 **一次划成一段**：从当前 assistant 游标起，沿 todowrite 跳过「快照尚无未完成 todo」的若干次写入，直到 **第一次** 出现「快照里仍有未完成 todo」的那条 todowrite（或若始终没有，则收到 **最后一条** todowrite），这之间的 **全部** assistant（含中间各条 todowrite）同属 **一条** `planning`。  
**全完成后的收尾**仍由「最后一条 todowrite 之后」的尾部一次产出，通常每轮至多一段 `wrap_up`。

---

## 5. 数据结构

| 字段 | 含义 |
|------|------|
| `phase` | `planning` \| `execution` \| `wrap_up` |
| `assistantMessageIndices` | 本子任务包含的 message 下标（planning **含** todowrite） |
| `todos` / `todosNewlyCompleted` | 与段末快照及 diff 语义一致（见代码注释） |

卡片标题：`planning` → **前期调研与计划生成**；`wrap_up` → **总结归纳与结果输出**；`execution` 仍优先「完成：…」等（`deriveSubtaskTitle`）。

---

## 6. 相关文件

| 文件 | 说明 |
|------|------|
| `src/utils/subtaskGrouping.ts` | 分组与 `phase` |
| `src/utils/subtaskMetrics.ts` | `deriveSubtaskTitle` |
| `src/App.tsx` | `groupAssistantSubtasks` 调用 |
