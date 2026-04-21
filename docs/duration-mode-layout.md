# Duration 模式布局说明（含公式与示例）

本文档记录 `ActionFlowVisualization` 在 `durationMode=true` 时的布局计算方式。

- 主代码文件：`src/components/ActionFlowVisualization.tsx`
- 关键函数：`computeLayout()`、`durationWidthMeta()`

---

## 1) 基础常量与映射函数

代码位置：`src/components/ActionFlowVisualization.tsx`（`L51-L61`, `L80-L88`, `L106-L117`, `L383`）

- `MIN_W = 28`（block 最小宽度）
- `MARGIN_LEFT = 24`（x 起点）
- `TIMELINE_STEP_GAP = 10`（非 duration 模式默认间隔）
- `DUR_WIDTH_BASE_MS = 10`（`duration <= 10ms` 固定最小宽度）
- `DUR_SQRT_REF_MS = 120000`（2 分钟参考时长）
- `DUR_BLOCK_REF_W_PX = 160`（2 分钟对应的参考宽度）
- `DUR_GAP_REF_MS = 60000`（1 分钟参考间隔）
- `DUR_GAP_MIN_PX = 8`（duration 模式最小连线间隔）
- `DUR_GAP_REF_PX = 80`（1 分钟对应的参考连线间隔）

### 1.1 block 宽度函数（开方，非线性）

```text
if durationMs <= 0 or invalid:
  width = MIN_W
else if durationMs <= DUR_WIDTH_BASE_MS:
  width = MIN_W
else:
  x = (durationMs - DUR_WIDTH_BASE_MS) / (DUR_SQRT_REF_MS - DUR_WIDTH_BASE_MS)
  width = MIN_W + (DUR_BLOCK_REF_W_PX - MIN_W) * sqrt(max(0, x))
```

代入当前常量后：

```text
if durationMs <= 10:
  width = 28
else:
  width = 28 + 132 * sqrt((durationMs - 10) / (120000 - 10))
```

说明：
- 语义是“先给一个最小时长基线 10ms”，低于基线不再继续变窄。
- 当前实现 **不 clamp 上限**，超过 2 分钟仍继续按开方增长。

### 1.2 连线间隔函数（开方，非线性）

先计算真实空档时间：

```text
gapMs = max(0, next.minStart - current.maxEnd)
```

再映射为像素：

```text
gapPx = DUR_GAP_MIN_PX + (DUR_GAP_REF_PX - DUR_GAP_MIN_PX) * sqrt(gapMs / DUR_GAP_REF_MS)
```

代入当前常量后：

```text
gapPx = 8 + 72 * sqrt(gapMs / 60000)
```

说明：
- 这是 `d3.scaleSqrt().domain([0,60000]).range([8,80])` 的等价表达。
- 当前实现 **不 clamp 上限**，超过 60 秒仍继续按开方增长。

---

## 2) 多个 action 的 x 轴累计规则（block + 连线 + block）

代码位置：`src/components/ActionFlowVisualization.tsx`（`L635-L655`, `L582-L605`, `L783-L806`）

在 root / child / branch 三条轨道里，本质都是相同的“游标累计”：

```text
slotStartX[0] = 起点（root 为 MARGIN_LEFT；child/branch 为 0 或 forkBaseX）
slotStartX[k+1] = slotStartX[k] + slotSpan[k] + interSlotGap[k]
```

其中：
- `slotSpan[k]`：该 slot 的有效宽度（至少是 block 宽度；Subagent 还可能带上其 child span）
- `interSlotGap[k]`：
  - duration 模式：`gapPx = sqrt-map(gapMs)`
  - 非 duration 模式：固定 `TIMELINE_STEP_GAP = 10`

---

## 3) 具体数值示例（顺序 3 个 action）

假设同一轨道有 3 个 action（单位秒）：

- A：`start=0s`, `duration=10s`
- B：`start=18s`, `duration=20s`
- C：`start=45s`, `duration=5s`

### 3.1 先算每个 block 宽度

```text
wA = 28 + 132*sqrt((10000-10)/(120000-10)) ≈ 66.10
wB = 28 + 132*sqrt((20000-10)/(120000-10)) ≈ 81.89
wC = 28 + 132*sqrt(( 5000-10)/(120000-10)) ≈ 54.92
```

### 3.2 再算连线间隔

```text
A 结束 = 10s, B 开始 = 18s => gapAB = 8s = 8000ms
gapPxAB = 8 + 72*sqrt(8000/60000) ≈ 34.30

B 结束 = 38s, C 开始 = 45s => gapBC = 7s = 7000ms
gapPxBC = 8 + 72*sqrt(7000/60000) ≈ 32.60
```

### 3.3 最终 x（root 轨道）

`MARGIN_LEFT = 24`

```text
xA = 24
xB = xA + wA + gapPxAB
   = 24 + 66.11 + 34.30
   ≈ 124.41

xC = xB + wB + gapPxBC
   = 124.41 + 81.89 + 32.60
   ≈ 238.90
```

这就是严格的 `block + 连线 + block`。

---

## 4) 并行 action（含错位开始时间）逻辑

代码位置：
- root：`src/components/ActionFlowVisualization.tsx`（`L483-L488`）
- child：`src/components/ActionFlowVisualization.tsx`（`L539-L544`）
- branch：`src/components/ActionFlowVisualization.tsx`（`L739-L744`）

核心规则：

```text
if (durationMode || !a.parallelGroupId) {
  每个 action 独立占一个 slot
}
```

含义：
- 在 `durationMode=true` 下，即便两个 action 在同一并行组，也不再强制左对齐到同一 slot。
- 仍按时间顺序进入“连续 slot”，保证不会图形重叠，且保留 block+连线累计关系。

### 并行错位示例

假设两个并行动作（同组不同 lane）：

- P1：`start=30s`, `duration=12s`（end=42s）
- P2：`start=34s`, `duration=6s`（end=40s）

它们会变成相邻两个 slot：

```text
gapMs = max(0, 34s - 42s) = 0
gapPx = 8 + 72*sqrt(0/60000) = 8
```

所以 P2 不会左对齐到 P1，而是排在 P1 右边，最小间隔 8px（并行时也保持串接布局）。

---

## 5) 其它与 x 相关的补充

### 5.1 child session 起点

代码位置：`src/components/ActionFlowVisualization.tsx`（`L867-L887`）

```text
childBaseX = parentRight + TIMELINE_STEP_GAP
childX = childBaseX + childLocalX
```

即：child 会从父 task 右侧固定 10px 处起步，再加上 child 内部累计位置。

### 5.2 终点 end 节点

代码位置：`src/components/ActionFlowVisualization.tsx`（`L896-L914`）

- `endXMain = historicalRightmost + TIMELINE_STEP_GAP`
- fork 分支在 duration 模式下用 `branchRightmost + TIMELINE_STEP_GAP`

---

## 6) 一句话总结

当前 duration 模式是：
- 宽度用“开方时长映射”
- 间隔用“开方空档映射”
- x 用“累计递推（block+gap）”
- 并行在 duration 下不再强制左对齐（每个 action 独立 slot）

