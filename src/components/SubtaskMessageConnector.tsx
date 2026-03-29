import { useId, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import { actionFlowPalette } from '../styles/actionFlowPalette'

interface Props {
  /** 包住中栏+右栏、position:relative 的节点 */
  containerRef: RefObject<HTMLDivElement | null>
  /** 中间消息滚动容器（用于监听 scroll） */
  messageScrollRef: RefObject<HTMLDivElement | null>
  /** 右侧子任务列表滚动容器 */
  subtaskScrollRef: RefObject<HTMLDivElement | null>
  subtaskIndex: number | null
  messageIndices: Set<number> | null
}

function unionMessageRects(
  container: HTMLElement,
  messageScroll: HTMLElement,
  indices: Set<number>
): DOMRect | null {
  const cr = container.getBoundingClientRect()
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let any = false
  for (const idx of indices) {
    const el = messageScroll.querySelector(`[data-message-index="${idx}"]`)
    if (!el) continue
    const r = el.getBoundingClientRect()
    any = true
    top = Math.min(top, r.top)
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
    bottom = Math.max(bottom, r.bottom)
  }
  if (!any) return null
  return new DOMRect(left - cr.left, top - cr.top, right - left, bottom - top)
}

export default function SubtaskMessageConnector({
  containerRef,
  messageScrollRef,
  subtaskScrollRef,
  subtaskIndex,
  messageIndices,
}: Props) {
  const mid = useId().replace(/:/g, '')
  const markerEndId = `subtask-link-arrow-${mid}`
  const [pathD, setPathD] = useState('')
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const active = subtaskIndex !== null && messageIndices !== null && messageIndices.size > 0
    if (!active) {
      setPathD('')
      return
    }

    const update = () => {
      const container = containerRef.current
      const msgScroll = messageScrollRef.current
      const stScroll = subtaskScrollRef.current
      if (!container || !msgScroll || !stScroll || subtaskIndex === null || !messageIndices) {
        setPathD('')
        return
      }

      const cr = container.getBoundingClientRect()
      setSvgSize({ w: cr.width, h: cr.height })

      const union = unionMessageRects(container, msgScroll, messageIndices)
      const card = stScroll.querySelector(`[data-subtask-card-index="${subtaskIndex}"]`)
      if (!union || !card) {
        setPathD('')
        return
      }

      const srCard = card.getBoundingClientRect()
      const x1 = union.right
      const y1 = union.top + union.height / 2
      const x2 = srCard.left - cr.left
      const y2 = srCard.top - cr.top + srCard.height / 2

      const midX = x1 + (x2 - x1) * 0.55
      setPathD(`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`)
    }

    update()
    const ro = new ResizeObserver(update)
    const containerEl = containerRef.current
    if (containerEl) ro.observe(containerEl)
    const msgEl = messageScrollRef.current
    const stEl = subtaskScrollRef.current
    msgEl?.addEventListener('scroll', update, { passive: true })
    stEl?.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    return () => {
      ro.disconnect()
      msgEl?.removeEventListener('scroll', update)
      stEl?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [containerRef, messageScrollRef, subtaskScrollRef, subtaskIndex, messageIndices])

  if (!pathD || svgSize.w <= 0) return null

  return (
    <svg
      width={svgSize.w}
      height={svgSize.h}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
      aria-hidden
    >
      <defs>
        <marker
          id={markerEndId}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill={actionFlowPalette.arrow} />
        </marker>
      </defs>
      <path
        d={pathD}
        fill="none"
        stroke={actionFlowPalette.arrow}
        strokeWidth={1.8}
        strokeLinecap="round"
        markerEnd={`url(#${markerEndId})`}
      />
    </svg>
  )
}
