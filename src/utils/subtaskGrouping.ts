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

/**
 * 按顺序扫 messages；**message 为最小单位**（同一条 message 不会拆进两个 subtask）。
 *
 * **切段规则（满足任一即可能产生新 subtask，同条 message 内先处理 todowrite 再处理 step-finish）：**
 *
 * 1. **首次生成 todo 列表**：若此前从未有过 todowrite 快照（`lastTodowriteSnapshot === null`），本条解析出
 *    非空列表时，将 **本条之前** 已累积的 assistant **先** flush 为一段（尚无列表，`todosNewlyCompleted` 空）；
 *    本条留在下一段继续累积。
 * 2. **新 completed**：todowrite 相对上一快照有 **非 completed → completed**（同 content）时，flush 当前段
 *    （含本条），`todosNewlyCompleted` 为这些项；仅其它状态变化则只更新快照、不切段。
 * 3. **step-finish + reason stop**：本条处理完 todowrite 逻辑后，若仍留在当前累积中且含 agent 终止标记，
 *    再 flush 一段（`todosNewlyCompleted` 空）。
 * 4. **user / EOF**：强制 flush 当前累积（`todosNewlyCompleted` 空）。
 *
 * - **todos**：段末快照解析顺序：tool input/metadata/output → resolver → 沿用快照 → fallback。
 */
export interface AssistantSubtask {
  subtask_id: string
  /** 本段结束时的 todo 列表快照（尽量来自本条 todowrite） */
  todos: OcTodo[]
  /** 仅规则 2（新 completed）切段时非空；规则 1/3/4 切段时为空 */
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
  let currentIndices: number[] = []
  /** 最近一次从 todowrite 得到的快照（用于下一段 diff） */
  let lastTodowriteSnapshot: OcTodo[] | null = null

  const resolveSnapshotForSegment = (lastIdx: number, lastMsg: OcMessage): OcTodo[] => {
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

  const pushForcedSubtask = (indices: number[]) => {
    if (indices.length === 0) return
    const lastIdx = indices[indices.length - 1]!
    const lastMsg = messages[lastIdx]!
    const todosSnapshot = resolveSnapshotForSegment(lastIdx, lastMsg)
    if (isTodoWriteMessage(lastMsg) && todosSnapshot.length > 0) {
      lastTodowriteSnapshot = todosSnapshot.map(shallowCloneTodo)
    }

    subtasks.push({
      subtask_id: buildSubtaskId(indices, messages),
      todos: todosSnapshot,
      todosNewlyCompleted: [],
      assistantMessageIndices: indices,
    })
  }

  const flushForced = () => {
    if (currentIndices.length === 0) return
    const indices = [...currentIndices]
    currentIndices = []
    pushForcedSubtask(indices)
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.info.role === 'user') {
      flushForced()
      continue
    }
    if (msg.info.role !== 'assistant') continue

    currentIndices.push(i)

    if (isTodoWriteMessage(msg)) {
      const next = resolveSnapshotForSegment(i, msg)

      if (next.length > 0 && lastTodowriteSnapshot === null) {
        if (currentIndices.length > 1) {
          const pre = currentIndices.slice(0, -1)
          currentIndices = [i]
          pushForcedSubtask(pre)
        }
      }

      if (next.length > 0) {
        const newly = diffTodosNewlyCompleted(lastTodowriteSnapshot, next)
        if (newly.length > 0) {
          const indices = [...currentIndices]
          currentIndices = []
          subtasks.push({
            subtask_id: buildSubtaskId(indices, messages),
            todos: next.map(shallowCloneTodo),
            todosNewlyCompleted: newly.map(shallowCloneTodo),
            assistantMessageIndices: indices,
          })
        }
        lastTodowriteSnapshot = next.map(shallowCloneTodo)
      }
    }

    if (messageHasAgentStepFinishStop(msg) && currentIndices.length > 0) {
      flushForced()
    }
  }
  flushForced()

  return subtasks
}

export function getAssistantSubtaskIndexForMessage(
  subtasks: AssistantSubtask[],
  messageIndex: number
): number {
  return subtasks.findIndex(s => s.assistantMessageIndices.includes(messageIndex))
}
