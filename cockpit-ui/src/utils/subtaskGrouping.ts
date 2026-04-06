import type { OcMessage, OcMessagePart, OcTodo, ToolPart } from '../types/opencode'

const TODO_WRITE_TOOL_NAMES = new Set([
  'todowrite',
  'todo_write',
  'write_todos',
  'update_todos',
])

export function isTodoWriteTool(toolName: string): boolean {
  const t = toolName.toLowerCase().replace(/-/g, '_')
  if (TODO_WRITE_TOOL_NAMES.has(t)) return true
  if (t.includes('todo_write')) return true
  if (t.endsWith('_todowrite')) return true
  return false
}

export function isTodoWriteMessage(message: OcMessage): boolean {
  if (message.info.role !== 'assistant') return false
  return message.parts.some(p => p.type === 'tool' && isTodoWriteTool(p.tool))
}

function partIsStepFinishStop(part: OcMessagePart): boolean {
  const raw = part as { type?: string; reason?: string }
  if (raw.type !== 'step-finish') return false
  return raw.reason === 'stop'
}

/** 本条 assistant 含 step-finish 且 reason === stop（Agent 本步回复终止） */
export function messageHasAgentStepFinishStop(message: OcMessage): boolean {
  if (message.info.role !== 'assistant') return false
  return message.parts.some(partIsStepFinishStop)
}

function shallowCloneTodo(t: OcTodo): OcTodo {
  return { ...t }
}

function normalizeStatus(raw: unknown): OcTodo['status'] {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (s === 'completed' || s === 'complete') return 'completed'
  if (s === 'in_progress' || s === 'inprogress' || s === 'in-progress') return 'in_progress'
  return 'pending'
}

function normalizePriority(raw: unknown): OcTodo['priority'] {
  const s = String(raw ?? 'medium').toLowerCase()
  if (s === 'high') return 'high'
  if (s === 'low') return 'low'
  return 'medium'
}

function normalizeRawTodoItem(item: unknown): OcTodo | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const content = o.content
  if (typeof content !== 'string' || !content.trim()) return null
  return {
    content: content.trim(),
    status: normalizeStatus(o.status),
    priority: normalizePriority(o.priority),
  }
}

function normalizeRawTodos(raw: unknown[]): OcTodo[] {
  const out: OcTodo[] = []
  for (const x of raw) {
    const t = normalizeRawTodoItem(x)
    if (t) out.push(t)
  }
  return out
}

function extractTodosArray(raw: unknown): OcTodo[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const list = normalizeRawTodos(raw)
  return list.length > 0 ? list : null
}

type ToolStateWithMeta = ToolPart['state'] & {
  metadata?: { todos?: unknown }
}

/** 从单条 todowrite tool part 取列表：input.todos → metadata.todos → output JSON */
export function parseTodowriteTodosFromToolPart(part: ToolPart): OcTodo[] | null {
  const input = part.state?.input
  const fromInput = extractTodosArray(input?.todos)
  if (fromInput) return fromInput

  const meta = (part.state as ToolStateWithMeta | undefined)?.metadata
  const fromMeta = extractTodosArray(meta?.todos)
  if (fromMeta) return fromMeta

  const out = part.state?.output
  if (typeof out === 'string' && out.trim()) {
    try {
      const j = JSON.parse(out) as unknown
      if (Array.isArray(j)) {
        const list = normalizeRawTodos(j)
        if (list.length > 0) return list
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** 从 assistant message 中取第一条 todowrite 的 todos */
export function parseTodowriteTodosFromMessage(message: OcMessage): OcTodo[] | null {
  if (message.info.role !== 'assistant') return null
  for (const p of message.parts) {
    if (p.type !== 'tool') continue
    if (!isTodoWriteTool(p.tool)) continue
    const list = parseTodowriteTodosFromToolPart(p)
    if (list && list.length > 0) return list
  }
  return null
}

/**
 * 相对上一次快照，同一 content 下由 **非 completed → completed** 的项（pending / in_progress 等均可）
 */
export function diffTodosNewlyCompleted(prev: OcTodo[] | null, next: OcTodo[]): OcTodo[] {
  if (!prev || prev.length === 0) return []
  const prevByContent = new Map<string, OcTodo>()
  for (const t of prev) {
    prevByContent.set(t.content, t)
  }
  const out: OcTodo[] = []
  for (const n of next) {
    if (n.status !== 'completed') continue
    const p = prevByContent.get(n.content)
    if (p && p.status !== 'completed') {
      out.push(shallowCloneTodo(n))
    }
  }
  return out
}

/** 尚有未完成的 todo（含 pending / in_progress） */
function hasPendingTodos(s: OcTodo[]): boolean {
  return s.length > 0 && s.some(t => t.status !== 'completed')
}

/** 列表非空且全部 completed */
function allTodosCompleted(s: OcTodo[]): boolean {
  return s.length > 0 && s.every(t => t.status === 'completed')
}

/**
 * - **planning**：尚无列表 → 第一次写出列表；或「快照已全部完成」→ 下一次 todowrite（**含**该条 message）。
 * - **execution**：上一条 todowrite 快照里**仍有未完成**时，到下一次 todowrite 之间的纯 assistant（**不含**两条 todowrite）。
 * - **wrap_up**：最后一条 todowrite 快照已全部完成，且其后仍有 assistant（收尾输出）。
 */
export type SubtaskPhase = 'planning' | 'execution' | 'wrap_up'

export interface AssistantSubtask {
  subtask_id: string
  phase: SubtaskPhase
  /** 本子任务语义上的段末列表（ planning 为段末 todowrite 快照；execution 为后一条 todowrite；wrap_up 为 fallback ） */
  todos: OcTodo[]
  todosNewlyCompleted: OcTodo[]
  assistantMessageIndices: number[]
}

function buildSubtaskId(indices: number[], messages: OcMessage[]): string {
  if (indices.length === 0) return 'subtask-empty'
  const first = indices[0]!
  const last = indices[indices.length - 1]!
  const head = messages[first]!
  if (head.info.id && head.info.id.length > 0) {
    return last === first
      ? `subtask-${head.info.id}`
      : `subtask-${head.info.id}__${last}`
  }
  return `subtask-idx-${first}-${last}`
}

function resolveSnapshotForSegment(
  lastIdx: number,
  messages: OcMessage[],
  lastTodowriteSnapshot: OcTodo[] | null,
  resolver: ((index: number) => OcTodo[] | undefined) | undefined,
  fallback: OcTodo[]
): OcTodo[] {
  const lastMsg = messages[lastIdx]!
  const fromTool = parseTodowriteTodosFromMessage(lastMsg)
  if (fromTool && fromTool.length > 0) {
    return fromTool.map(shallowCloneTodo)
  }
  const r = resolver?.(lastIdx)
  if (r !== undefined && r.length > 0) {
    return r.map(shallowCloneTodo)
  }
  if (lastTodowriteSnapshot && lastTodowriteSnapshot.length > 0) {
    return lastTodowriteSnapshot.map(shallowCloneTodo)
  }
  return fallback.map(shallowCloneTodo)
}

function assistantRangesSplitByUser(messages: OcMessage[]): number[][] {
  const ranges: number[][] = []
  let cur: number[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.info.role === 'user') {
      if (cur.length > 0) ranges.push(cur)
      cur = []
      continue
    }
    if (msg.info.role === 'assistant') {
      cur.push(i)
    }
  }
  if (cur.length > 0) ranges.push(cur)
  return ranges
}

function collectIndicesInclusive(range: number[], lo: number, hi: number): number[] {
  const out: number[] = []
  for (const idx of range) {
    if (idx >= lo && idx <= hi) out.push(idx)
  }
  return out
}

function collectOpenInterval(range: number[], a: number, b: number): number[] {
  const out: number[] = []
  for (const idx of range) {
    if (idx > a && idx < b) out.push(idx)
  }
  return out
}

export function groupAssistantSubtasks(
  messages: OcMessage[],
  options?: {
    todosAfterMessageIndex?: (index: number) => OcTodo[] | undefined
    fallbackSessionTodos?: OcTodo[]
  }
): AssistantSubtask[] {
  const resolver = options?.todosAfterMessageIndex
  const fallback = (options?.fallbackSessionTodos ?? []).map(shallowCloneTodo)

  const subtasks: AssistantSubtask[] = []

  for (const range of assistantRangesSplitByUser(messages)) {
    const rangeSubtasks: AssistantSubtask[] = []

    const push = (
      indices: number[],
      phase: SubtaskPhase,
      todos: OcTodo[],
      newly: OcTodo[]
    ) => {
      if (indices.length === 0) return
      rangeSubtasks.push({
        subtask_id: buildSubtaskId(indices, messages),
        phase,
        todos: todos.map(shallowCloneTodo),
        todosNewlyCompleted: newly.map(shallowCloneTodo),
        assistantMessageIndices: indices,
      })
    }

    const twIndices: number[] = []
    for (const idx of range) {
      const list = parseTodowriteTodosFromMessage(messages[idx]!)
      if (list && list.length > 0) twIndices.push(idx)
    }

    if (twIndices.length === 0) {
      push([...range], 'planning', fallback, [])
      subtasks.push(...rangeSubtasks)
      continue
    }

    let lastTodowriteSnapshot: OcTodo[] | null = null
    const snapAtTw = new Map<number, OcTodo[]>()
    for (const idx of twIndices) {
      const snap = resolveSnapshotForSegment(idx, messages, lastTodowriteSnapshot, resolver, fallback)
      snapAtTw.set(idx, snap)
      lastTodowriteSnapshot = snap
    }

    /** 一次划清「前期调研与计划生成」：从当前 cursor 起，沿 todowrite 向前跳过「快照尚无未完成 todo」的若干条，直到第一次出现 hasPending，或全部跳过则收到最后一条 tw */
    let twScan = 0
    let assistantCursor = range[0]!

    while (twScan < twIndices.length) {
      let k = twScan
      while (k < twIndices.length && !hasPendingTodos(snapAtTw.get(twIndices[k]!)!)) {
        k++
      }
      const endTw =
        k < twIndices.length ? twIndices[k]! : twIndices[twIndices.length - 1]!

      const planningIndices = collectIndicesInclusive(range, assistantCursor, endTw)
      if (planningIndices.length > 0) {
        const twInPlan = twIndices.filter(tw => tw >= assistantCursor && tw <= endTw)
        const firstTw = twInPlan[0]!
        const lastTwInPlan = twInPlan[twInPlan.length - 1]!
        const snapFirst = snapAtTw.get(firstTw)!
        const snapLast = snapAtTw.get(lastTwInPlan)!
        const newly = diffTodosNewlyCompleted(snapFirst, snapLast)
        push(planningIndices, 'planning', snapLast, newly)
      }

      if (k >= twIndices.length) {
        assistantCursor = endTw + 1
        break
      }

      const twK = twIndices[k]!
      if (k + 1 >= twIndices.length) {
        assistantCursor = twK + 1
        break
      }

      const twNext = twIndices[k + 1]!
      const between = collectOpenInterval(range, twK, twNext)
      if (between.length > 0) {
        const snapA = snapAtTw.get(twK)!
        const snapB = snapAtTw.get(twNext)!
        push(between, 'execution', snapB, diffTodosNewlyCompleted(snapA, snapB))
      }

      twScan = k + 1
      assistantCursor = twNext + 1
    }

    const lastTw = twIndices[twIndices.length - 1]!
    const snapLast = snapAtTw.get(lastTw)!
    const trailing: number[] = []
    for (const idx of range) {
      if (idx >= assistantCursor) trailing.push(idx)
    }
    if (trailing.length > 0) {
      const tailTodos = fallback.map(shallowCloneTodo)
      const newly = diffTodosNewlyCompleted(snapLast, tailTodos)
      if (hasPendingTodos(snapLast)) {
        push(trailing, 'execution', tailTodos, newly)
      } else if (allTodosCompleted(snapLast)) {
        push(trailing, 'wrap_up', tailTodos, newly)
      } else {
        push(trailing, 'execution', tailTodos, newly)
      }
    }

    subtasks.push(...rangeSubtasks)
  }

  return subtasks
}

export function getAssistantSubtaskIndexForMessage(
  subtasks: AssistantSubtask[],
  messageIndex: number
): number {
  return subtasks.findIndex(s => s.assistantMessageIndices.includes(messageIndex))
}
