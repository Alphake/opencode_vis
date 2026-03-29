import type { OcMessage, OcTodo } from '../types/opencode'
import type { AssistantSubtask } from './subtaskGrouping'

export function normalizeTodoContent(content: string): string {
  return content.trim()
}

/**
 * 在子任务快照 `todos` 中查找与当前待办文案匹配的段。
 * 从**后往前**取第一个命中段，表示该待办最近一次出现在哪段子任务快照里。
 */
export function findSubtaskIndexForTodo(
  assistantSubtasks: AssistantSubtask[],
  todo: OcTodo
): number | null {
  const key = normalizeTodoContent(todo.content)
  if (!key) return null
  for (let si = assistantSubtasks.length - 1; si >= 0; si--) {
    const st = assistantSubtasks[si]!
    if (st.todos.some(t => normalizeTodoContent(t.content) === key)) {
      return si
    }
  }
  return null
}

/**
 * 高亮：本子任务全部 assistant 下标 + 若段首前一条为 user，则带上该 user（本轮提问）。
 */
export function buildMessageHighlightSet(
  subtask: AssistantSubtask,
  messages: OcMessage[]
): Set<number> {
  const s = new Set<number>()
  const idxs = subtask.assistantMessageIndices
  if (idxs.length === 0) return s
  for (const i of idxs) s.add(i)
  const lo = Math.min(...idxs)
  if (lo > 0 && messages[lo - 1]?.info.role === 'user') {
    s.add(lo - 1)
  }
  return s
}
