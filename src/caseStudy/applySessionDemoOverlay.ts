import type { OcMessage, OcMessagePart, OcTodo, ToolPart } from '../types/opencode'
import { getSessionDemoOverride } from './index'
import type { SessionDemoOverlayResult, SessionDemoOverride } from './types'

function todoSortKey(todo: OcTodo, orderPrefixes: string[] | undefined): number {
  const id = todo.id?.trim() ?? ''
  if (orderPrefixes?.length) {
    const idx = orderPrefixes.findIndex((p) => id.startsWith(p))
    if (idx >= 0) return idx
    return orderPrefixes.length + 1000
  }
  return 0
}

function reorderTodos(todos: OcTodo[], override: SessionDemoOverride): OcTodo[] {
  const order = override.todoOrderByIdPrefix
  if (!order?.length) return todos
  return [...todos].sort((a, b) => {
    const ka = todoSortKey(a, order)
    const kb = todoSortKey(b, order)
    if (ka !== kb) return ka - kb
    return a.content.localeCompare(b.content, 'en')
  })
}

function replaceTextIfMatch(text: string, override: SessionDemoOverride): string {
  for (const rule of override.messageTextReplacements ?? []) {
    if (text.includes(rule.match)) return rule.replacement
  }
  return text
}

function patchPart(part: OcMessagePart, override: SessionDemoOverride): OcMessagePart {
  if (part.type === 'text' || part.type === 'reasoning') {
    const next = replaceTextIfMatch(part.text ?? '', override)
    if (next === part.text) return part
    return { ...part, text: next }
  }
  if (part.type !== 'tool') return part

  const tool = part as ToolPart
  const st = tool.state
  if (!st) return part

  let changed = false
  const nextState = { ...st }

  if (typeof st.output === 'string') {
    const out = replaceTextIfMatch(st.output, override)
    if (out !== st.output) {
      nextState.output = out
      changed = true
    }
  }
  if (typeof st.title === 'string') {
    const title = replaceTextIfMatch(st.title, override)
    if (title !== st.title) {
      nextState.title = title
      changed = true
    }
  }

  const input =
    st.input && typeof st.input === 'object' ? ({ ...(st.input as Record<string, unknown>) } as Record<string, unknown>) : null
  if (input && Array.isArray(input.todos)) {
    const todos = reorderTodos(input.todos as OcTodo[], override)
    if (JSON.stringify(todos) !== JSON.stringify(input.todos)) {
      input.todos = todos
      nextState.input = input
      changed = true
    }
  }

  const meta =
    st.metadata && typeof st.metadata === 'object'
      ? ({ ...(st.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : null
  if (meta && Array.isArray(meta.todos)) {
    const todos = reorderTodos(meta.todos as OcTodo[], override)
    if (JSON.stringify(todos) !== JSON.stringify(meta.todos)) {
      meta.todos = todos
      nextState.metadata = meta
      changed = true
    }
  }

  if (!changed) return part
  return { ...tool, state: nextState }
}

function patchMessages(messages: OcMessage[], override: SessionDemoOverride): OcMessage[] {
  return messages.map((msg) => ({
    ...msg,
    parts: msg.parts.map((p) => patchPart(p, override)),
    info: {
      ...msg.info,
      content:
        typeof msg.info.content === 'string'
          ? replaceTextIfMatch(msg.info.content, override)
          : msg.info.content,
    },
  }))
}

export function applySessionDemoOverlay(
  sessionId: string,
  messages: OcMessage[],
  todos: OcTodo[],
): SessionDemoOverlayResult {
  const override = getSessionDemoOverride(sessionId)
  if (!override) return { messages, todos }
  return {
    messages: patchMessages(messages, override),
    todos: reorderTodos(todos, override),
  }
}

/** Custom sort for archived todo list when a demo override defines order. */
export function compareTodosForDisplay(a: OcTodo, b: OcTodo, sessionId: string | undefined): number {
  const override = sessionId ? getSessionDemoOverride(sessionId) : undefined
  const order = override?.todoOrderByIdPrefix
  if (order?.length) {
    const ka = todoSortKey(a, order)
    const kb = todoSortKey(b, order)
    if (ka !== kb) return ka - kb
  }
  return a.content.localeCompare(b.content, 'en')
}
