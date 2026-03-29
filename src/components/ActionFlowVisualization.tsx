import { useLayoutEffect, useRef, useId } from 'react'
import * as d3 from 'd3'
import type { ActionStatus, ActionType, MappedAction } from '../types/opencode'
import { actionFlowPalette } from '../styles/actionFlowPalette'

type FlowNode =
  | { kind: 'end'; row: number }
  | (MappedAction & { row: number; kind: 'action' })

const MARGIN_LEFT = 24
const GAP = 12
const BLOCK_H = 28
const ROW_H = 44
/** 第一行距 SVG 顶部的留白，避免贴顶 */
const TOP_PAD = 10
const MIN_W = 28
const MAX_W = 220
const BOTTOM_PAD = 16

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
  const totalH = TOP_PAD + ROW_H * 3 + BLOCK_H + BOTTOM_PAD
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
    const g = root.append('g')

    const defs = g.append('defs')
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
      g.append('path')
        .attr('d', path.toString())
        .attr('fill', 'none')
        .attr('stroke', actionFlowPalette.arrow)
        .attr('stroke-width', 1.2)
        .attr('marker-end', markerUrl)
    }

    layout.forEach(item => {
      const { node, x: nx, y: ny, w, h } = item
      if (node.kind === 'end') {
        g.append('circle')
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

      const rect = g
        .append('rect')
        .attr('x', nx)
        .attr('y', ny)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', 4)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', 1.5)

      if (act.status === 'running' && colorMode === 'status') {
        rect.attr('class', 'action-flow-running')
      }

      const icon = ACTION_ICON[act.actionType] ?? '·'
      g.append('text')
        .attr('x', nx + w / 2)
        .attr('y', ny + h / 2 + 5)
        .attr('text-anchor', 'middle')
        .attr('font-size', 12)
        .attr('font-family', 'Segoe UI Symbol, Apple Symbols, sans-serif')
        .attr('fill', iconFill)
        .text(icon)
    })

    root.attr('width', totalW).attr('height', totalH)
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`)
  }, [actions, durationMode, colorMode, markerId])

  const minSvgH = TOP_PAD + ROW_H * 3 + BLOCK_H + BOTTOM_PAD

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flexShrink: 0,
        width: '100%',
      }}
    >
      <div
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          border: '1px solid #E8E8E8',
          borderRadius: 8,
          background: '#FCFCFC',
          width: '100%',
          minHeight: minSvgH,
        }}
      >
        <svg ref={svgRef} style={{ display: 'block', minHeight: minSvgH }} />
      </div>
    </div>
  )
}
