# Action 流程图图标 — SVG 提交模板

把下面 12 段里 **「在此处粘贴…」** 换成你从设计稿导出的 `<svg>…</svg>`（或只贴 `<svg>` 内部内容，二选一在文件里说明清楚即可）。

## 约定（便于接入 `ActionFlowVisualization`）

| 项 | 说明 |
|----|------|
| 画布 | 建议统一 `viewBox="0 0 16 16"`，宽高可用 `width="16" height="16"`（接入时会再缩放居中） |
| 颜色 | 把需要随状态/主题变的填充、描边改成 **`currentColor`**，不要写死 `#2B2B2B` 等（除非该处永远不变） |
| 结构 | 尽量保留一条路径、少用重复 `id`；若多个 `<mask>` / `<clipPath>`，导出后给 `id` 加唯一后缀（如 `_think`）避免同页冲突 |
| 根节点 | 保留一个根 `<svg …>` 即可，便于整体粘贴 |

## 12 个 ActionType（与 `src/types/opencode.ts` 一致）

顺序随意，但请**标注类型名**，方便对照。

---

### Think

在此处粘贴 SVG：

```svg

```

---

### Clarify

在此处粘贴 SVG：

```svg

```

---

### Plan

在此处粘贴 SVG：

```svg

```

---

### Permission

在此处粘贴 SVG：

```svg

```

---

### Subagent

在此处粘贴 SVG：

```svg

```

---

### Response

在此处粘贴 SVG：

```svg

```

---

### Read

在此处粘贴 SVG：

```svg

```

---

### Write

在此处粘贴 SVG：

```svg

```

---

### Shell

在此处粘贴 SVG：

```svg

```

---

### Search

在此处粘贴 SVG：

```svg

```

---

### Skill

在此处粘贴 SVG：

```svg

```

---

### Compaction

在此处粘贴 SVG：

```svg

```

---

## 提交方式

- 填好后把本文件发我，或把各段 SVG 分条贴在对话里；或直接把内容合并进仓库后指一下路径即可。
