import { useLayoutEffect, useRef, useId, useMemo, useState } from 'react'
import * as d3 from 'd3'
import { Tooltip } from 'react-tooltip'
import type { ActionStatus, MappedAction, OcMessage } from '../types/opencode'
import {
  type TooltipKeyValue,
  buildEnglishTooltipContent,
  formatEnglishTooltipContentHtml,
  formatTooltipKeyValuesAsHtml,
  resolvePartForAction,
} from '../utils/actionTooltipMapping'
import { actionFlowPalette } from '../styles/actionFlowPalette'
import { appendActionFlowIcon, getActionFlowIconSvg } from './actionFlowIcons'
import ActionFlowContextMenu, { type ActionFlowContextMenuState } from './ActionFlowContextMenu'
import { actionKey } from '../utils/actionKey'

type FlowNode =
  | { kind: 'end'; row: number; sessionRegion: 'main' | 'fork-new-branch' }
  | (MappedAction & { row: number; kind: 'action' })

/** `computeLayout` 输出的每一项，用于连线 bundling */
type FlowLayoutItem = {
  node: FlowNode
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

const MARGIN_LEFT = 24
const GAP = 12
/**
 * 垂直布局（与 `actionMapping` 一致）：
 * - 每个 session 块内 2 个基础 layer：layer0 = kernel（Think/Response/Plan…），layer1 = 工具等；
 * - 父侧 task（Subagent）：一旦解析出 `childSessionID`，整块 rect 归入 **`session:task:` 子会话区域**（不再出现在主 session 内）；
 * - 同一 layer 上并行动作用 parallelLaneIndex 再向下错开，故「行数」随并行度增高；
 * - 子会话块在 main 下方，内部同样 layer + lane，高度亦非定值。
 */
const BLOCK_H = 28
const ROW_H = 32
/** 同一 row 上并行 lane 的垂直错开（与主 row 间距一致） */
const PARALLEL_LANE_DY = ROW_H
const SESSION_REGION_GAP = 10
/** Fork 对比：锚点后换行 — 父旧轨迹（灰）与新轨迹的垂直间距 */
const FORK_COMPARE_ROW_GAP = 44
const TOP_PAD = 4
const MIN_W = 28
const DURATION_LINEAR_THRESHOLD_MS = 60_000
const DURATION_MAX_W = 200
const DURATION_LINEAR_EXTRA_AT_THRESHOLD = 96
const BOTTOM_PAD = 6
/** 至少两行泳道 + 两块 action 时的最小画布高度，避免空数据时 SVG 塌成几十像素 */
const MIN_SVG_CONTENT_HEIGHT = TOP_PAD + 2 * ROW_H + 2 * BLOCK_H + BOTTOM_PAD
/** 视口上限：约 4 行（含上下 padding） */
const MAX_VISIBLE_ROWS = 4
const LONG_RUNNING_MS = 60_000
/** 与右键菜单一致，用于 ⋯ 等 SVG 文字 */
const SVG_FONT_SANS =
  "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif"
/** 块太窄时右上角 ⋯ 会与居中图标重叠，仅宽块显示 */
const MORE_BTN_MIN_W = 44
/** 分叉快照中「已不在上下文」的幽灵段：rect / 连线 */
const FORK_GHOST_STROKE = '#B8B8B8'
const FORK_GHOST_MARKER_FILL = '#B8B8B8'

function edgeStrokeAndMarker(
  a: MappedAction & { row: number },
  b: MappedAction & { row: number },
  normalMarkerUrl: string,
  ghostMarkerUrl: string
): { stroke: string; markerUrl: string } {
  if (a.forkGhost || b.forkGhost) {
    return { stroke: FORK_GHOST_STROKE, markerUrl: ghostMarkerUrl }
  }
  return { stroke: actionFlowPalette.arrow, markerUrl: normalMarkerUrl }
}

function blockWidth(durationMode: boolean, durationMs: number): number {
  return durationWidthMeta(durationMode, durationMs).w
}

function durationWidthMeta(
  durationMode: boolean,
  durationMs: number
): { w: number; overThreshold: boolean } {
  if (!durationMode) return { w: MIN_W, overThreshold: false }
  if (!Number.isFinite(durationMs) || durationMs <= 0) return { w: MIN_W, overThreshold: false }
  const maxExtra = Math.max(0, DURATION_MAX_W - MIN_W)
  const linearExtra = Math.min(DURATION_LINEAR_EXTRA_AT_THRESHOLD, maxExtra)
  let extra: number
  if (durationMs <= DURATION_LINEAR_THRESHOLD_MS) {
    extra = (durationMs / DURATION_LINEAR_THRESHOLD_MS) * linearExtra
  } else {
    const overRatio = durationMs / DURATION_LINEAR_THRESHOLD_MS - 1
    const softPart = (maxExtra - linearExtra) * (1 - Math.exp(-0.9 * overRatio))
    extra = linearExtra + softPart
  }
  const w = Math.min(DURATION_MAX_W, MIN_W + Math.max(0, extra))
  return { w, overThreshold: durationMs > DURATION_LINEAR_THRESHOLD_MS }
}

function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '—'
  const sec = durationMs / 1000
  if (sec < 0.01) return '<0.01s'
  return `${sec.toFixed(2)}s`
}

function statusColors(status: ActionStatus): { fill: string; stroke: string; icon: string } {
  const { green, red, pending } = actionFlowPalette
  switch (status) {
    case 'running':
      return { fill: green.fill, stroke: green.stroke, icon: green.icon }
    case 'pending':
      return { fill: pending.fill, stroke: pending.stroke, icon: pending.icon }
    case 'error':
      return { fill: red.fill, stroke: red.stroke, icon: red.icon }
    default:
      return { fill: green.fill, stroke: green.stroke, icon: green.icon }
  }
}

function effectiveStatusColors(
  status: ActionStatus,
  durationMs: number
): { fill: string; stroke: string; icon: string; isLongRunning: boolean } {
  const base = statusColors(status)
  const isLongRunning = (status === 'running' || status === 'pending') && durationMs >= LONG_RUNNING_MS
  if (!isLongRunning) return { ...base, isLongRunning: false }
  return {
    fill: '#FFE9E9',
    stroke: '#FF7A7A',
    icon: '#E24F4F',
    isLongRunning: true,
  }
}

function tokenColor(scale: d3.ScaleSequential<string>, tok: number): { fill: string; stroke: string } {
  const c = scale(tok)
  const base = d3.color(c)
  return {
    fill: base?.brighter(0.35).formatHex() ?? '#E3F2FD',
    stroke: base?.darker(0.9).formatHex() ?? '#0D47A1',
  }
}

function rowTopY(row: number): number {
  return TOP_PAD + row * ROW_H
}

function laneOffsetY(parallelLaneIndex?: number): number {
  return (parallelLaneIndex ?? 0) * PARALLEL_LANE_DY
}

/**
 * 会话垂直分区：
 * - `session:main`：主进程会话内动作；**不含**已解析出子 session 的父 task（后者单独占一块「子会话区域」）。
 * - `session:task:<parentTaskCallID>`：**整块**子会话区域（父侧 task 节点 + `child-session` 动作），叠在 main 下方。
 * - `session:fork-new-branch`：fork 后新会话的分支动作（`forkCompareRow === 2`），与父会话同 SVG，
 *   x 从 fork 锚点右缘起算独立推进，y 放在主会话/子会话之下作为「下一条泳道」。
 */
function actionSessionKey(a: MappedAction & { row: number }): string {
  if (a.forkCompareRow === 2 && a.source !== 'child-session') {
    return 'session:fork-new-branch'
  }
  if (a.source === 'child-session' && a.parentTaskCallID) {
    return `session:task:${a.parentTaskCallID}`
  }
  if (
    a.actionType === 'Subagent' &&
    a.source !== 'child-session' &&
    a.callID &&
    a.childSessionID
  ) {
    return `session:task:${a.callID}`
  }
  return 'session:main'
}

/** 父 task 在数据里仍是 layer1；在子会话 **区域** 内绘制时固定为第一行（新开 session 的顶轨） */
function actionLocalRowForLayout(a: MappedAction & { row: number }): number {
  if (
    a.actionType === 'Subagent' &&
    a.source !== 'child-session' &&
    a.callID &&
    a.childSessionID
  ) {
    return 0
  }
  return Math.max(0, a.row % 2)
}

/** 把「当前用到的行」在固定总高 totalH 内竖直居中（整体 translate 到 content <g>） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** English semantic block: message `type` / tool name + status, then tool-specific KV (see `actionTooltipMapping`) */
function buildSemanticTooltipBlockHtml(act: MappedAction & { row: number }, tooltipMessages?: OcMessage[]): string {
  if (!tooltipMessages?.length) return ''
  const part = resolvePartForAction(tooltipMessages, act)
  if (!part) return ''
  const content = buildEnglishTooltipContent(part, { allMessages: tooltipMessages })
  return formatEnglishTooltipContentHtml(content, escapeHtml)
}

/** Region 3: duration only (token estimate removed from tooltip) */
function buildTooltipFooterHtml(act: MappedAction & { row: number }): string {
  const dur = formatDurationMs(act.durationMs)
  const rows: TooltipKeyValue[] = [{ key: 'Duration', value: dur }]
  return formatTooltipKeyValuesAsHtml(rows, escapeHtml)
}

function buildActionTooltipHtml(act: MappedAction & { row: number }, tooltipMessages?: OcMessage[]): string {
  const semantic = buildSemanticTooltipBlockHtml(act, tooltipMessages)
  const footer = buildTooltipFooterHtml(act)
  if (!semantic) {
    return `<div class="action-tip-root"><div class="action-tip-footer">${footer}</div></div>`
  }
  return `<div class="action-tip-root"><div class="action-tip-main">${semantic}</div><div class="action-tip-sep" role="presentation"></div><div class="action-tip-footer">${footer}</div></div>`
}

function buildCompactActionTooltipHtml(act: MappedAction & { row: number }, tooltipMessages?: OcMessage[]): string {
  const dur = formatDurationMs(act.durationMs)
  let main = ''
  if (tooltipMessages?.length) {
    const part = resolvePartForAction(tooltipMessages, act)
    if (part) {
      const kv = buildEnglishTooltipContent(part, { allMessages: tooltipMessages })
      const lines = kv.body.flatMap((row) => {
        if (row.kind === 'kv') return [`${row.key}: ${row.value}`]
        if (row.kind === 'error') return [row.value]
        if (row.kind === 'about') return ['About:', ...row.headers]
        return [row.value]
      })
      main = `<div class="action-tip-compact-main"><div class="action-tip-compact-head"><strong>${escapeHtml(kv.primaryLabel)}</strong> <span class="action-tip-compact-status">${escapeHtml(kv.statusLabel)}</span></div>${lines.length ? `<div class="action-tip-compact-lines">${lines.map((l) => `<div class="action-tip-compact-line">${escapeHtml(l)}</div>`).join('')}</div>` : ''}</div>`
    }
  }
  const foot = `<div class="action-tip-compact-footer">${escapeHtml(dur)}</div>`
  return `<div class="action-tip-root action-tip-root--compact">${main}${foot}</div>`
}

function verticalCenterOffsetY(
  layout: { node: FlowNode; y: number; h: number }[],
  totalH: number
): number {
  if (layout.length === 0) return 0
  let minY = Infinity
  let maxY = -Infinity
  for (const item of layout) {
    if (item.y < minY) minY = item.y
    if (item.y + item.h > maxY) maxY = item.y + item.h
  }
  const centerY = (minY + maxY) / 2
  return totalH / 2 - centerY
}

export type FlowEndSummary = {
  /** read path list count + glob match count */
  readFileTotalCount: number
  readFilePaths: string[]
  globMatchFileCount: number
  webSearchCount: number
  webSearchQueries: string[]
  writeFileCount: number
  changedFilePaths: string[]
}

const FLOW_END_MAX_LINES = 12
const FLOW_END_PATH_MAX_CHARS = 72

function truncatePathForFlowEnd(p: string): string {
  const t = p.trim()
  if (t.length <= FLOW_END_PATH_MAX_CHARS) return t
  return `${t.slice(0, FLOW_END_PATH_MAX_CHARS - 1)}…`
}

function flowEndListRows(items: string[], esc: (s: string) => string): { html: string; more: number } {
  const shown = items.slice(0, FLOW_END_MAX_LINES)
  const more = items.length > shown.length ? items.length - shown.length : 0
  const html = shown
    .map(
      (p) =>
        `<div style="font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.4;color:#24292f;">${esc(truncatePathForFlowEnd(p))}</div>`,
    )
    .join('')
  return { html, more }
}

function buildFlowEndTooltipHtml(s: FlowEndSummary): string {
  const esc = escapeHtml
  const readPaths = s.readFilePaths ?? []
  const writePaths = s.changedFilePaths ?? []
  const queries = s.webSearchQueries ?? []

  const readList = flowEndListRows(readPaths, esc)
  const readMore =
    readList.more > 0
      ? `<div style="font-size:11px;color:#57606a;margin-top:4px;">+ ${readList.more} more</div>`
      : ''
  const globLine =
    s.globMatchFileCount > 0
      ? `<div style="font-size:11px;color:#57606a;margin-top:6px;">Glob · ~${esc(String(s.globMatchFileCount))} file(s) matched</div>`
      : ''

  const qList = flowEndListRows(queries, esc)
  const qMore =
    qList.more > 0
      ? `<div style="font-size:11px;color:#57606a;margin-top:4px;">+ ${qList.more} more</div>`
      : ''

  const writeList = flowEndListRows(writePaths, esc)
  const writeMore =
    writeList.more > 0
      ? `<div style="font-size:11px;color:#57606a;margin-top:4px;">+ ${writeList.more} more</div>`
      : ''

  return `<div class="action-tip-root action-tip-root--compact" style="text-align:left;max-width:min(440px,92vw);">
<div style="font-size:12px;font-weight:600;color:#24292f;margin-bottom:4px;">Read</div>
<div style="font-size:11px;color:#57606a;margin-bottom:6px;">${esc(String(s.readFileTotalCount))} file(s) (paths + glob)</div>
${readList.html}${readMore}${globLine}
<div style="font-size:12px;font-weight:600;color:#24292f;margin-top:10px;margin-bottom:4px;">Web search</div>
<div style="font-size:11px;color:#57606a;margin-bottom:6px;">${esc(String(s.webSearchCount))} call(s) · keywords / URLs</div>
${qList.html}${qMore}
<div style="font-size:12px;font-weight:600;color:#24292f;margin-top:10px;margin-bottom:4px;">Write / edit</div>
<div style="font-size:11px;color:#57606a;margin-bottom:6px;">${esc(String(s.writeFileCount))} file(s)</div>
${writeList.html}${writeMore}
</div>`
}

function computeLayout(
  actions: (MappedAction & { row: number })[],
  durationMode: boolean,
  layoutOpts?: { includeEndNode?: boolean; forkAnchorActionKey?: string | null }
) {
  const includeEndNode = layoutOpts?.includeEndNode !== false
  const forkAnchorActionKey = layoutOpts?.forkAnchorActionKey ?? null
  const sorted = [...actions].sort((a, b) => a.sortTime - b.sortTime)

  /** step 间距收紧：顺序推进时不拉太开 */
  const TIMELINE_STEP_GAP = 10

  const sessionKeySet = new Set<string>()
  sorted.forEach((a) => sessionKeySet.add(actionSessionKey(a)))
  const sessionOrder: string[] = []
  if (sessionKeySet.has('session:main')) sessionOrder.push('session:main')
  const hasForkNewBranch = sessionKeySet.has('session:fork-new-branch')

  /**
   * Fork 对比模式下两条平行支线，每条独立终点：
   *  - 历史轨迹（main，含锚点 + 灰幽灵）→ 灰色 end（嵌在主泳道右端）
   *  - 新分支（fork-new-branch）→ 正常 end（嵌在新泳道右端）
   * 普通模式仍然只有一个 main end。
   */
  const seq: FlowNode[] = sorted.map(a => ({ ...a, kind: 'action' as const }))
  if (includeEndNode) {
    seq.push({ kind: 'end', row: 1, sessionRegion: 'main' })
    if (hasForkNewBranch) {
      seq.push({ kind: 'end', row: 1, sessionRegion: 'fork-new-branch' })
    }
  }
  const childKeys = [...sessionKeySet].filter(
    (k) => k !== 'session:main' && k !== 'session:fork-new-branch'
  )
  childKeys.sort((ka, kb) => {
    const actionsA = sorted.filter((a) => actionSessionKey(a) === ka)
    const actionsB = sorted.filter((a) => actionSessionKey(a) === kb)
    const ga = actionsA[0]?.parallelGroupId ?? ''
    const gb = actionsB[0]?.parallelGroupId ?? ''
    if (ga !== gb) return ga.localeCompare(gb)
    const la = actionsA[0]?.parallelLaneIndex ?? 0
    const lb = actionsB[0]?.parallelLaneIndex ?? 0
    if (la !== lb) return la - lb
    const minA = Math.min(...actionsA.map((x) => x.sortTime))
    const minB = Math.min(...actionsB.map((x) => x.sortTime))
    return minA - minB
  })
  sessionOrder.push(...childKeys)
  /** fork-new-branch 始终放在最底（作为「分叉后下一条泳道」） */
  if (hasForkNewBranch) sessionOrder.push('session:fork-new-branch')
  if (sessionOrder.length === 0) sessionOrder.push('session:main')

  /** 全局画布上的 x（索引 -> x） */
  const actionXBySortedIndex = new Map<number, number>()

  /**
   * 根轴：主会话内 + fork 锚点之前 / 灰幽灵的全部动作（与原始时间线同步）。
   * fork-new-branch 区域不进根轴，单独走「分叉新分支」的本地 x 轨。
   */
  const rootIndices = sorted
    .map((a, idx) => ({ a, idx }))
    .filter((x) => x.a.source !== 'child-session' && actionSessionKey(x.a) !== 'session:fork-new-branch')
    .map((x) => x.idx)

  /** 根轴 slot（统一时间轴） */
  const rootSlotByIndex = new Map<number, string>()
  const rootGroupStepToSlot = new Map<string, Map<number, string>>()
  const rootGroupLaneStepCounter = new Map<string, Map<number, number>>()
  const rootSlotIndices = new Map<string, number[]>()
  let nextRootSlot = 0
  for (const idx of rootIndices) {
    const a = sorted[idx]!
    let slotKey: string
    if (!a.parallelGroupId) {
      slotKey = `root:${nextRootSlot++}`
    } else {
      const session = actionSessionKey(a)
      const isParentTaskEntry = a.actionType === 'Subagent' && a.source !== 'child-session' && Boolean(a.callID)
      const groupKey = isParentTaskEntry ? a.parallelGroupId : `${session}::${a.parallelGroupId}`
      const lane = a.parallelLaneIndex ?? 0
      let laneCounter = rootGroupLaneStepCounter.get(groupKey)
      if (!laneCounter) {
        laneCounter = new Map<number, number>()
        rootGroupLaneStepCounter.set(groupKey, laneCounter)
      }
      const step = laneCounter.get(lane) ?? 0
      laneCounter.set(lane, step + 1)

      let stepSlots = rootGroupStepToSlot.get(groupKey)
      if (!stepSlots) {
        stepSlots = new Map<number, string>()
        rootGroupStepToSlot.set(groupKey, stepSlots)
      }
      if (!stepSlots.has(step)) stepSlots.set(step, `root:${nextRootSlot++}`)
      slotKey = stepSlots.get(step)!
    }
    rootSlotByIndex.set(idx, slotKey)
    let list = rootSlotIndices.get(slotKey)
    if (!list) {
      list = []
      rootSlotIndices.set(slotKey, list)
    }
    list.push(idx)
  }

  /**
   * 子 session 局部轴（相对偏移）：
   * - 每个子 session 仅按自身动作推进；
   * - 记录 childSpan，用于扩展父 task 所在 slot 的有效右边界。
   */
  const childLocalXByIndex = new Map<number, number>()
  const childSpanByCallID = new Map<string, number>()
  for (const childSession of childKeys) {
    const callID = childSession.slice('session:task:'.length)
    const childIndices = sorted
      .map((a, idx) => ({ a, idx }))
      .filter((x) => x.a.source === 'child-session' && actionSessionKey(x.a) === childSession)
      .map((x) => x.idx)
    if (childIndices.length === 0) {
      childSpanByCallID.set(callID, 0)
      continue
    }
    const childSlotByIndex = new Map<number, string>()
    const childGroupStepToSlot = new Map<string, Map<number, string>>()
    const childGroupLaneStepCounter = new Map<string, Map<number, number>>()
    let nextChildSlot = 0
    for (const idx of childIndices) {
      const a = sorted[idx]!
      let slotKey: string
      if (!a.parallelGroupId) {
        slotKey = `child:${nextChildSlot++}`
      } else {
        const groupKey = a.parallelGroupId
        const lane = a.parallelLaneIndex ?? 0
        let laneCounter = childGroupLaneStepCounter.get(groupKey)
        if (!laneCounter) {
          laneCounter = new Map<number, number>()
          childGroupLaneStepCounter.set(groupKey, laneCounter)
        }
        const step = laneCounter.get(lane) ?? 0
        laneCounter.set(lane, step + 1)
        let stepSlots = childGroupStepToSlot.get(groupKey)
        if (!stepSlots) {
          stepSlots = new Map<number, string>()
          childGroupStepToSlot.set(groupKey, stepSlots)
        }
        if (!stepSlots.has(step)) stepSlots.set(step, `child:${nextChildSlot++}`)
        slotKey = stepSlots.get(step)!
      }
      childSlotByIndex.set(idx, slotKey)
    }

    const childSlotWidth = new Map<string, number>()
    for (const idx of childIndices) {
      const slotKey = childSlotByIndex.get(idx)
      if (!slotKey) continue
      const w = blockWidth(durationMode, sorted[idx]!.durationMs)
      childSlotWidth.set(slotKey, Math.max(childSlotWidth.get(slotKey) ?? 0, w))
    }
    const childSlotStartX = new Map<string, number>()
    let childCursor = 0
    for (let s = 0; s < nextChildSlot; s++) {
      const slotKey = `child:${s}`
      childSlotStartX.set(slotKey, childCursor)
      childCursor += (childSlotWidth.get(slotKey) ?? MIN_W) + TIMELINE_STEP_GAP
    }
    for (const idx of childIndices) {
      const slotKey = childSlotByIndex.get(idx)
      childLocalXByIndex.set(idx, slotKey ? (childSlotStartX.get(slotKey) ?? 0) : 0)
    }
    const childSpanRight = Math.max(0, childCursor - TIMELINE_STEP_GAP)
    childSpanByCallID.set(callID, childSpanRight)
  }

  /** 根轴每个 slot 的有效跨度：max(父块宽, 父task->子session全程宽) */
  const rootSlotEffectiveSpan = new Map<string, number>()
  for (const [slotKey, indices] of rootSlotIndices.entries()) {
    let span = MIN_W
    for (const idx of indices) {
      const a = sorted[idx]!
      const w = blockWidth(durationMode, a.durationMs)
      span = Math.max(span, w)
      if (a.actionType === 'Subagent' && a.source !== 'child-session' && a.callID) {
        const childSpan = childSpanByCallID.get(a.callID) ?? 0
        span = Math.max(span, w + TIMELINE_STEP_GAP + childSpan)
      }
    }
    rootSlotEffectiveSpan.set(slotKey, span)
  }

  const rootSlotStartX = new Map<string, number>()
  let rootCursor = MARGIN_LEFT
  for (let s = 0; s < nextRootSlot; s++) {
    const slotKey = `root:${s}`
    rootSlotStartX.set(slotKey, rootCursor)
    rootCursor += (rootSlotEffectiveSpan.get(slotKey) ?? MIN_W) + TIMELINE_STEP_GAP
  }
  for (const idx of rootIndices) {
    const slotKey = rootSlotByIndex.get(idx)
    if (!slotKey) continue
    actionXBySortedIndex.set(idx, rootSlotStartX.get(slotKey) ?? MARGIN_LEFT)
  }

  /** 子 session 绝对 x = 父task右缘 + gap + 本地相对x */
  for (const childSession of childKeys) {
    const callID = childSession.slice('session:task:'.length)
    const parentIdx = sorted.findIndex(
      (a) => a.actionType === 'Subagent' && a.source !== 'child-session' && a.callID === callID
    )
    if (parentIdx < 0) continue
    const parent = sorted[parentIdx]!
    const parentX = actionXBySortedIndex.get(parentIdx) ?? MARGIN_LEFT
    const parentRight = parentX + blockWidth(durationMode, parent.durationMs)
    const childBaseX = parentRight + TIMELINE_STEP_GAP
    const childIndices = sorted
      .map((a, idx) => ({ a, idx }))
      .filter((x) => x.a.source === 'child-session' && actionSessionKey(x.a) === childSession)
      .map((x) => x.idx)
    for (const idx of childIndices) {
      actionXBySortedIndex.set(idx, childBaseX + (childLocalXByIndex.get(idx) ?? 0))
    }
  }

  /**
   * Fork 新分支：作为根轴上 anchor 右缘 + gap 起算的独立 x 轨。
   * - 与 anchor 之后的「灰色幽灵后缀」共享相同的起点 x，但在不同 session 区域（垂直分开），
   *   形成「同一 SVG 内的两条平行支线」视觉效果。
   * - 若没有显式 anchor 或没有任何幽灵动作，回退到主轴右端起算。
   */
  let forkBranchRight = MARGIN_LEFT
  if (hasForkNewBranch) {
    /** 1. 解析 anchor 在主轴上的右缘 */
    let anchorRight: number | null = null
    if (forkAnchorActionKey) {
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i]!
        if (actionKey(a) === forkAnchorActionKey) {
          const x = actionXBySortedIndex.get(i)
          if (x != null) anchorRight = x + blockWidth(durationMode, a.durationMs)
          break
        }
      }
    }
    if (anchorRight == null) {
      /** 兜底：取主轴最右非 fork-new-branch 动作的右缘 */
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i]!
        if (actionSessionKey(a) === 'session:fork-new-branch') continue
        const x = actionXBySortedIndex.get(i)
        if (x == null) continue
        const r = x + blockWidth(durationMode, a.durationMs)
        if (anchorRight == null || r > anchorRight) anchorRight = r
      }
    }
    const forkBaseX = (anchorRight ?? MARGIN_LEFT) + TIMELINE_STEP_GAP

    /** 2. fork-new-branch 内部本地 x（按 sortTime 顺序，与子 session 类似的 slot 结构，复用 parallelGroupId/laneIndex） */
    const branchIndices = sorted
      .map((a, idx) => ({ a, idx }))
      .filter((x) => actionSessionKey(x.a) === 'session:fork-new-branch')
      .map((x) => x.idx)

    const branchSlotByIndex = new Map<number, string>()
    const branchGroupStepToSlot = new Map<string, Map<number, string>>()
    const branchGroupLaneStepCounter = new Map<string, Map<number, number>>()
    let nextBranchSlot = 0
    for (const idx of branchIndices) {
      const a = sorted[idx]!
      let slotKey: string
      if (!a.parallelGroupId) {
        slotKey = `branch:${nextBranchSlot++}`
      } else {
        const groupKey = a.parallelGroupId
        const lane = a.parallelLaneIndex ?? 0
        let laneCounter = branchGroupLaneStepCounter.get(groupKey)
        if (!laneCounter) {
          laneCounter = new Map<number, number>()
          branchGroupLaneStepCounter.set(groupKey, laneCounter)
        }
        const step = laneCounter.get(lane) ?? 0
        laneCounter.set(lane, step + 1)
        let stepSlots = branchGroupStepToSlot.get(groupKey)
        if (!stepSlots) {
          stepSlots = new Map<number, string>()
          branchGroupStepToSlot.set(groupKey, stepSlots)
        }
        if (!stepSlots.has(step)) stepSlots.set(step, `branch:${nextBranchSlot++}`)
        slotKey = stepSlots.get(step)!
      }
      branchSlotByIndex.set(idx, slotKey)
    }
    const branchSlotWidth = new Map<string, number>()
    for (const idx of branchIndices) {
      const slotKey = branchSlotByIndex.get(idx)
      if (!slotKey) continue
      const w = blockWidth(durationMode, sorted[idx]!.durationMs)
      branchSlotWidth.set(slotKey, Math.max(branchSlotWidth.get(slotKey) ?? 0, w))
    }
    const branchSlotStartX = new Map<string, number>()
    let branchCursor = 0
    for (let s = 0; s < nextBranchSlot; s++) {
      const slotKey = `branch:${s}`
      branchSlotStartX.set(slotKey, branchCursor)
      branchCursor += (branchSlotWidth.get(slotKey) ?? MIN_W) + TIMELINE_STEP_GAP
    }
    for (const idx of branchIndices) {
      const slotKey = branchSlotByIndex.get(idx)
      const localX = slotKey ? (branchSlotStartX.get(slotKey) ?? 0) : 0
      actionXBySortedIndex.set(idx, forkBaseX + localX)
    }
    forkBranchRight = forkBaseX + Math.max(0, branchCursor - TIMELINE_STEP_GAP)
  }

  /**
   * 两条支线各自的 end x：
   *  - main：根轴当前游标（rootCursor 已经是「最右 root slot 的右缘 + TIMELINE_STEP_GAP」）
   *  - fork-new-branch：分支右缘 + 一段 gap
   */
  const endXMain = rootCursor
  const endXForkBranch = hasForkNewBranch ? forkBranchRight + TIMELINE_STEP_GAP : rootCursor

  const sessionTopY = new Map<string, number>()
  let sessionY = TOP_PAD
  for (const session of sessionOrder) {
    sessionTopY.set(session, sessionY)
    const local = sorted.filter((a) => actionSessionKey(a) === session)
    let maxBottom = BLOCK_H
    for (const a of local) {
      const yInSession =
        actionLocalRowForLayout(a) * ROW_H +
        laneOffsetY(a.parallelLaneIndex) +
        (a.forkCompareRow ?? 0) * FORK_COMPARE_ROW_GAP
      maxBottom = Math.max(maxBottom, yInSession + BLOCK_H)
    }
    sessionY += maxBottom + SESSION_REGION_GAP
  }
  const totalH = Math.max(
    sessionY - SESSION_REGION_GAP + BOTTOM_PAD,
    TOP_PAD + BLOCK_H + BOTTOM_PAD,
    MIN_SVG_CONTENT_HEIGHT
  )

  const layout: FlowLayoutItem[] = []

  for (let i = 0; i < seq.length; i++) {
    const node = seq[i]!
    if (node.kind === 'end') {
      const w = MIN_W
      /**
       * 每条支线 end 各占自己泳道的第一行：
       *  - sessionRegion='main' → 历史轨迹的 end（普通模式 / 历史灰端）
       *  - sessionRegion='fork-new-branch' → 新分支的 end
       */
      const isForkEnd = node.sessionRegion === 'fork-new-branch'
      const xNode = isForkEnd ? endXForkBranch : endXMain
      const regionKey = isForkEnd ? 'session:fork-new-branch' : 'session:main'
      const y = sessionTopY.get(regionKey) ?? sessionTopY.get('session:main') ?? TOP_PAD
      const cy = y + BLOCK_H / 2
      layout.push({ node, x: xNode, y, w, h: BLOCK_H, cx: xNode + w / 2, cy })
    } else {
      const a = node as MappedAction & { row: number }
      const w = blockWidth(durationMode, a.durationMs)
      const xNode = actionXBySortedIndex.get(i) ?? MARGIN_LEFT
      const session = actionSessionKey(a)
      const yBase = sessionTopY.get(session) ?? TOP_PAD
      const y =
        yBase +
        actionLocalRowForLayout(a) * ROW_H +
        laneOffsetY(a.parallelLaneIndex) +
        (a.forkCompareRow ?? 0) * FORK_COMPARE_ROW_GAP
      const cy = y + BLOCK_H / 2
      layout.push({ node, x: xNode, y, w, h: BLOCK_H, cx: xNode + w / 2, cy })
    }
  }

  const maxActionRight = sorted.reduce((maxR, a, idx) => {
    const x = actionXBySortedIndex.get(idx) ?? MARGIN_LEFT
    const w = blockWidth(durationMode, a.durationMs)
    return Math.max(maxR, x + w)
  }, MARGIN_LEFT)
  const totalTimelineRight = includeEndNode
    ? Math.max(maxActionRight, endXMain + MIN_W, endXForkBranch + MIN_W)
    : maxActionRight
  const totalW = Math.max(totalTimelineRight + MARGIN_LEFT, 360)
  return { layout, totalW, totalH }
}

function parallelSiblingSkip(pa: MappedAction, pb: MappedAction): boolean {
  if (!pa.parallelGroupId || !pb.parallelGroupId) return false
  if (pa.parallelGroupId !== pb.parallelGroupId) return false
  if (pa.parallelLaneIndex === undefined || pb.parallelLaneIndex === undefined) return false
  return pa.parallelLaneIndex !== pb.parallelLaneIndex
}

function appendOrthoEdge(
  content: d3.Selection<SVGGElement, unknown, null, undefined>,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  markerUrl: string,
  stroke: string,
  strokeWidth: number,
  /** 联动用：from / to action key（end 节点等无 key 时传 null） */
  fromKey: string | null = null,
  toKey: string | null = null
) {
  const mid = (x1 + x2) / 2
  const path = d3.path()
  path.moveTo(x1, y1)
  path.lineTo(mid, y1)
  path.lineTo(mid, y2)
  path.lineTo(x2, y2)
  const p = content
    .append('path')
    .attr('class', 'afv-edge')
    .attr('d', path.toString())
    .attr('fill', 'none')
    .attr('stroke', stroke)
    .attr('stroke-width', strokeWidth)
    .attr('marker-end', markerUrl)
    /** 避免边线盖住 action rect，否则悬停/右键命中 path 而非 rect */
    .attr('pointer-events', 'none')
  if (fromKey) p.attr('data-from-key', fromKey)
  if (toKey) p.attr('data-to-key', toKey)
}

function joinStrokeForFanIn(
  from: MappedAction & { row: number },
  to: FlowNode,
  markerUrl: string,
  ghostMarkerUrl: string
): { stroke: string; markerUrl: string } {
  if (to.kind === 'end') {
    return {
      stroke: from.forkGhost ? FORK_GHOST_STROKE : actionFlowPalette.arrow,
      markerUrl: from.forkGhost ? ghostMarkerUrl : markerUrl,
    }
  }
  return edgeStrokeAndMarker(from, to as MappedAction & { row: number }, markerUrl, ghostMarkerUrl)
}

/**
 * 多条边汇入同一后继：共享同一竖直线 x = bundleX（位于最右前驱出口与后继左缘之间），再水平接入后继。
 */
function appendOrthoFanIn(
  content: d3.Selection<SVGGElement, unknown, null, undefined>,
  sources: FlowLayoutItem[],
  target: FlowLayoutItem,
  markerUrl: string,
  ghostMarkerUrl: string
) {
  if (sources.length === 0) return
  const targetKey =
    target.node.kind === 'action'
      ? actionKey(target.node as MappedAction & { row: number })
      : null
  if (sources.length === 1) {
    const s = sources[0]!
    const na = s.node as MappedAction & { row: number }
    const { stroke, markerUrl: m } = joinStrokeForFanIn(na, target.node, markerUrl, ghostMarkerUrl)
    appendOrthoEdge(
      content,
      s.x + s.w,
      s.cy,
      target.x,
      target.cy,
      m,
      stroke,
      1.2,
      actionKey(na),
      targetKey,
    )
    return
  }
  const maxEnd = Math.max(...sources.map(s => s.x + s.w))
  const bundleX = (maxEnd + target.x) / 2
  for (const s of sources) {
    const na = s.node as MappedAction & { row: number }
    const { stroke, markerUrl: m } = joinStrokeForFanIn(na, target.node, markerUrl, ghostMarkerUrl)
    const path = d3.path()
    path.moveTo(s.x + s.w, s.cy)
    path.lineTo(bundleX, s.cy)
    path.lineTo(bundleX, target.cy)
    path.lineTo(target.x, target.cy)
    const p = content
      .append('path')
      .attr('class', 'afv-edge')
      .attr('d', path.toString())
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1.2)
      .attr('marker-end', m)
      .attr('pointer-events', 'none')
      .attr('data-from-key', actionKey(na))
    if (targetKey) p.attr('data-to-key', targetKey)
  }
}

interface Props {
  actions: (MappedAction & { row: number })[]
  durationMode: boolean
  colorMode: 'status' | 'tokens'
  /**
   * 突出「更耗时」：仅当 `durationMs >= durationHighlightMinMs` 时保持正常亮度；
   * 更短的 action 暗化（与 `durationMode` / `colorMode` 无关）。
   */
  durationHighlightMinMs?: number | null
  /** 有阈值时自动滚动到第一个命中的 action（默认 true） */
  autoScrollFirstFilteredMatch?: boolean
  /**
   * 与 action 对应的原文查找表：须为 `segmentMessages` 与 `childBranchMessages` 的合并
   *（见 `mergeMessagesForActionTooltipLookup`），以便用 `partId` 对齐 rect 与 `OcMessagePart`。
   */
  tooltipMessages?: OcMessage[]
  onForkFromAction?: (action: MappedAction & { row: number }) => void
  onAnalyzeFromAction?: (action: MappedAction & { row: number }) => void
  /** 仅用于 UI 假数据演示：在某个 action 位置视觉分叉 */
  mockBranchForkActionIndex?: number
  /**
   * 为 false 时不绘制终点黄点（仍有 running/pending 的 action 时）。
   * 默认 true。
   */
  showFlowEndNode?: boolean
  /** 终点黄点悬停摘要；建议与 `showFlowEndNode` 同时传入 */
  flowEndSummary?: FlowEndSummary
  /** 嵌在父级双栏容器内时去掉内层描边，避免重复边框 */
  embedded?: boolean
  /** 限制可视区高度（px），用于上下分栏时每条 lane 固定高度可滚动 */
  viewportMaxHeight?: number
  /**
   * 为 true 时用 CSS 隐藏滚动条（仍可用滚轮滚动）。默认 false，保留系统滚动条以便可见溢出。
   */
  hideScrollbar?: boolean
  /**
   * 与左侧 treemap 联动：type-level 选中。匹配的 action group 保持原样，其他 group dim。
   */
  highlightedActionType?: string | null
  /**
   * 与左侧 treemap 联动：action-level 选中（单个 action 的 actionKey）。
   * 优先级高于 highlightedActionType；命中时仅该 action 高亮，其他暗化。
   */
  highlightedActionKey?: string | null
  /** 选中位于其他子任务时，本 ActionFlow 整体 dim */
  dimAll?: boolean
  /** ActionFlow rect 单击 → action-level 选中 */
  onSelectAction?: (actionKey: string | null) => void
  /**
   * Fork 对比模式：与 `actions` 中带 `forkCompareRow === 2` 的「新分支」动作配合 —
   * 传入 fork 锚点 action 的 `actionKey()`，layout 会从锚点右缘起算新分支独立 x 轨，
   * 并在锚点 → 第一条新分支动作之间绘制专门的「下沉」分叉边。
   */
  forkAnchorActionKey?: string | null
}

export default function ActionFlowVisualization({
  actions,
  durationMode,
  colorMode,
  durationHighlightMinMs = null,
  autoScrollFirstFilteredMatch = true,
  tooltipMessages,
  onForkFromAction,
  onAnalyzeFromAction,
  mockBranchForkActionIndex,
  showFlowEndNode = true,
  flowEndSummary,
  embedded = false,
  viewportMaxHeight,
  hideScrollbar = false,
  highlightedActionType = null,
  highlightedActionKey = null,
  dimAll = false,
  onSelectAction,
  forkAnchorActionKey = null,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ActionFlowContextMenuState | null>(null)
  const reactId = useId().replace(/:/g, '')
  const markerId = `action-flow-arrow-${reactId}`
  const tooltipId = `action-flow-tip-${reactId}`
  const layoutEstimate = useMemo(
    () => computeLayout(actions, durationMode, { includeEndNode: showFlowEndNode, forkAnchorActionKey }),
    [actions, durationMode, showFlowEndNode, forkAnchorActionKey]
  )

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const root = d3.select(svg)
    root.selectAll('*').remove()

    const maxTok = Math.max(1, ...actions.map(a => a.tokenEstimate))
    const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, maxTok])

    const { layout, totalW, totalH } = computeLayout(actions, durationMode, {
      includeEndNode: showFlowEndNode,
      forkAnchorActionKey,
    })
    /** 是否处于 fork 对比模式：layout 中存在新分支动作 */
    const hasForkNewBranchInLayout = layout.some(
      (item) => item.node.kind === 'action' && actionSessionKey(item.node as MappedAction & { row: number }) === 'session:fork-new-branch'
    )
    const offsetY = verticalCenterOffsetY(layout, totalH)
    const highlightActive =
      durationHighlightMinMs != null && Number.isFinite(durationHighlightMinMs)

    const defs = root.append('defs')
    defs
      .append('marker')
      .attr('id', markerId)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', actionFlowPalette.arrow)

    const markerUrl = `url(#${markerId})`
    const ghostMarkerId = `action-flow-arrow-ghost-${reactId}`
    const ghostMarkerUrl = `url(#${ghostMarkerId})`
    defs
      .append('marker')
      .attr('id', ghostMarkerId)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 8)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', FORK_GHOST_MARKER_FILL)

    const canMockFork =
      typeof mockBranchForkActionIndex === 'number' &&
      mockBranchForkActionIndex >= 0 &&
      mockBranchForkActionIndex < actions.length
    const extraTopRows = canMockFork ? 1 : 0
    const topOffset = extraTopRows * ROW_H

    const content = root.append('g').attr('transform', `translate(0, ${offsetY + topOffset})`)
    const contentNode = content.node() as SVGGElement | null

    /** 并行多 lane 汇入同一后继时由 `appendOrthoFanIn` 绘制，此处跳过避免重复折线 */
    const parallelJoinSkip = new Set<string>()

    /** 并行组：lane 内连线、前驱→各 lane 首、各 lane 末→后继（多源汇入同一 bundleX） */
    const groupIdToIndices = new Map<string, number[]>()
    for (let i = 0; i < layout.length; i++) {
      const item = layout[i]!
      if (item.node.kind !== 'action') continue
      const act = item.node as MappedAction & { row: number }
      const gid = act.parallelGroupId
      if (!gid) continue
      let arr = groupIdToIndices.get(gid)
      if (!arr) {
        arr = []
        groupIdToIndices.set(gid, arr)
      }
      arr.push(i)
    }
    for (const indices of groupIdToIndices.values()) {
      if (indices.length < 2) continue
      const groupActions = indices.map((idx) => ({
        idx,
        node: layout[idx]!.node as MappedAction & { row: number },
      }))
      const groupMinT = Math.min(...groupActions.map((g) => g.node.sortTime))
      const groupMaxT = Math.max(...groupActions.map((g) => g.node.sortTime))
      const indexSet = new Set(indices)

      /** 并行组的前驱/后继搜索须限制在同一 session 区域（避免跨越 fork 分叉） */
      const groupSession = actionSessionKey(groupActions[0]!.node)
      let predItem: (typeof layout)[0] | undefined
      let predIdx = -1
      for (let i = 0; i < layout.length - 1; i++) {
        const it = layout[i]!
        if (it.node.kind !== 'action') continue
        const na = it.node as MappedAction & { row: number }
        if (actionSessionKey(na) !== groupSession) continue
        if (na.sortTime < groupMinT) {
          predItem = it
          predIdx = i
        }
      }

      let succItem: (typeof layout)[0] | undefined
      let succIdx = -1
      for (let i = 0; i < layout.length; i++) {
        if (indexSet.has(i)) continue
        const it = layout[i]!
        if (it.node.kind !== 'action') continue
        const na = it.node as MappedAction & { row: number }
        if (actionSessionKey(na) !== groupSession) continue
        if (na.sortTime > groupMaxT) {
          succItem = it
          succIdx = i
          break
        }
      }
      if (succIdx < 0) {
        /**
         * 并行组没有显式后继时连到「自己泳道」的 end：
         *  - 普通模式：唯一一个 main end；
         *  - Fork 对比：main 组接 ghost end，fork-new-branch 组接 new branch end。
         */
        for (let i = 0; i < layout.length; i++) {
          if (indexSet.has(i)) continue
          const it = layout[i]!
          if (it.node.kind !== 'end') continue
          const endRegion =
            it.node.sessionRegion === 'fork-new-branch'
              ? 'session:fork-new-branch'
              : 'session:main'
          if (endRegion === groupSession) {
            succItem = it
            succIdx = i
            break
          }
        }
      }

      const byLane = new Map<number, number[]>()
      for (const idx of indices) {
        const act = layout[idx]!.node as MappedAction & { row: number }
        const lane = act.parallelLaneIndex ?? 0
        let list = byLane.get(lane)
        if (!list) {
          list = []
          byLane.set(lane, list)
        }
        list.push(idx)
      }

      const lastIndices: number[] = []
      for (const laneIndices of byLane.values()) {
        const sortedIdx = [...laneIndices].sort((a, b) => {
          const ta = (layout[a]!.node as MappedAction & { row: number }).sortTime
          const tb = (layout[b]!.node as MappedAction & { row: number }).sortTime
          return ta - tb
        })
        for (let i = 0; i < sortedIdx.length - 1; i++) {
          const fromIdx = sortedIdx[i]!
          const toIdx = sortedIdx[i + 1]!
          const na = layout[fromIdx]!.node as MappedAction & { row: number }
          const nb = layout[toIdx]!.node as MappedAction & { row: number }
          const { stroke: forkStroke, markerUrl: forkMarker } = edgeStrokeAndMarker(na, nb, markerUrl, ghostMarkerUrl)
          appendOrthoEdge(
            content,
            layout[fromIdx]!.x + layout[fromIdx]!.w,
            layout[fromIdx]!.cy,
            layout[toIdx]!.x,
            layout[toIdx]!.cy,
            forkMarker,
            forkStroke,
            1.2
          )
        }
        const firstIdx = sortedIdx[0]!
        if (predItem && predIdx >= 0 && predIdx + 1 !== firstIdx) {
          const na = layout[predIdx]!.node as MappedAction & { row: number }
          const nb = layout[firstIdx]!.node as MappedAction & { row: number }
          const { stroke: forkStroke, markerUrl: forkMarker } = edgeStrokeAndMarker(na, nb, markerUrl, ghostMarkerUrl)
          appendOrthoEdge(
            content,
            predItem.x + predItem.w,
            predItem.cy,
            layout[firstIdx]!.x,
            layout[firstIdx]!.cy,
            forkMarker,
            forkStroke,
            1.2
          )
        }
        lastIndices.push(sortedIdx[sortedIdx.length - 1]!)
      }

      if (succItem && succIdx >= 0 && lastIndices.length > 0) {
        for (const li of lastIndices) {
          parallelJoinSkip.add(`${li}-${succIdx}`)
        }
        appendOrthoFanIn(
          content,
          lastIndices.map((idx) => layout[idx]!),
          layout[succIdx]!,
          markerUrl,
          ghostMarkerUrl
        )
      }
    }

    for (let i = 0; i < layout.length - 1; i++) {
      const a = layout[i]!
      const b = layout[i + 1]!
      if (a.node.kind === 'action' && b.node.kind === 'action') {
        const pa = a.node as MappedAction & { row: number }
        const pb = b.node as MappedAction & { row: number }
        /**
         * Fork 比对：跨越「主轴 / 灰色幽灵」与「fork-new-branch」之间的隐式相邻边一律跳过。
         * - anchor → 第一条 new-branch 动作 由后续显式分叉边绘制（与父 task→子会话同款）；
         * - 末尾 ghost → 第一条 new-branch 不是真实连续关系（两条平行支线），不画。
         */
        const aInForkBranch = actionSessionKey(pa) === 'session:fork-new-branch'
        const bInForkBranch = actionSessionKey(pb) === 'session:fork-new-branch'
        if (aInForkBranch !== bInForkBranch) continue
        if (
          pa.actionType === 'Subagent' &&
          pa.childSessionID &&
          pa.callID &&
          pb.source === 'child-session' &&
          pb.parentTaskCallID === pa.callID &&
          pb.branchChildSessionID === pa.childSessionID
        ) {
          continue
        }
        if (parallelSiblingSkip(pa, pb)) continue
      }
      if (parallelJoinSkip.has(`${i}-${i + 1}`)) continue
      /**
       * 进入 end 节点的隐式相邻边一律跳过 —— end 的连接由后面「显式收尾」段统一画，
       * 既兼容普通模式（一个 end），也兼容 fork 对比（两个 end，各自只连本泳道最后一条 action）。
       */
      if (b.node.kind === 'end') continue
      const x1 = a.x + a.w
      const y1 = a.cy
      const x2 = b.x
      const y2 = b.cy
      const mid = (x1 + x2) / 2
      const path = d3.path()
      path.moveTo(x1, y1)
      path.lineTo(mid, y1)
      path.lineTo(mid, y2)
      path.lineTo(x2, y2)
      const { stroke: segStroke, markerUrl: segMarker } =
        a.node.kind === 'action' && b.node.kind === 'action'
          ? edgeStrokeAndMarker(
              a.node as MappedAction & { row: number },
              b.node as MappedAction & { row: number },
              markerUrl,
              ghostMarkerUrl
            )
          : { stroke: actionFlowPalette.arrow, markerUrl }
      const fromKey =
        a.node.kind === 'action' ? actionKey(a.node as MappedAction & { row: number }) : null
      const toKey =
        b.node.kind === 'action' ? actionKey(b.node as MappedAction & { row: number }) : null
      const p = content
        .append('path')
        .attr('class', 'afv-edge')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', segStroke)
        .attr('stroke-width', 1.2)
        .attr('marker-end', segMarker)
        .attr('pointer-events', 'none')
      if (fromKey) p.attr('data-from-key', fromKey)
      if (toKey) p.attr('data-to-key', toKey)
    }

    layout.forEach((item, layoutIndex) => {
      const { node, x: nx, y: ny, w, h } = item
      if (node.kind === 'end') {
        /**
         * Fork 对比模式下的「历史端」(sessionRegion='main' 且存在新分支) 用灰色圆，
         * 表示这是 fork 之前的旧轨迹收尾；新分支端 / 普通模式仍用 palette.end 黄色。
         * 历史端不显示 summary tooltip（数据是当下新 session 的，挂上去会误导）。
         */
        const isGhostEnd =
          node.sessionRegion === 'main' && hasForkNewBranchInLayout
        const fill = isGhostEnd ? '#E8E8E8' : actionFlowPalette.end.fill
        const stroke = isGhostEnd ? '#BFBFBF' : actionFlowPalette.end.stroke
        const endTip = !isGhostEnd && flowEndSummary ? buildFlowEndTooltipHtml(flowEndSummary) : ''
        const circle = content
          .append('circle')
          .attr('cx', nx + w / 2)
          .attr('cy', ny + h / 2)
          .attr('r', h / 2 - 2)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1.5)
          .style('cursor', endTip ? 'pointer' : 'default')
        if (endTip) {
          circle.attr('data-tooltip-id', tooltipId).attr('data-tooltip-html', endTip).attr('data-tooltip-place', 'left')
        }
        return
      }

      const act = node as MappedAction & { row: number }
      const isGhost = act.forkGhost === true
      const ghostError = isGhost && act.status === 'error'
      const matchesDurationHighlight =
        !highlightActive ||
        !Number.isFinite(act.durationMs) ||
        act.durationMs >= (durationHighlightMinMs as number)
      const tc = tokenColor(colorScale, act.tokenEstimate)
      const sc = effectiveStatusColors(act.status, act.durationMs)
      const errPalette = statusColors('error')
      const isChildBranch = act.source === 'child-session' && !isGhost

      let fill: string
      let stroke: string
      let iconFill: string
      if (ghostError) {
        fill = errPalette.fill
        stroke = errPalette.stroke
        iconFill = errPalette.icon
      } else if (isGhost) {
        fill = '#E8E8E8'
        stroke = '#CFCFCF'
        iconFill = '#A0A0A0'
      } else if (isChildBranch && colorMode === 'status') {
        fill = '#F3ECFA'
        stroke = '#8445BC'
        iconFill = '#6E38A0'
      } else {
        fill = colorMode === 'status' ? sc.fill : tc.fill
        stroke = colorMode === 'status' ? sc.stroke : tc.stroke
        iconFill = colorMode === 'status' ? sc.icon : actionFlowPalette.green.icon
      }

      /** 每个 action 包一个 group：data-action-type 用于 type-level dim；data-action-key 用于 action-level dim 与点击 */
      const ak = actionKey(act)
      const actionG = content
        .append('g')
        .attr('class', 'afv-action')
        .attr('data-action-type', act.actionType)
        .attr('data-action-key', ak)
      const rect = actionG
        .append('rect')
        .attr('x', nx)
        .attr('y', ny)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', 4)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', isGhost ? 1.5 : isChildBranch ? 1.65 : 1.5)
        .style('cursor', 'pointer')
        .attr('data-tooltip-id', tooltipId)
        .attr('data-tooltip-html', buildCompactActionTooltipHtml(act, tooltipMessages))
        .attr('data-tooltip-place', 'top')
      if (onSelectAction) {
        rect.on('click', (ev: MouseEvent) => {
          ev.stopPropagation()
          onSelectAction(ak)
        })
      }
      /** duration 不达标先标记，在统一 dim 流中处理（不再走 rect.opacity + 黑遮罩 + 蓝环的旧风格） */
      if (!matchesDurationHighlight) {
        actionG.attr('data-duration-dim', '1')
      }
      const durationMeta = durationWidthMeta(durationMode, act.durationMs)
      const overDurationThreshold = !isGhost && durationMeta.overThreshold
      const canContext =
        act.messageID && (onForkFromAction || onAnalyzeFromAction) && act.forkGhost !== true
      const rectEl = rect.node() as SVGRectElement
      if (canContext) {
        rect.on('contextmenu', (ev: Event) => {
          ev.preventDefault()
          ev.stopPropagation()
          setContextMenu({ anchorRect: rectEl.getBoundingClientRect(), action: act })
        })
      }

      if (
        !isGhost &&
        (act.status === 'running' || act.status === 'pending') &&
        colorMode === 'status'
      ) {
        rect.attr('class', sc.isLongRunning ? 'action-flow-running-long' : 'action-flow-running')
      }

      const actionGNode = actionG.node() as SVGGElement | null
      if (actionGNode) {
        appendActionFlowIcon(
          actionGNode,
          getActionFlowIconSvg(act.actionType),
          nx + w / 2,
          ny + h / 2,
          iconFill,
          `${reactId}-${layoutIndex}-`
        )
      }
      /** 旧的黑色 50% 遮罩已废弃，duration 不达标统一走 dim 流 */

      if (overDurationThreshold && w >= 66) {
        actionG
          .append('text')
          .attr('x', nx + 6)
          .attr('y', ny + 10)
          .attr('font-size', 9)
          .attr('font-weight', 700)
          .attr('fill', '#B45309')
          .attr('font-family', SVG_FONT_SANS)
          .text(`>${Math.round(DURATION_LINEAR_THRESHOLD_MS / 1000)}s`)
          .attr('pointer-events', 'none')
      }

      if (canContext && w >= MORE_BTN_MIN_W) {
        const moreG = actionG
          .append('g')
          .attr('class', 'action-flow-more')
          .style('cursor', 'pointer')
          .attr('data-tooltip-id', tooltipId)
          .attr('data-tooltip-html', buildActionTooltipHtml(act, tooltipMessages))
          .attr('data-tooltip-place', 'top')
        moreG
          .append('rect')
          .attr('x', nx + w - 20)
          .attr('y', ny + 2)
          .attr('width', 18)
          .attr('height', h - 4)
          .attr('fill', 'transparent')
          .attr('rx', 2)
        moreG
          .append('text')
          .attr('x', nx + w - 11)
          .attr('y', ny + h / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 12)
          .attr('font-weight', 700)
          .attr('fill', '#64748B')
          .attr('font-family', SVG_FONT_SANS)
          .text('⋯')
        moreG.on('click', (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
          setContextMenu({ anchorRect: rectEl.getBoundingClientRect(), action: act })
        })
        moreG.on('contextmenu', (ev: Event) => {
          ev.preventDefault()
          ev.stopPropagation()
          setContextMenu({ anchorRect: rectEl.getBoundingClientRect(), action: act })
        })
      }
    })

    /**
     * 显式「收尾」连线：每个 end 节点 ← 本泳道最右一条 action（按 x+w 取最右）。
     *  - 普通模式：唯一 main end ← 主会话最右 action。
     *  - Fork 对比：
     *      ghost end (sessionRegion='main') ← 主轴（含锚点 + 灰幽灵）最右 action；
     *      new branch end (sessionRegion='fork-new-branch') ← fork-new-branch 最右 action。
     *  - 已被并行组 fan-in 收走的 end 跳过（避免重复折线）。
     */
    for (let endIdx = 0; endIdx < layout.length; endIdx++) {
      const endItem = layout[endIdx]!
      if (endItem.node.kind !== 'end') continue
      const endRegion =
        endItem.node.sessionRegion === 'fork-new-branch'
          ? 'session:fork-new-branch'
          : 'session:main'
      let lastIdx = -1
      let lastRight = -Infinity
      for (let j = 0; j < layout.length; j++) {
        const it = layout[j]!
        if (it.node.kind !== 'action') continue
        const sess = actionSessionKey(it.node as MappedAction & { row: number })
        if (sess !== endRegion) continue
        const right = it.x + it.w
        if (right > lastRight) {
          lastRight = right
          lastIdx = j
        }
      }
      if (lastIdx < 0) continue
      if (parallelJoinSkip.has(`${lastIdx}-${endIdx}`)) continue
      const lastItem = layout[lastIdx]!
      const lastAct = lastItem.node as MappedAction & { row: number }
      const isGhostEnd = endRegion === 'session:main' && hasForkNewBranchInLayout
      const stroke = isGhostEnd || lastAct.forkGhost ? FORK_GHOST_STROKE : actionFlowPalette.arrow
      const marker = isGhostEnd || lastAct.forkGhost ? ghostMarkerUrl : markerUrl
      appendOrthoEdge(
        content,
        lastItem.x + lastItem.w,
        lastItem.cy,
        endItem.x,
        endItem.cy,
        marker,
        stroke,
        1.2,
        actionKey(lastAct),
        null,
      )
    }

    /**
     * Fork 对比显式分叉边：anchor → 第一条 fork-new-branch 动作。
     * 类似父 task → 子会话首节点的紫色分叉，但走「主轴右缘垂直下沉至新分支泳道」的折线。
     */
    if (hasForkNewBranchInLayout && forkAnchorActionKey) {
      let anchorItem: (typeof layout)[number] | undefined
      for (const item of layout) {
        if (item.node.kind !== 'action') continue
        if (actionKey(item.node as MappedAction & { row: number }) === forkAnchorActionKey) {
          anchorItem = item
          break
        }
      }
      let firstNewBranchItem: (typeof layout)[number] | undefined
      let firstNewBranchX = Infinity
      for (const item of layout) {
        if (item.node.kind !== 'action') continue
        const a = item.node as MappedAction & { row: number }
        if (actionSessionKey(a) !== 'session:fork-new-branch') continue
        if (item.x < firstNewBranchX) {
          firstNewBranchX = item.x
          firstNewBranchItem = item
        }
      }
      if (anchorItem && firstNewBranchItem) {
        const x1 = anchorItem.x + anchorItem.w
        const y1 = anchorItem.cy
        const x2 = firstNewBranchItem.x
        const y2 = firstNewBranchItem.cy
        const mid = (x1 + x2) / 2
        const branchPath = d3.path()
        branchPath.moveTo(x1, y1)
        branchPath.lineTo(mid, y1)
        branchPath.lineTo(mid, y2)
        branchPath.lineTo(x2, y2)
        const anchorAct = anchorItem.node as MappedAction & { row: number }
        const firstAct = firstNewBranchItem.node as MappedAction & { row: number }
        const p = content
          .append('path')
          .attr('class', 'afv-edge')
          .attr('d', branchPath.toString())
          .attr('fill', 'none')
          .attr('stroke', actionFlowPalette.arrow)
          .attr('stroke-width', 1.2)
          .attr('marker-end', markerUrl)
          .attr('pointer-events', 'none')
          .attr('data-from-key', actionKey(anchorAct))
          .attr('data-to-key', actionKey(firstAct))
        void p
      }
    }

    /** 父 Subagent(task) → 子会话首节点 的紫色分叉 */
    for (let i = 0; i < layout.length - 1; i++) {
      const item = layout[i]!
      const node = item.node
      if (node.kind !== 'action') continue
      if (node.actionType !== 'Subagent' || !node.childSessionID || !node.callID) continue
      let firstChild: (typeof layout)[0] | undefined
      for (let j = i + 1; j < layout.length - 1; j++) {
        const it = layout[j]!
        if (it.node.kind !== 'action') continue
        const a = it.node as MappedAction & { row: number }
        if (
          a.source === 'child-session' &&
          a.parentTaskCallID === node.callID &&
          a.branchChildSessionID === node.childSessionID
        ) {
          firstChild = it
          break
        }
      }
      if (!firstChild) continue
      const x1 = item.x + item.w
      const y1 = item.cy
      const x2 = firstChild.x
      const y2 = firstChild.cy
      const mid = (x1 + x2) / 2
      const branchPath = d3.path()
      branchPath.moveTo(x1, y1)
      branchPath.lineTo(mid, y1)
      branchPath.lineTo(mid, y2)
      branchPath.lineTo(x2, y2)
      const parentAct = node as MappedAction & { row: number }
      const childAct = firstChild.node as MappedAction & { row: number }
      const { stroke: branchStroke, markerUrl: branchMarker } = edgeStrokeAndMarker(
        parentAct,
        childAct,
        markerUrl,
        ghostMarkerUrl
      )
      content
        .append('path')
        .attr('d', branchPath.toString())
        .attr('fill', 'none')
        .attr('stroke', branchStroke)
        .attr('stroke-width', 1.2)
        .attr('marker-end', branchMarker)
        .attr('pointer-events', 'none')
    }

    if (canMockFork) {
      const forkItem = layout[mockBranchForkActionIndex as number]
      if (forkItem) {
        const historyTemplates = [
          { actionType: 'Think', status: 'completed', durationMs: 420, tokenEstimate: 24 },
          { actionType: 'Read', status: 'completed', durationMs: 560, tokenEstimate: 40 },
          { actionType: 'Response', status: 'completed', durationMs: 380, tokenEstimate: 28 },
        ] as const
        const historyY = rowTopY(0) - ROW_H + BLOCK_H / 2

        const historyWidths = historyTemplates.map(h => blockWidth(durationMode, h.durationMs))
        const historyStartX = forkItem.x + forkItem.w + GAP

        let hx = historyStartX
        historyTemplates.forEach((h, i) => {
          const hw = historyWidths[i]!
          content
            .append('rect')
            .attr('x', hx)
            .attr('y', historyY - BLOCK_H / 2)
            .attr('width', hw)
            .attr('height', BLOCK_H)
            .attr('rx', 4)
            .attr('fill', '#ECECEC')
            .attr('stroke', '#CFCFCF')
            .attr('stroke-width', 1.5)
            .style('cursor', 'default')

          if (contentNode) {
            appendActionFlowIcon(
              contentNode,
              getActionFlowIconSvg(h.actionType),
              hx + hw / 2,
              historyY,
              '#B5B5B5',
              `${reactId}-mock-history-${i}-`
            )
          }

          if (i < historyTemplates.length - 1) {
            const link = d3.path()
            link.moveTo(hx + hw, historyY)
            link.lineTo(hx + hw + GAP, historyY)
            content
              .append('path')
              .attr('d', link.toString())
              .attr('fill', 'none')
              .attr('stroke', '#C8C8C8')
              .attr('stroke-width', 1.2)
              .attr('marker-end', markerUrl)
              .attr('pointer-events', 'none')
          }
          hx += hw + GAP
        })

        const firstHistoryX = historyStartX
        // 与主流程边一致：水平 → 竖直 → 水平（中点取两端 x 的中点，避免出现斜线）
        const x1 = forkItem.x + forkItem.w
        const y1 = forkItem.cy
        const x2 = firstHistoryX
        const y2 = historyY
        const mid = (x1 + x2) / 2
        const connect = d3.path()
        connect.moveTo(x1, y1)
        connect.lineTo(mid, y1)
        connect.lineTo(mid, y2)
        connect.lineTo(x2, y2)
        content
          .append('path')
          .attr('d', connect.toString())
          .attr('fill', 'none')
          .attr('stroke', '#C8C8C8')
          .attr('stroke-width', 1.2)
          .attr('marker-end', markerUrl)
          .attr('pointer-events', 'none')
      }
    }

    const desiredH = totalH + topOffset
    // 关键：使用像素级固定画布，不用 viewBox 缩放，避免不同行数时 action 尺寸变化
    root.attr('width', totalW).attr('height', desiredH)
    svg.removeAttribute('viewBox')

    if (highlightActive && autoScrollFirstFilteredMatch) {
      const thr = durationHighlightMinMs as number
      const firstMatched = layout.find((item) => {
        if (item.node.kind !== 'action') return false
        const a = item.node as MappedAction & { row: number }
        return Number.isFinite(a.durationMs) && a.durationMs >= thr
      })
      if (firstMatched && scrollRef.current) {
        const targetLeft = Math.max(0, firstMatched.x - 18)
        scrollRef.current.scrollTo({ left: targetLeft, behavior: 'smooth' })
      }
    }
  }, [
    actions,
    durationMode,
    colorMode,
    durationHighlightMinMs,
    autoScrollFirstFilteredMatch,
    tooltipMessages,
    markerId,
    tooltipId,
    mockBranchForkActionIndex,
    onForkFromAction,
    onAnalyzeFromAction,
    showFlowEndNode,
    flowEndSummary,
    embedded,
    viewportMaxHeight,
    forkAnchorActionKey,
  ])

  /**
   * 统一 dim 流：合并 selection（type / action）、duration 过滤、跨子任务 dim_All。
   * - dimAll：整张 ActionFlow 整体降透（其他子任务正在被选中）
   * - selection：type 命中或 action 命中 → 不在命中集合的 group dim
   * - duration：data-duration-dim=1 的 group dim（旧蓝环 / 黑遮罩 已被替换为这套统一 dim）
   * - 连线：仅当至少一端在命中集合 → 不 dim；否则 dim
   * 命中规则：
   *   - 优先 highlightedActionKey（action 级）→ 命中集合 = { 该 key }
   *   - 否则 highlightedActionType（type 级）→ 命中集合 = data-action-type === t 的所有 key
   *   - 都无 → 命中集合 = null（不做联动 dim，仅 duration dim 生效）
   */
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.afv-action[data-action-key]'))
    const edges = Array.from(svg.querySelectorAll<SVGPathElement>('path.afv-edge'))
    const DIM = '0.18'

    if (dimAll) {
      svg.style.opacity = '0.35'
    } else {
      svg.style.opacity = ''
    }

    /** 命中集合（action 级直接是单 key；type 级聚合所有同 type 的 key） */
    let highlightSet: Set<string> | null = null
    if (highlightedActionKey) {
      highlightSet = new Set([highlightedActionKey])
    } else if (highlightedActionType) {
      highlightSet = new Set()
      for (const g of groups) {
        if (g.getAttribute('data-action-type') === highlightedActionType) {
          const k = g.getAttribute('data-action-key')
          if (k) highlightSet.add(k)
        }
      }
    }

    for (const g of groups) {
      const k = g.getAttribute('data-action-key') ?? ''
      const durationDim = g.getAttribute('data-duration-dim') === '1'
      const selDim = highlightSet !== null && !highlightSet.has(k)
      g.style.opacity = (selDim || durationDim) ? DIM : ''
    }

    for (const e of edges) {
      const fk = e.getAttribute('data-from-key')
      const tk = e.getAttribute('data-to-key')
      let dim = false
      if (highlightSet !== null) {
        const fromHit = fk !== null && highlightSet.has(fk)
        const toHit = tk !== null && highlightSet.has(tk)
        dim = !fromHit && !toHit
      }
      /** 连线也尊重 duration dim：两端都不达标则 dim */
      if (!dim && (fk || tk)) {
        const esc = (s: string) =>
          typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"')
        const fromGroup = fk ? svg.querySelector<SVGGElement>(`g.afv-action[data-action-key="${esc(fk)}"]`) : null
        const toGroup = tk ? svg.querySelector<SVGGElement>(`g.afv-action[data-action-key="${esc(tk)}"]`) : null
        const fromDur = fromGroup?.getAttribute('data-duration-dim') === '1'
        const toDur = toGroup?.getAttribute('data-duration-dim') === '1'
        if (fromDur && toDur) dim = true
      }
      e.style.opacity = dim ? DIM : ''
    }
  }, [highlightedActionType, highlightedActionKey, dimAll, actions, durationHighlightMinMs])

  const mockOffset = mockBranchForkActionIndex !== undefined ? ROW_H : 0
  const contentHeight = layoutEstimate.totalH + mockOffset
  /** 可视区域下限至少能容纳两行泳道，避免高度塌缩；上限仍限制最大可视高度，超出则内部滚动 */
  const maxVisibleHeight = Math.max(
    TOP_PAD + MAX_VISIBLE_ROWS * ROW_H + BLOCK_H + BOTTOM_PAD,
    MIN_SVG_CONTENT_HEIGHT
  )
  let viewportHeight = Math.min(Math.max(contentHeight, MIN_SVG_CONTENT_HEIGHT), maxVisibleHeight)
  if (typeof viewportMaxHeight === 'number' && Number.isFinite(viewportMaxHeight) && viewportMaxHeight > 0) {
    viewportHeight = Math.min(viewportHeight, viewportMaxHeight)
  }
  /** 仅作上限：内容较矮时不占满高度，避免「未溢出也出现滚动条」；超出 maxHeight 时才出现滚动条 */
  const scrollAreaMaxHeight = viewportHeight

  /** 内层滚动区不设 border：否则 box-sizing 下内容区 = maxHeight − 边框，易比 SVG 高度少 2px 而误出纵向条 */
  const scrollInner = (
    <div
      className={hideScrollbar ? 'action-flow-scroll--hide-scrollbar' : undefined}
      style={{
        boxSizing: 'border-box',
        overflowX: 'auto',
        overflowY: 'auto',
        width: '100%',
        height: 'auto',
        maxHeight: scrollAreaMaxHeight,
        minHeight: 0,
        flexShrink: 0,
      }}
      ref={scrollRef}
    >
      <svg
        ref={svgRef}
        style={{
          display: 'block',
          verticalAlign: 'top',
        }}
      />
    </div>
  )

  return (
    <>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        alignSelf: 'flex-start',
        width: '100%',
      }}
    >
      {embedded ? (
        scrollInner
      ) : (
        <div
          style={{
            boxSizing: 'border-box',
            border: '1px solid #E8E8E8',
            borderRadius: 8,
            background: '#FCFCFC',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          {scrollInner}
        </div>
      )}
      <Tooltip
        id={tooltipId}
        className="action-flow-react-tooltip"
        variant="light"
        delayShow={150}
        delayHide={220}
        opacity={1}
        clickable
        /** 内层 overflow:auto 滚动会触发全局 scroll，默认会立刻关掉 tooltip */
        globalCloseEvents={{ scroll: false, resize: true, escape: true }}
        arrowColor="#f8fafc"
      />
    </div>
    <ActionFlowContextMenu
      menu={contextMenu}
      onClose={() => setContextMenu(null)}
      onFork={onForkFromAction}
      onAnalysis={onAnalyzeFromAction}
    />
    </>
  )
}
