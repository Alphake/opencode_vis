import { useLayoutEffect, useRef, useId } from 'react'
import * as d3 from 'd3'
import { Tooltip } from 'react-tooltip'
import type { ActionStatus, MappedAction } from '../types/opencode'
import { actionFlowPalette } from '../styles/actionFlowPalette'
import { appendActionFlowIcon, getActionFlowIconSvg } from './actionFlowIcons'

type FlowNode =
  | { kind: 'end'; row: number }
  | (MappedAction & { row: number; kind: 'action' })

const MARGIN_LEFT = 24
const GAP = 12
/**
 * 垂直布局（与 `actionMapping` 一致：父段 row 0–2；子会话分支为第 4 轨 row=3）：
 * - 画布总高 = TOP_PAD + maxRowIndex * ROW_H + BLOCK_H + BOTTOM_PAD
 */
const BLOCK_H = 28
const ROW_H = 32
const TOP_PAD = 4
/** 无子会话时父段 row 最大为 2 */
const DEFAULT_MAX_ROW_INDEX = 2
const MIN_W = 28
const MAX_W = 220
const BOTTOM_PAD = 6
/** 视口上限：约 4 行（含上下 padding） */
const MAX_VISIBLE_ROWS = 4

function blockWidth(durationMode: boolean, durationMs: number): number {
  if (!durationMode) return MIN_W
  const w = 8 + durationMs / 40
  return Math.max(MIN_W, Math.min(MAX_W, Number.isFinite(w) ? w : MIN_W))
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

function flowNodeRow(node: FlowNode): number {
  if (node.kind === 'end') return 1
  return node.row
}

/** 把「当前用到的行」在固定总高 totalH 内竖直居中（整体 translate 到 content <g>） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildActionTooltipHtml(act: MappedAction & { row: number }): string {
  const lines: string[] = []
  lines.push(`<strong>Action</strong>: ${escapeHtml(String(act.actionType))}`)
  lines.push(`<strong>Row</strong>: ${act.row}`)
  lines.push(`<strong>Status</strong>: ${escapeHtml(String(act.status))}`)
  if (Number.isFinite(act.durationMs) && act.durationMs > 0) {
    lines.push(`<strong>Duration</strong>: ${(act.durationMs / 1000).toFixed(2)}s`)
  } else {
    lines.push(`<strong>Duration</strong>: —`)
  }
  lines.push(`<strong>Tokens (est.)</strong>: ${act.tokenEstimate}`)
  lines.push(`<strong>Source</strong>: ${escapeHtml(act.source)}`)
  if (act.messageIndex !== undefined) {
    lines.push(`<strong>Message</strong> #${act.messageIndex}`)
  }
  if (act.partIndex !== undefined) {
    lines.push(`<strong>Part</strong> #${act.partIndex}`)
  }
  if (act.messageID) {
    lines.push(`<strong>Message ID</strong>: ${escapeHtml(act.messageID)}`)
  }
  if (act.callID) {
    lines.push(`<strong>Call ID</strong>: ${escapeHtml(act.callID)}`)
  }
  if (act.childSessionID) {
    lines.push(`<strong>Child Session</strong>: ${escapeHtml(act.childSessionID)}`)
  }
  if (act.parallelKey) {
    lines.push(`<strong>Parallel Key</strong>: ${escapeHtml(act.parallelKey)}`)
  }
  if (act.branchChildSessionID) {
    lines.push(`<strong>Branch Session</strong>: ${escapeHtml(act.branchChildSessionID)}`)
  }
  if (act.parentTaskCallID) {
    lines.push(`<strong>Parent Task Call</strong>: ${escapeHtml(act.parentTaskCallID)}`)
  }
  if (act.detail?.trim()) {
    lines.push(`<strong>Detail</strong>: ${escapeHtml(act.detail.trim())}`)
  }
  if (act.errorName?.trim()) {
    lines.push(`<strong>Error Name</strong>: ${escapeHtml(act.errorName.trim())}`)
  }
  if (act.errorMessage?.trim()) {
    lines.push(`<strong>Error</strong>: ${escapeHtml(act.errorMessage.trim())}`)
  }
  return lines.join('<br/>')
}

function verticalCenterOffsetY(layout: { node: FlowNode }[], totalH: number): number {
  if (layout.length === 0) return 0
  let minR = Infinity
  let maxR = -Infinity
  for (const item of layout) {
    const r = flowNodeRow(item.node)
    if (r < minR) minR = r
    if (r > maxR) maxR = r
  }
  const minY = TOP_PAD + minR * ROW_H
  const maxY = TOP_PAD + maxR * ROW_H + BLOCK_H
  const centerY = (minY + maxY) / 2
  return totalH / 2 - centerY
}

function computeLayout(
  actions: (MappedAction & { row: number })[],
  durationMode: boolean
) {
  const sorted = [...actions].sort((a, b) => a.sortTime - b.sortTime)
  const seq: FlowNode[] = sorted.map(a => ({ ...a, kind: 'action' as const }))
  seq.push({ kind: 'end', row: 1 })

  let x = MARGIN_LEFT
  const layout: {
    node: FlowNode
    x: number
    y: number
    w: number
    h: number
    cx: number
    cy: number
  }[] = []

  for (const node of seq) {
    if (node.kind === 'end') {
      const w = MIN_W
      const row = 1
      const y = rowTopY(row)
      const cy = y + BLOCK_H / 2
      layout.push({ node, x, y, w, h: BLOCK_H, cx: x + w / 2, cy })
      x += w + GAP
    } else {
      const a = node as MappedAction & { row: number }
      const w = blockWidth(durationMode, a.durationMs)
      const row = a.row
      const y = rowTopY(row)
      const cy = y + BLOCK_H / 2
      layout.push({ node, x, y, w, h: BLOCK_H, cx: x + w / 2, cy })
      x += w + GAP
    }
  }

  const totalW = Math.max(x + MARGIN_LEFT, 360)
  const maxActionRow = sorted.length === 0 ? 0 : Math.max(...sorted.map((a) => a.row))
  const maxRowIndex = Math.max(maxActionRow, 1) // 含 end(row=1)
  const totalH = TOP_PAD + maxRowIndex * ROW_H + BLOCK_H + BOTTOM_PAD
  return { layout, totalW, totalH }
}

interface Props {
  actions: (MappedAction & { row: number })[]
  durationMode: boolean
  colorMode: 'status' | 'tokens'
  /** 仅用于 UI 假数据演示：在某个 action 位置视觉分叉 */
  mockBranchForkActionIndex?: number
}

export default function ActionFlowVisualization({
  actions,
  durationMode,
  colorMode,
  mockBranchForkActionIndex,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const reactId = useId().replace(/:/g, '')
  const markerId = `action-flow-arrow-${reactId}`
  const tooltipId = `action-flow-tip-${reactId}`

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const root = d3.select(svg)
    root.selectAll('*').remove()

    const maxTok = Math.max(1, ...actions.map(a => a.tokenEstimate))
    const colorScale = d3.scaleSequential(d3.interpolateBlues).domain([0, maxTok])

    const { layout, totalW, totalH } = computeLayout(actions, durationMode)
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
      content
        .append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', actionFlowPalette.arrow)
        .attr('stroke-width', 1.2)
        .attr('marker-end', markerUrl)
    }

    layout.forEach((item, layoutIndex) => {
      const { node, x: nx, y: ny, w, h } = item
      if (node.kind === 'end') {
        content
          .append('circle')
          .attr('cx', nx + w / 2)
          .attr('cy', ny + h / 2)
          .attr('r', h / 2 - 2)
          .attr('fill', actionFlowPalette.end.fill)
          .attr('stroke', actionFlowPalette.end.stroke)
          .attr('stroke-width', 1.5)
        return
      }

      const act = node as MappedAction & { row: number }
      const tc = tokenColor(colorScale, act.tokenEstimate)
      const sc = statusColors(act.status)
      const isChildBranch = act.source === 'child-session'
      const fill = colorMode === 'status' ? sc.fill : tc.fill
      let stroke = colorMode === 'status' ? sc.stroke : tc.stroke
      if (isChildBranch && colorMode === 'status') stroke = '#8445BC'
      let iconFill = colorMode === 'status' ? sc.icon : actionFlowPalette.green.icon
      if (isChildBranch && colorMode === 'status') iconFill = '#6E38A0'

      const rect = content
        .append('rect')
        .attr('x', nx)
        .attr('y', ny)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', 4)
        .attr('fill', isChildBranch && colorMode === 'status' ? '#F3ECFA' : fill)
        .attr('stroke', stroke)
        .attr('stroke-width', isChildBranch ? 1.65 : 1.5)
        .style('cursor', 'pointer')
        .attr('data-tooltip-id', tooltipId)
        .attr('data-tooltip-html', buildActionTooltipHtml(act))
        .attr('data-tooltip-place', 'top')

      if (act.status === 'running' && colorMode === 'status') {
        rect.attr('class', 'action-flow-running')
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
      content
        .append('path')
        .attr('d', branchPath.toString())
        .attr('fill', 'none')
        .attr('stroke', '#8445BC')
        .attr('stroke-width', 1.75)
        .attr('marker-end', markerUrl)
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
      }
    }

    const desiredH = totalH + topOffset
    // 关键：使用像素级固定画布，不用 viewBox 缩放，避免不同行数时 action 尺寸变化
    root.attr('width', totalW).attr('height', desiredH)
    svg.removeAttribute('viewBox')
  }, [actions, durationMode, colorMode, markerId, tooltipId, mockBranchForkActionIndex])

  const maxRowForEstimate =
    actions.length === 0
      ? DEFAULT_MAX_ROW_INDEX
      : Math.max(DEFAULT_MAX_ROW_INDEX, ...actions.map((a) => a.row), 1)
  const contentHeight =
    TOP_PAD +
    maxRowForEstimate * ROW_H +
    BLOCK_H +
    BOTTOM_PAD +
    (mockBranchForkActionIndex !== undefined ? ROW_H : 0)
  const maxVisibleHeight = TOP_PAD + MAX_VISIBLE_ROWS * ROW_H + BLOCK_H + BOTTOM_PAD
  const viewportHeight = Math.min(contentHeight, maxVisibleHeight)

  return (
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
      <div
        style={{
          boxSizing: 'border-box',
          overflowX: 'auto',
          overflowY: 'auto',
          border: '1px solid #E8E8E8',
          borderRadius: 8,
          background: '#FCFCFC',
          width: '100%',
          height: viewportHeight,
          maxHeight: viewportHeight,
          minHeight: viewportHeight,
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
      <Tooltip
        id={tooltipId}
        className="action-flow-react-tooltip"
        delayShow={150}
        opacity={1}
      />
    </div>
  )
}
