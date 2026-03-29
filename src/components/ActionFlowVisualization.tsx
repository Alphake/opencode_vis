import { useLayoutEffect, useRef, useId } from 'react'
import * as d3 from 'd3'
import type { ActionStatus, ActionType, MappedAction } from '../types/opencode'
import { actionFlowPalette } from '../styles/actionFlowPalette'

type FlowNode =
  | { kind: 'end'; row: number }
  | (MappedAction & { row: number; kind: 'action' })

const MARGIN_LEFT = 24
const GAP = 12
/**
 * 垂直布局（与 `actionMapping.actionRow` 一致：row 只有 0 / 1 / 2）：
 * - 每行方块顶边 y = TOP_PAD + row * ROW_H（逻辑坐标，绘制时再整体 translate 居中）
 * - 每个 rect 高度固定为 BLOCK_H（用户单位 = 屏幕 px，与 SVG 总高一致时）
 * - 画布总高固定为三行容量：TOP_PAD + MAX_ROW * ROW_H + BLOCK_H + BOTTOM_PAD
 * - ROW_H ≥ BLOCK_H，否则上下两行 rect 重叠
 * - 按当前序列实际用到的 min/max row 计算竖直居中偏移，两行时上下留白对称；用到第三行时整段仍居中
 */
const BLOCK_H = 28
const ROW_H = 32
const TOP_PAD = 4
/** `buildMappedActionsFromMessages` 中 row 最大为 2 */
const MAX_ROW = 2
const MIN_W = 28
const MAX_W = 220
const BOTTOM_PAD = 6

const ACTION_ICON: Record<ActionType, string> = {
  Think: '◉',
  Clarify: '?',
  Plan: '≡',
  Permission: '⚿',
  Subagent: 'A',
  Response: '¶',
  Read: '◇',
  Write: '✎',
  Shell: '$',
  Search: '⌕',
  Skill: '⌘',
  Compaction: '▽',
}

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
  const totalH = TOP_PAD + MAX_ROW * ROW_H + BLOCK_H + BOTTOM_PAD
  return { layout, totalW, totalH }
}

interface Props {
  actions: (MappedAction & { row: number })[]
  durationMode: boolean
  colorMode: 'status' | 'tokens'
}

export default function ActionFlowVisualization({
  actions,
  durationMode,
  colorMode,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const reactId = useId().replace(/:/g, '')
  const markerId = `action-flow-arrow-${reactId}`

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
    const content = root.append('g').attr('transform', `translate(0, ${offsetY})`)

    for (let i = 0; i < layout.length - 1; i++) {
      const a = layout[i]!
      const b = layout[i + 1]!
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

    layout.forEach(item => {
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
      const fill = colorMode === 'status' ? sc.fill : tc.fill
      const stroke = colorMode === 'status' ? sc.stroke : tc.stroke
      const iconFill = colorMode === 'status' ? sc.icon : actionFlowPalette.green.icon

      const rect = content
        .append('rect')
        .attr('x', nx)
        .attr('y', ny)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', 4)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1.5)

      const tooltipLines: string[] = []
      tooltipLines.push(`Action: ${act.actionType}`)
      tooltipLines.push(`Status: ${act.status}`)
      if (Number.isFinite(act.durationMs) && act.durationMs > 0) {
        tooltipLines.push(`Duration: ${(act.durationMs / 1000).toFixed(2)}s`)
      }
      if (Number.isFinite(act.tokenEstimate)) {
        tooltipLines.push(`Tokens: ${act.tokenEstimate}`)
      }
      rect.append('title').text(tooltipLines.join('\n'))

      if (act.status === 'running' && colorMode === 'status') {
        rect.attr('class', 'action-flow-running')
      }

      const icon = ACTION_ICON[act.actionType] ?? '·'
      content
        .append('text')
        .attr('x', nx + w / 2)
        .attr('y', ny + h / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12)
        .attr('font-family', 'Segoe UI Symbol, Apple Symbols, sans-serif')
        .attr('fill', iconFill)
        .text(icon)
    })

    root.attr('width', totalW).attr('height', totalH)
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`)
  }, [actions, durationMode, colorMode, markerId])

  const minSvgH = TOP_PAD + MAX_ROW * ROW_H + BLOCK_H + BOTTOM_PAD

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
          overflowY: 'hidden',
          border: '1px solid #E8E8E8',
          borderRadius: 8,
          background: '#FCFCFC',
          width: '100%',
          height: minSvgH,
          maxHeight: minSvgH,
          flexShrink: 0,
        }}
      >
        <svg
          ref={svgRef}
          preserveAspectRatio="xMinYMin meet"
          style={{
            display: 'block',
            height: minSvgH,
            maxHeight: minSvgH,
            width: 'auto',
            maxWidth: 'none',
            verticalAlign: 'top',
          }}
        />
      </div>
    </div>
  )
}
