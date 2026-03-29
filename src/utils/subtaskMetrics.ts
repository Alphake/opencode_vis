import type { OcMessage, OcMessagePart, ToolPart } from '../types/opencode'
import type { AssistantSubtask } from './subtaskGrouping'

/** 与 OpenCode 上下文面板一致的「单条 message token 合计」：input+output+reasoning+cache（见 opencode-context-panel.md） */
/**
 * 从「上一子任务最后一条 assistant 之后」到「本子任务最后一条 assistant」下标范围内，user message 条数。
 */
export function countUserMessagesInSubtaskWindow(
  messages: OcMessage[],
  assistantIndices: number[],
  prevSubtaskMaxAssistantIndex: number | null | undefined
): number {
  if (assistantIndices.length === 0) return 0
  const maxA = Math.max(...assistantIndices)
  const start = prevSubtaskMaxAssistantIndex == null ? 0 : prevSubtaskMaxAssistantIndex + 1
  let n = 0
  for (let i = start; i <= maxA; i++) {
    if (messages[i]?.info.role === 'user') n++
  }
  return n
}

export function tokenTotalForMessage(tokens: OcMessage['info']['tokens'] | undefined): number {
  if (!tokens) return 0
  if (typeof tokens.total === 'number' && tokens.total > 0) {
    return tokens.total
  }
  const c = tokens.cache
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (c?.read ?? 0) +
    (c?.write ?? 0)
  )
}

export interface SubtaskTokenBreakdown {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  /** 与分项之和一致（或来自 API total） */
  total: number
}

export interface SubtaskCardMetrics {
  title: string
  assistantMessageIndices: number[]
  partCount: number
  /** 本子任务内各 assistant message 的 token 合计之和（非「相对上一子任务的增量」，见文档） */
  tokensSegmentSum: number
  tokenBreakdown: SubtaskTokenBreakdown
  llmCallCount: number
  /** 去重后的路径，来自 write/edit/replace 等 tool 的 input */
  mutatedFilePaths: string[]
  mutatedFileCount: number
  /** 首条 created → 末条 completed（无则用 created）的跨度 ms */
  durationMs: number | null
  /** 本段解决的 todo 数（= todosNewlyCompleted.length） */
  todosResolvedCount: number
}

function isFileMutatingTool(toolName: string): boolean {
  const t = toolName.toLowerCase()
  if (t.includes('write') || t.includes('edit') || t.includes('replace') || t.includes('patch')) {
    return true
  }
  if (t === 'apply_patch' || t.includes('apply_patch')) return true
  return false
}

function extractPathFromToolInput(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  const keys = ['path', 'file_path', 'target_file', 'filepath', 'filePath']
  for (const k of keys) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function collectPathsFromToolPart(part: ToolPart, into: Set<string>) {
  if (!isFileMutatingTool(part.tool)) return
  const p = extractPathFromToolInput(part.state?.input as Record<string, unknown> | undefined)
  if (p) into.add(p)
}

function countPartsInMessages(messages: OcMessage[]): number {
  let n = 0
  for (const m of messages) {
    n += m.parts.length
  }
  return n
}

/** 子任务标题：优先「新完成的 todo」摘要，否则首条 assistant 首行 text，否则默认 */
export function deriveSubtaskTitle(
  st: AssistantSubtask,
  messages: OcMessage[],
  displayIndex: number
): string {
  if (st.todosNewlyCompleted.length > 0) {
    const first = st.todosNewlyCompleted[0]!
    const head = first.content.length > 36 ? `${first.content.slice(0, 36)}…` : first.content
    const more =
      st.todosNewlyCompleted.length > 1 ? ` 等 ${st.todosNewlyCompleted.length} 项` : ''
    return `完成：${head}${more}`
  }
  const firstIdx = st.assistantMessageIndices[0]
  if (firstIdx !== undefined) {
    const msg = messages[firstIdx]
    if (msg) {
      for (const p of msg.parts) {
        if (p.type === 'text' && p.text?.trim()) {
          const line = p.text.trim().split(/\n/)[0]!.slice(0, 44)
          return line.length >= 44 ? `${line}…` : line
        }
      }
    }
  }
  return `子任务 ${displayIndex + 1}`
}

/** 子任务时间跨度展示（无数据时 —） */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s - m * 60)
  return `${m}m${rs > 0 ? `${rs}s` : ''}`
}

export function buildSubtaskCardMetrics(
  st: AssistantSubtask,
  messages: OcMessage[],
  displayIndex: number
): SubtaskCardMetrics {
  const indices = st.assistantMessageIndices
  const msgs = indices.map(i => messages[i]).filter((m): m is OcMessage => !!m)

  const bd: SubtaskTokenBreakdown = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  }

  let tokensSegmentSum = 0
  for (const m of msgs) {
    const t = m.info.tokens
    if (t) {
      bd.input += t.input ?? 0
      bd.output += t.output ?? 0
      bd.reasoning += t.reasoning ?? 0
      bd.cacheRead += t.cache?.read ?? 0
      bd.cacheWrite += t.cache?.write ?? 0
    }
    tokensSegmentSum += tokenTotalForMessage(m.info.tokens)
  }
  bd.total = bd.input + bd.output + bd.reasoning + bd.cacheRead + bd.cacheWrite

  const paths = new Set<string>()
  for (const m of msgs) {
    for (const part of m.parts) {
      if (part.type === 'tool') {
        collectPathsFromToolPart(part, paths)
      }
    }
  }
  const mutatedFilePaths = [...paths].sort()

  let minCreated = Infinity
  let maxEnd = -Infinity
  for (const m of msgs) {
    const c = m.info.time.created
    const e = m.info.time.completed ?? c
    minCreated = Math.min(minCreated, c)
    maxEnd = Math.max(maxEnd, e)
  }
  const durationMs =
    msgs.length > 0 && Number.isFinite(minCreated) && maxEnd >= minCreated
      ? maxEnd - minCreated
      : null

  return {
    title: deriveSubtaskTitle(st, messages, displayIndex),
    assistantMessageIndices: [...indices],
    partCount: countPartsInMessages(msgs),
    tokensSegmentSum,
    tokenBreakdown: bd,
    llmCallCount: msgs.length,
    mutatedFilePaths,
    mutatedFileCount: mutatedFilePaths.length,
    durationMs,
    todosResolvedCount: st.todosNewlyCompleted.length,
  }
}

/** 供后续可视化：本子任务涉及的 message + part 引用 */
export function getSubtaskMessagesAndParts(
  st: AssistantSubtask,
  messages: OcMessage[]
): { messageIndex: number; message: OcMessage; parts: OcMessagePart[] }[] {
  return st.assistantMessageIndices
    .map(i => {
      const message = messages[i]
      if (!message) return null
      return { messageIndex: i, message, parts: message.parts }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}
