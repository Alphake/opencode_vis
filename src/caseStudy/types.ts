import type { OcMessage, OcTodo } from '../types/opencode'

export interface SessionDemoOverride {
  sessionId: string
  /** Stable todo order by OpenCode id prefix (first match wins). */
  todoOrderByIdPrefix?: string[]
  /** Replace assistant/user text when a part contains `match`. */
  messageTextReplacements?: Array<{
    match: string
    replacement: string
  }>
}

export interface SessionDemoOverlayResult {
  messages: OcMessage[]
  todos: OcTodo[]
}
