import type { OcMessage, OcQuestionInfo, ToolPart } from '../types/opencode'

/** 从 tool part 的 state.input 解析 question 工具的题干与选项（与 GET /message 一致） */
export function parseQuestionInputQuestions(input: Record<string, unknown> | undefined): OcQuestionInfo[] {
  if (!input || !Array.isArray(input.questions)) return []
  return input.questions as OcQuestionInfo[]
}

/** 当前会话消息里是否存在「待作答」且已带 input.questions 的 question 工具（用于内联 UI，避免只依赖 SSE） */
export function messagesHaveOpenQuestionWithInput(messages: OcMessage[]): boolean {
  for (const m of messages) {
    if (m.info.role !== 'assistant') continue
    for (const p of m.parts) {
      if (p.type !== 'tool' || p.tool !== 'question') continue
      const st = p.state?.status
      if (st !== 'running' && st !== 'pending') continue
      if (parseQuestionInputQuestions(p.state?.input).length > 0) return true
    }
  }
  return false
}

/** 供与 GET /question 列表匹配 */
export function findQuestionRequestIdForToolPart(
  list: Array<{ id: string; sessionID: string; tool?: { messageID: string; callID: string } }>,
  part: ToolPart,
): string | undefined {
  const hit = list.find(
    (q) => q.tool?.messageID === part.messageID && q.tool?.callID === part.callID,
  )
  if (hit) return hit.id
  const sameSession = list.filter((q) => q.sessionID === part.sessionID)
  if (sameSession.length === 1) return sameSession[0]!.id
  return undefined
}
