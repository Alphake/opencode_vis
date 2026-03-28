# Cockpit UI 布局规范

## 整体布局

```
┌─────────────────────────────────────────────────────────┐
│ Header (40px)                                          │
├──────────┬───────────────────────────────┬──────────────┤
│ Sidebar  │ MessagePanel                 │ Right Panel  │
│ (280px)  │ (flex: 1)                    │ (400px)      │
│ 固定      │ 占据剩余空间                   │ 固定          │
└──────────┴───────────────────────────────┴──────────────┘
```

## 各栏宽度

| 栏位 | 宽度 | 说明 |
|------|------|------|
| **Sidebar（左侧）** | `280px` | 可折叠（0px ↔ 280px） |
| **MessagePanel（中间）** | `flex: 1` | 自动占据剩余空间 |
| **RightPanel（右侧）** | `400px` | 最小 300px，最大 600px |

## Sidebar（左侧面板）

- **宽度**：280px（展开时）
- **折叠宽度**：56px（只显示图标按钮）
- **内容**：
  - 顶部标题："Sessions"
  - 搜索框
  - Session 列表（按目录分组）
- **样式**：
  - 背景色：`var(--color-bg-base)`
  - 右边框：`1px solid var(--color-border-light)`
  - 文字：主要 14px，次要 12px

## MessagePanel（中间面板）

- **宽度**：`flex: 1`（自动占据剩余空间）
- **布局**：
  ```
  ┌─────────────────────────────────┐
  │ Messages (scrollable)            │
  │ - User message                  │
  │ - Assistant message             │
  │ - Tool call cards              │
  ├─────────────────────────────────┤
  │ TodoPanel (固定，max-height 200px) │
  ├─────────────────────────────────┤
  │ Model Info (底部，12px)          │
  ├─────────────────────────────────┤
  │ Input Box (固定，auto-height)   │
  └─────────────────────────────────┘
  ```

- **样式**：
  - 背景色：`var(--color-bg-base)`
  - 消息间距：16px
  - 消息气泡：
    - 用户：右侧，浅蓝色背景
    - Assistant：左侧，白色背景
    - Tool call：卡片样式，浅灰背景
  - **无边框**：消息区域不应该有明显的外边框

## RightPanel（右侧面板）

- **宽度**：400px
- **最小宽度**：300px
- **最大宽度**：600px
- **内容**：待开发（D3 event flow 可视化）
- **样式**：
  - 背景色：`var(--color-bg-base)`
  - 左边框：`1px solid var(--color-border-light)`

## 响应式设计

- 当窗口宽度 < 1200px 时：
  - Sidebar 自动折叠
  - RightPanel 可以用按钮切换显示/隐藏

## CSS 变量参考

```css
:root {
  --header-height: 40px;
  --sidebar-width: 280px;
  --sidebar-collapsed-width: 56px;
  --right-panel-width: 400px;
  --right-panel-min-width: 300px;
  --right-panel-max-width: 600px;
}
```

## 关键点

1. **不要用硬编码像素**：用 `flex: 1` 让中间面板自适应
2. **Sidebar 可折叠**：0px ↔ 280px
3. **RightPanel 固定宽度**：400px（可以调整）
4. **消息无边框**：消息区域不应该有明显的外框
