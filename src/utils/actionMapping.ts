import type {
  ActionStatus,
  ActionType,
  MappedAction,
  OcMessage,
  OcMessagePart,
  OcSseActionEvent,
  ToolPart,
} from '../types/opencode'
import { isTodoWriteTool } from './subtaskGrouping'

const SUBAGENT_TOOLS = new Set(['task', 'subtask', 'subagent', 'agent'])

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_')
}

function estimateTokensFromStrings(...chunks: (string | undefined)[]): number {
  let n = 0
  for (const c of chunks) {
    if (typeof c === 'string' && c.length > 0) n += c.length
  }
  return Math.max(0, Math.round(n / 4))
}

function toolStatusToActionStatus(s: ToolPart['state']['status'] | undefined): ActionStatus {
  if (s === 'running') return 'running'
  if (s === 'error') return 'error'
  return 'completed'
}

function mapToolToActionType(tool: string): ActionType | null {
  const t = normalizeToolName(tool)
  if (t === 'question') return 'Clarify'
  if (isTodoWriteTool(tool) || t === 'todoread' || t === 'todo_read') return 'Plan'
  if (SUBAGENT_TOOLS.has(t)) return 'Subagent'
  if (['glob', 'grep', 'read'].includes(t)) return 'Read'
  if (['write', 'edit', 'multiedit', 'patch'].includes(t)) return 'Write'
  if (t === 'bash' || t === 'shell') return 'Shell'
  if (t === 'websearch' || t === 'web_fetch' || t === 'webfetch') return 'Search'
  if (t === 'skill') return 'Skill'
  return null
}

function durationForReasoning(part: { time?: { start?: number; end?: number }; text?: string }): number {
  const { start, end } = part.time ?? {}
  if (typeof start === 'number' && typeof end === 'number' && end >= start) return end - start
  return Math.min(30_000, Math.max(0, estimateTokensFromStrings(part.text) * 40))
}

function durationForTool(part: ToolPart, message: OcMessage): number {
  const st = part.state?.status
  if (st === 'running') return 0
  const start = part.state?.time?.start
  const end = part.state?.time?.end
  if (typeof start === 'number' && typeof end === 'number' && end >= start) {
    return Math.min(120_000, end - start)
  }
  const created = message.info.time?.created ?? 0
  const completed = message.info.time?.completed
  if (typeof completed === 'number' && completed > created) {
    return Math.min(120_000, completed - created)
  }
  const out = part.state?.output ?? ''
  const inp = part.state?.input
  const inpStr = inp ? JSON.stringify(inp) : ''
  return Math.min(60_000, 80 + estimateTokensFromStrings(out, inpStr) * 30)
}

function parseToolError(errorRaw?: string): { name?: string; message?: string } {
  const text = (errorRaw ?? '').trim()
  if (!text) return {}
  const firstColon = text.indexOf(':')
  if (firstColon <= 0) return { name: text, message: text }
  const name = text.slice(0, firstColon).trim()
  const message = text.slice(firstColon + 1).trim()
  return {
    name: name || text,
    message: message || text,
  }
}

function pickFirstString(values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function parseJsonRecord(raw?: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (v && typeof v === 'object') return v as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return null
}

/**
 * 统一提取 task/subagent 的子会话 id。
 * 兼容 running/completed 两阶段里可能出现的字段：
 * - state.metadata.sessionId / sessionID / task_id
 * - state.output 文本中的 task_id: xxx
 * - state.output JSON 的 metadata.sessionId / sessionId
 */
export function extractChildSessionIdFromToolPart(part: ToolPart): string | undefined {
  const input = part.state?.input ?? {}
  const meta = (part.state?.metadata ?? {}) as Record<string, unknown>
  const out = part.state?.output ?? ''
  const outJson = parseJsonRecord(out)
  const outMeta =
    outJson && typeof outJson.metadata === 'object' && outJson.metadata
      ? (outJson.metadata as Record<string, unknown>)
      : {}

  const direct = pickFirstString([
    meta.sessionId,
    meta.sessionID,
    meta.task_id,
    outMeta.sessionId,
    outMeta.sessionID,
    outMeta.task_id,
    outJson?.sessionId,
    outJson?.sessionID,
    outJson?.task_id,
    input.sessionId,
    input.sessionID,
  ])
  if (direct) return direct

  const m = out.match(/task_id:\s*([A-Za-z0-9_-]+)/i)
  if (m?.[1]) return m[1]
  return undefined
}

function durationForText(text: string): number {
  return Math.min(120_000, 50 + text.length * 15)
}

export function isSubagentToolName(tool: string): boolean {
  const t = normalizeToolName(tool)
  return SUBAGENT_TOOLS.has(t)
}

function actionRow(
  actionType: ActionType,
  depth: number
): number {
  if (actionType === 'Think' || actionType === 'Response') return 0
  return depth > 0 ? 2 : 1
}

/**
 * 顺序扫描 assistant 消息的 parts，维护子智能体栈深度，并输出带 row 的动作。
 * 规则：Think/Response 恒为第 0 行；其余在 depth===0 时为第 1 行；在子智能体内部为第 2 行。
 * 子智能体工具：非 completed/error 视为进入（depth++）；completed/error 视为退出（depth--）。
 */
/** 子会话动作在 ActionFlow 中占用的行（第 4 条横轨，0-based = 3） */
export const ACTION_FLOW_CHILD_BRANCH_ROW = 3

export type TaskChildDescriptor = {
  callID: string
  childSessionID: string
  /** 与父段 `buildMappedActionsFromMessages` 中该 task part 的 sortTime 对齐 */
  anchorSortTime: number
  description?: string
}

/**
 * 从父会话消息中收集「已能解析出子 session」的 task/subagent 工具（去重 callID+child）。
 */
export function collectTaskChildDescriptors(messages: OcMessage[]): TaskChildDescriptor[] {
  const out: TaskChildDescriptor[] = []
  const seen = new Set<string>()
  messages.forEach((message) => {
    if (message.info.role !== 'assistant') return
    const baseTime = message.info.time?.created ?? 0
    message.parts.forEach((part, partIndex) => {
      if (part.type !== 'tool' || !isSubagentToolName(part.tool)) return
      const sid = extractChildSessionIdFromToolPart(part)
      if (!sid) return
      const key = `${part.callID}__${sid}`
      if (seen.has(key)) return
      seen.add(key)
      const input = part.state?.input
      const description =
        input && typeof input === 'object' && typeof (input as { description?: unknown }).description === 'string'
          ? String((input as { description: string }).description)
          : undefined
      out.push({
        callID: part.callID,
        childSessionID: sid,
        anchorSortTime: baseTime + partIndex * 0.001,
        description,
      })
    })
  })
  return out
}

/**
 * 将子会话 GET /message 的结果压平到父时间轴上一行（`ACTION_FLOW_CHILD_BRANCH_ROW`），便于与父 Subagent 节点分叉绘制。
 */
export function buildChildSessionBranchActions(
  childMessages: OcMessage[],
  opts: {
    branchChildSessionID: string
    parentTaskCallID: string
    anchorSortTime: number
  },
): (MappedAction & { row: number })[] {
  const inner = buildMappedActionsFromMessages(childMessages)
  if (inner.length === 0) return []
  const minT = Math.min(...inner.map((a) => a.sortTime))
  return inner.map((a, i) => ({
    ...a,
    row: ACTION_FLOW_CHILD_BRANCH_ROW,
    sortTime: opts.anchorSortTime + 0.002 + (a.sortTime - minT) + i * 1e-9,
    source: 'child-session' as const,
    branchChildSessionID: opts.branchChildSessionID,
    parentTaskCallID: opts.parentTaskCallID,
  }))
}

export function buildMappedActionsFromMessages(messages: OcMessage[]): (MappedAction & { row: number })[] {
  const out: (MappedAction & { row: number })[] = []
  let depth = 0

  messages.forEach((message, messageIndex) => {
    if (message.info.role !== 'assistant') return
    const baseTime = message.info.time?.created ?? 0
    const mid = message.info.id

    message.parts.forEach((part, partIndex) => {
      const sortTime = baseTime + partIndex * 0.001
      const mapped = partToMappedAction(part, message, messageIndex, partIndex, sortTime, mid)
      if (!mapped) return

      const row = actionRow(mapped.actionType, depth)
      out.push({ ...mapped, row })

      if (part.type === 'tool' && isSubagentToolName(part.tool)) {
        const st = part.state?.status
        if (st === 'completed' || st === 'error') {
          depth = Math.max(0, depth - 1)
        } else {
          depth += 1
        }
      }
    })
  })

  return out
}

function partToMappedAction(
  part: OcMessagePart,
  message: OcMessage,
  messageIndex: number,
  partIndex: number,
  sortTime: number,
  messageID: string
): MappedAction | null {
  switch (part.type) {
    case 'reasoning': {
      const text = part.text ?? ''
      return {
        actionType: 'Think',
        status: 'completed',
        durationMs: durationForReasoning(part),
        tokenEstimate: estimateTokensFromStrings(text),
        sortTime,
        source: 'part',
        messageID,
        partIndex,
        messageIndex,
        detail: text.slice(0, 80),
      }
    }
    case 'text': {
      const text = part.text ?? ''
      return {
        actionType: 'Response',
        status: 'completed',
        durationMs: durationForText(text),
        tokenEstimate: estimateTokensFromStrings(text),
        sortTime,
        source: 'part',
        messageID,
        partIndex,
        messageIndex,
        detail: text.slice(0, 80),
      }
    }
    case 'compaction':
      return {
        actionType: 'Compaction',
        status: 'completed',
        durationMs: 400,
        tokenEstimate: estimateTokensFromStrings(part.text),
        sortTime,
        source: 'part',
        messageID,
        partIndex,
        messageIndex,
      }
    case 'tool': {
      const mappedType = mapToolToActionType(part.tool)
      if (!mappedType) return null
      const inp = part.state?.input
      const inpStr = inp ? JSON.stringify(inp) : ''
      const outStr = part.state?.output ?? ''
      const errStr = part.state?.error ?? ''
      const parsedErr = parseToolError(errStr)
      const childSessionID = isSubagentToolName(part.tool)
        ? extractChildSessionIdFromToolPart(part)
        : undefined
      const parallelKey = part.callID || childSessionID
      return {
        actionType: mappedType,
        status: toolStatusToActionStatus(part.state?.status),
        durationMs: durationForTool(part, message),
        tokenEstimate: estimateTokensFromStrings(inpStr, outStr, errStr),
        sortTime,
        source: 'part',
        messageID,
        callID: part.callID,
        childSessionID,
        parallelKey,
        partIndex,
        messageIndex,
        detail: part.tool,
        errorName: parsedErr.name,
        errorMessage: parsedErr.message,
      }
    }
    default:
      return null
  }
}

export function mapSseToMappedActions(events: OcSseActionEvent[]): (MappedAction & { row: number })[] {
  const out: (MappedAction & { row: number })[] = []
  for (const ev of events) {
    if (ev.type === 'permission.asked') {
      out.push({
        actionType: 'Permission',
        status: 'pending',
        durationMs: 0,
        tokenEstimate: 0,
        sortTime: ev.time,
        source: 'sse-permission',
        detail: safeDetail(ev.raw),
        row: 1,
      })
    } else if (ev.type === 'session.compacted') {
      out.push({
        actionType: 'Compaction',
        status: 'completed',
        durationMs: 600,
        tokenEstimate: 0,
        sortTime: ev.time,
        source: 'sse-session',
        detail: 'session.compacted',
        row: 1,
      })
    }
  }
  return out
}

function safeDetail(raw: unknown): string {
  try {
    return JSON.stringify(raw).slice(0, 160)
  } catch {
    return ''
  }
}

/** 合并 part 与 SSE 动作，按时间排序；SSE 项保持 row=1（无子任务上下文） */
export function mergeActions(
  fromMessages: (MappedAction & { row: number })[],
  fromSse: (MappedAction & { row: number })[]
): (MappedAction & { row: number })[] {
  return [...fromMessages, ...fromSse].sort((a, b) => a.sortTime - b.sortTime)
}
