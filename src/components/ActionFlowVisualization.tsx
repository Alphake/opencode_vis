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

type FlowNode =
  | { kind: 'end'; row: number }
  | (MappedAction & { row: number; kind: 'action' })

const MARGIN_LEFT = 24
const GAP = 12
/**
 * 垂直布局（与 `actionMapping` 一致）：
 * - 每个 session 块内 2 个基础 layer：layer0 = kernel（Think/Response/Plan…），layer1 = 工具与父级 task rect；
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
  if (!durationMode) return MIN_W
  const w = 8 + durationMs / 40
  return Math.max(MIN_W, Number.isFinite(w) ? w : MIN_W)
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
 * - `session:main`：主会话内所有「父侧」动作（含 reason/text/todo、工具、以及 **父消息里的 task/Subagent rect**）。
 *   并行 task 在第二行内用 `parallelLaneIndex` 纵向堆叠，行数不固定。
 * - `session:task:<parentTaskCallID>`：**仅**子会话拉取的动作（`child-session`），叠在 main 下方；
 *   每个子 session 块高度由该块内 layer + 并行 lane 决定，可随子会话内并行变高。
 */
function actionSessionKey(a: MappedAction & { row: number }): string {
  if (a.source === 'child-session' && a.parentTaskCallID) {
    return `session:task:${a.parentTaskCallID}`
  }
  return 'session:main'
}

function actionLocalRow(a: MappedAction & { row: number }): number {
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
  const dur =
    Number.isFinite(act.durationMs) && act.durationMs > 0
      ? `${(act.durationMs / 1000).toFixed(2)}s`
      : '—'
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
  const dur =
    Number.isFinite(act.durationMs) && act.durationMs > 0
      ? `${(act.durationMs / 1000).toFixed(2)}s`
      : '—'
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
  layoutOpts?: { includeEndNode?: boolean }
) {
  const includeEndNode = layoutOpts?.includeEndNode !== false
  const sorted = [...actions].sort((a, b) => a.sortTime - b.sortTime)
  const seq: FlowNode[] = sorted.map(a => ({ ...a, kind: 'action' as const }))
  if (includeEndNode) {
    seq.push({ kind: 'end', row: 1 })
  }

  const actionColumns = new Map<number, number>()
  const groupStepToColumn = new Map<string, Map<number, number>>()
  const groupLaneStepCounter = new Map<string, Map<number, number>>()
  let nextColumn = 0
  sorted.forEach((a, idx) => {
    if (!a.parallelGroupId) {
      actionColumns.set(idx, nextColumn++)
      return
    }
    const gid = a.parallelGroupId
    const lane = a.parallelLaneIndex ?? 0
    let laneCounter = groupLaneStepCounter.get(gid)
    if (!laneCounter) {
      laneCounter = new Map<number, number>()
      groupLaneStepCounter.set(gid, laneCounter)
    }
    const step = laneCounter.get(lane) ?? 0
    laneCounter.set(lane, step + 1)

    let stepCols = groupStepToColumn.get(gid)
    if (!stepCols) {
      stepCols = new Map<number, number>()
      groupStepToColumn.set(gid, stepCols)
    }
    if (!stepCols.has(step)) stepCols.set(step, nextColumn++)
    actionColumns.set(idx, stepCols.get(step)!)
  })
  const endColumn = nextColumn

  const colMaxWidth = new Map<number, number>()
  sorted.forEach((a, idx) => {
    const c = actionColumns.get(idx)
    if (c === undefined) return
    const w = blockWidth(durationMode, a.durationMs)
    colMaxWidth.set(c, Math.max(colMaxWidth.get(c) ?? 0, w))
  })
  if (includeEndNode) {
    colMaxWidth.set(endColumn, Math.max(colMaxWidth.get(endColumn) ?? 0, MIN_W))
  }

  const colStartX = new Map<number, number>()
  let x = MARGIN_LEFT
  const lastColIndex = includeEndNode ? endColumn : nextColumn - 1
  for (let c = 0; c <= lastColIndex; c++) {
    colStartX.set(c, x)
    x += (colMaxWidth.get(c) ?? MIN_W) + GAP
  }

  const sessionKeySet = new Set<string>()
  sorted.forEach((a) => sessionKeySet.add(actionSessionKey(a)))
  const sessionOrder: string[] = []
  if (sessionKeySet.has('session:main')) sessionOrder.push('session:main')
  const childKeys = [...sessionKeySet].filter((k) => k !== 'session:main')
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
  if (sessionOrder.length === 0) sessionOrder.push('session:main')

  const sessionTopY = new Map<string, number>()
  let sessionY = TOP_PAD
  for (const session of sessionOrder) {
    sessionTopY.set(session, sessionY)
    const local = sorted.filter((a) => actionSessionKey(a) === session)
    let maxBottom = BLOCK_H
    for (const a of local) {
      const yInSession =
        actionLocalRow(a) * ROW_H +
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

  const layout: {
    node: FlowNode
    x: number
    y: number
    w: number
    h: number
    cx: number
    cy: number
  }[] = []

  for (let i = 0; i < seq.length; i++) {
    const node = seq[i]!
    if (node.kind === 'end') {
      const w = MIN_W
      const c = endColumn
      const x0 = colStartX.get(c) ?? MARGIN_LEFT
      const cw = colMaxWidth.get(c) ?? MIN_W
      const xNode = x0 + (cw - w) / 2
      /** 终点黄点固定在主会话第一行（kernel / layer 0） */
      const y = sessionTopY.get('session:main') ?? TOP_PAD
      const cy = y + BLOCK_H / 2
      layout.push({ node, x: xNode, y, w, h: BLOCK_H, cx: xNode + w / 2, cy })
    } else {
      const a = node as MappedAction & { row: number }
      const w = blockWidth(durationMode, a.durationMs)
      const c = actionColumns.get(i) ?? i
      const x0 = colStartX.get(c) ?? MARGIN_LEFT
      const cw = colMaxWidth.get(c) ?? w
      const xNode = x0 + (cw - w) / 2
      const session = actionSessionKey(a)
      const yBase = sessionTopY.get(session) ?? TOP_PAD
      const y =
        yBase +
        actionLocalRow(a) * ROW_H +
        laneOffsetY(a.parallelLaneIndex) +
        (a.forkCompareRow ?? 0) * FORK_COMPARE_ROW_GAP
      const cy = y + BLOCK_H / 2
      layout.push({ node, x: xNode, y, w, h: BLOCK_H, cx: xNode + w / 2, cy })
    }
  }

  const totalW = Math.max(x + MARGIN_LEFT, 360)
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
  strokeWidth: number
) {
  const mid = (x1 + x2) / 2
  const path = d3.path()
  path.moveTo(x1, y1)
  path.lineTo(mid, y1)
  path.lineTo(mid, y2)
  path.lineTo(x2, y2)
  content
    .append('path')
    .attr('d', path.toString())
    .attr('fill', 'none')
    .attr('stroke', stroke)
    .attr('stroke-width', strokeWidth)
    .attr('marker-end', markerUrl)
    /** 避免边线盖住 action rect，否则悬停/右键命中 path 而非 rect */
    .attr('pointer-events', 'none')
}

interface Props {
  actions: (MappedAction & { row: number })[]
  durationMode: boolean
  colorMode: 'status' | 'tokens'
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
}

export default function ActionFlowVisualization({
  actions,
  durationMode,
  colorMode,
  tooltipMessages,
  onForkFromAction,
  onAnalyzeFromAction,
  mockBranchForkActionIndex,
  showFlowEndNode = true,
  flowEndSummary,
  embedded = false,
  viewportMaxHeight,
  hideScrollbar = false,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ActionFlowContextMenuState | null>(null)
  const reactId = useId().replace(/:/g, '')
  const markerId = `action-flow-arrow-${reactId}`
  const tooltipId = `action-flow-tip-${reactId}`
  const layoutEstimate = useMemo(
    () => computeLayout(actions, durationMode, { includeEndNode: showFlowEndNode }),
    [actions, durationMode, showFlowEndNode]
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
    })
    const offsetY = verticalCenterOffsetY(layout, totalH)

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

    for (let i = 0; i < layout.length - 1; i++) {
      const a = layout[i]!
      const b = layout[i + 1]!
      if (a.node.kind === 'action' && b.node.kind === 'action') {
        const pa = a.node as MappedAction & { row: number }
        const pb = b.node as MappedAction & { row: number }
        const ra = pa.forkCompareRow ?? 0
        const rb = pb.forkCompareRow ?? 0
        if (ra !== rb) {
          const x1 = a.x + a.w
          const y1 = a.cy
          const x2 = b.x
          const y2 = b.cy
          let segStroke = FORK_GHOST_STROKE
          let segMarker = ghostMarkerUrl
          if (ra === 0 && rb === 2) {
            segStroke = actionFlowPalette.arrow
            segMarker = markerUrl
          } else if (ra === 1 && rb === 2) {
            segStroke = actionFlowPalette.arrow
            segMarker = markerUrl
          }
          appendOrthoEdge(content, x1, y1, x2, y2, segMarker, segStroke, 1.2)
          continue
        }
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
      content
        .append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', segStroke)
        .attr('stroke-width', 1.2)
        .attr('marker-end', segMarker)
        .attr('pointer-events', 'none')
    }

    /** 并行组：前驱分叉到各 lane 首节点、各 lane 末节点汇合到后继 */
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

      let predItem: (typeof layout)[0] | undefined
      let predIdx = -1
      for (let i = 0; i < layout.length - 1; i++) {
        const it = layout[i]!
        if (it.node.kind !== 'action') continue
        const na = it.node as MappedAction & { row: number }
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
        if (na.sortTime > groupMaxT) {
          succItem = it
          succIdx = i
          break
        }
      }
      if (succIdx < 0) {
        for (let i = 0; i < layout.length; i++) {
          if (indexSet.has(i)) continue
          const it = layout[i]!
          if (it.node.kind === 'end') {
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
      for (const laneIndices of byLane.values()) {
        const sortedIdx = [...laneIndices].sort((a, b) => {
          const ta = (layout[a]!.node as MappedAction & { row: number }).sortTime
          const tb = (layout[b]!.node as MappedAction & { row: number }).sortTime
          return ta - tb
        })
        // 同一并行 lane 内部必须保持连续连线，避免因全局相邻关系被打断而出现“中间断线”。
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
        const lastIdx = sortedIdx[sortedIdx.length - 1]!
        if (succItem && succIdx >= 0 && lastIdx + 1 !== succIdx) {
          const na = layout[lastIdx]!.node as MappedAction & { row: number }
          const succNode = layout[succIdx]!.node
          let forkStroke: string
          let forkMarker: string
          if (succNode.kind === 'end') {
            forkStroke = na.forkGhost ? FORK_GHOST_STROKE : actionFlowPalette.arrow
            forkMarker = na.forkGhost ? ghostMarkerUrl : markerUrl
          } else {
            const e = edgeStrokeAndMarker(na, succNode as MappedAction & { row: number }, markerUrl, ghostMarkerUrl)
            forkStroke = e.stroke
            forkMarker = e.markerUrl
          }
          appendOrthoEdge(
            content,
            layout[lastIdx]!.x + layout[lastIdx]!.w,
            layout[lastIdx]!.cy,
            succItem.x,
            succItem.cy,
            forkMarker,
            forkStroke,
            1.2
          )
        }
      }
    }

    layout.forEach((item, layoutIndex) => {
      const { node, x: nx, y: ny, w, h } = item
      if (node.kind === 'end') {
        const endTip = flowEndSummary ? buildFlowEndTooltipHtml(flowEndSummary) : ''
        const circle = content
          .append('circle')
          .attr('cx', nx + w / 2)
          .attr('cy', ny + h / 2)
          .attr('r', h / 2 - 2)
          .attr('fill', actionFlowPalette.end.fill)
          .attr('stroke', actionFlowPalette.end.stroke)
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

      const rect = content
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

      if (contentNode) {
        appendActionFlowIcon(
          contentNode,
          getActionFlowIconSvg(act.actionType),
          nx + w / 2,
          ny + h / 2,
          iconFill,
          `${reactId}-${layoutIndex}-`
        )
      }

      if (canContext && w >= MORE_BTN_MIN_W) {
        const moreG = content
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
      const parentGhost = parentAct.forkGhost
      const childGhost = childAct.forkGhost
      const { stroke: branchStroke, markerUrl: branchMarker } =
        parentGhost || childGhost
          ? { stroke: FORK_GHOST_STROKE, markerUrl: ghostMarkerUrl }
          : { stroke: '#8445BC', markerUrl: markerUrl }
      content
        .append('path')
        .attr('d', branchPath.toString())
        .attr('fill', 'none')
        .attr('stroke', branchStroke)
        .attr('stroke-width', 1.75)
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
  }, [
    actions,
    durationMode,
    colorMode,
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
  ])

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
