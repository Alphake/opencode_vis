/**
 * Action-flow tooltip: English-only labels. Resolves part via `partId` + merged messages.
 */

import type { MappedAction, OcMessage, OcMessagePart, ToolPart } from '../types/opencode'

/** @deprecated Prefer TooltipBodyLine + buildEnglishTooltipContent */
export type TooltipKeyValue = {
  key: string
  value: string
  sourceHint?: string
}

export type TooltipBodyLine =
  | { kind: 'kv'; key: string; value: string }
  | { kind: 'text'; value: string }
  /** Full error text (no truncation); rendered with `pre-wrap` + scroll in CSS */
  | { kind: 'error'; value: string }

export type EnglishTooltipContent = {
  /** Bold first token: `part.type` or tool name for `tool` */
  primaryLabel: string
  /** Status text (no key) */
  statusLabel: string
  body: TooltipBodyLine[]
}

/** Long text in tooltip: no artificial cap (layout grows with content) */
const PREVIEW_SOFT_MAX = 12_000
const URL_LIST_MAX = 8

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/-/g, '_')
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function softCap(s: string, max: number): string {
  return truncate(s, max)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** String field including empty `""` (e.g. `state.title`) */
function stringField(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function formatToolError(err: unknown): string {
  if (err == null) return ''
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err, null, 2)
  } catch {
    return String(err)
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** websearch output: count lines starting with `URL:` */
export function countUrlLinesInToolOutput(output: string | undefined): number {
  if (!output) return 0
  const m = output.match(/^URL:\s*\S+/gm)
  return m?.length ?? 0
}

export function extractUrlsFromSearchOutput(output: string | undefined, limit = URL_LIST_MAX): string[] {
  if (!output) return []
  const re = /^URL:\s*(https?:\/\/\S+)/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) && out.length < limit) {
    out.push(m[1]!)
  }
  return out
}

export function parseWebsearchTitleQuery(title: string | undefined): string | undefined {
  if (!title) return undefined
  const m = title.match(/^Web\s*search:\s*(.+)$/i)
  return m?.[1]?.trim() || undefined
}

type TodoRaw = { status?: string; content?: string; id?: string }

function countCompleted(todos: TodoRaw[]): number {
  return todos.filter((t) => (t.status ?? '') === 'completed').length
}

function countPending(todos: TodoRaw[]): number {
  return todos.filter((t) => {
    const s = (t.status ?? '').toLowerCase()
    return s === 'pending' || s === 'in_progress'
  }).length
}

function getTodosArray(part: ToolPart): TodoRaw[] {
  const meta = part.state?.metadata as Record<string, unknown> | undefined
  const input = part.state?.input as Record<string, unknown> | undefined
  const raw = meta?.todos ?? input?.todos
  return Array.isArray(raw) ? (raw as TodoRaw[]) : []
}

/** All `todowrite` tool parts in timeline order (assistant messages only). */
function collectTodowriteToolParts(messages: OcMessage[]): ToolPart[] {
  const out: ToolPart[] = []
  for (const message of messages) {
    if (message.info.role !== 'assistant') continue
    for (const p of message.parts) {
      if (p.type === 'tool' && normalizeToolName(p.tool) === 'todowrite') {
        out.push(p)
      }
    }
  }
  return out
}

function buildTodowriteLines(part: ToolPart, allMessages: OcMessage[] | undefined): TooltipBodyLine[] {
  const curr = getTodosArray(part)
  const msgs = allMessages ?? []
  const list = collectTodowriteToolParts(msgs)
  const idx = list.findIndex((p) => p.id === part.id)
  const prev = idx > 0 ? getTodosArray(list[idx - 1]!) : undefined
  const isInitial = idx <= 0

  const prevCompleted = prev ? countCompleted(prev) : 0
  const currCompleted = countCompleted(curr)
  const currPending = countPending(curr)
  const total = curr.length
  const completedThisRun = Math.max(0, currCompleted - prevCompleted)

  const lines: TooltipBodyLine[] = [
    {
      kind: 'kv',
      key: 'Operation',
      value: isInitial ? 'Initial todo list' : 'Update todo list',
    },
    {
      kind: 'kv',
      key: 'Completed this run',
      value: String(completedThisRun),
    },
    {
      kind: 'kv',
      key: 'Total completed',
      value: `${currCompleted} / ${total}`,
    },
    {
      kind: 'kv',
      key: 'Pending',
      value: String(currPending),
    },
  ]
  return lines
}

function getToolStatus(part: ToolPart): string {
  const s = part.state?.status
  if (s === 'error') return 'error'
  return s ?? 'unknown'
}

function getNonToolStatus(_part: OcMessagePart): string {
  return 'completed'
}

/** Bold label: tool name or `part.type` */
export function getPrimaryLabel(part: OcMessagePart): string {
  if (part.type === 'tool') return part.tool
  return part.type
}

export function getStatusLabel(part: OcMessagePart): string {
  if (part.type === 'tool') return getToolStatus(part)
  return getNonToolStatus(part)
}

function englishToolBody(part: ToolPart, ctx: { allMessages?: OcMessage[] }): TooltipBodyLine[] {
  const tool = normalizeToolName(part.tool)
  const st = part.state
  const status = st?.status ?? 'unknown'
  const input = (st?.input ?? {}) as Record<string, unknown>
  const meta = (st?.metadata ?? {}) as Record<string, unknown>
  const err = st?.error

  if (status === 'error') {
    const full = formatToolError(err)
    return [{ kind: 'error', value: full || '(no error message)' }]
  }

  switch (tool) {
    case 'read': {
      const fpRaw = stringField(input.filePath as string | undefined) ?? stringField(st?.title as string | undefined)
      const lines: TooltipBodyLine[] = []
      if (fpRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'Read file',
          value: fpRaw === '' ? '(empty)' : fpRaw,
        })
      }
      const lim = num(input.limit)
      if (lim !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'Limit (max lines)',
          value: `${lim} — max lines to read from the file (line cap, not bytes).`,
        })
      }
      return lines
    }
    case 'write': {
      const pathRaw =
        stringField(st?.title as string | undefined) ?? stringField(input.filePath as string | undefined)
      const outRaw = stringField(st?.output as string | undefined)
      const lines: TooltipBodyLine[] = []
      if (pathRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'Write file',
          value: pathRaw === '' ? '(empty)' : pathRaw,
        })
      }
      if (outRaw !== undefined) {
        lines.push({ kind: 'text', value: outRaw === '' ? '(empty)' : outRaw })
      }
      return lines
    }
    case 'edit': {
      const fpRaw = stringField(input.filePath as string | undefined) ?? stringField(st?.title as string | undefined)
      const outRaw = stringField(st?.output as string | undefined)
      const lines: TooltipBodyLine[] = []
      if (fpRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'Edit file',
          value: fpRaw === '' ? '(empty)' : fpRaw,
        })
      }
      if (outRaw !== undefined) {
        lines.push({ kind: 'text', value: outRaw === '' ? '(empty)' : outRaw })
      }
      return lines
    }
    case 'todowrite':
    case 'todoread':
    case 'todo_read':
      return buildTodowriteLines(part, ctx.allMessages)
    case 'bash':
    case 'shell': {
      const lines: TooltipBodyLine[] = []
      const titleRaw = stringField(st?.title as string | undefined)
      if (titleRaw !== undefined) {
        lines.push({ kind: 'text', value: titleRaw === '' ? '(empty)' : titleRaw })
      }
      const cmdRaw = stringField(input.command as string | undefined)
      if (cmdRaw !== undefined) {
        lines.push({ kind: 'kv', key: 'command', value: cmdRaw === '' ? '(empty)' : cmdRaw })
      }
      return lines
    }
    case 'task':
    case 'subtask':
    case 'subagent':
    case 'agent': {
      const stypeRaw = stringField(input.subagent_type as string | undefined)
      const descRaw = stringField(input.description as string | undefined)
      const titleRaw = stringField(st?.title as string | undefined)
      const lines: TooltipBodyLine[] = []
      if (titleRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'title',
          value: titleRaw === '' ? '(empty)' : titleRaw,
        })
      }
      if (stypeRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'subagent',
          value: stypeRaw === '' ? '(empty)' : stypeRaw,
        })
      }
      if (descRaw !== undefined) {
        lines.push({
          kind: 'kv',
          key: 'description',
          value: descRaw === '' ? '(empty)' : descRaw,
        })
      }
      return lines
    }
    case 'grep': {
      const pat = str(input.pattern) ?? ''
      const cnt = num(meta.count)
      const lines: TooltipBodyLine[] = [{ kind: 'kv', key: 'Match', value: pat }]
      if (cnt === 0) lines.push({ kind: 'kv', key: 'result num', value: 'No files found' })
      else lines.push({ kind: 'kv', key: 'result num', value: cnt !== undefined ? String(cnt) : '—' })
      return lines
    }
    case 'glob': {
      const pat = str(input.pattern) ?? '*'
      const cnt = num(meta.count)
      const lines: TooltipBodyLine[] = [{ kind: 'kv', key: 'Match', value: pat }]
      if (cnt === 0) lines.push({ kind: 'kv', key: 'result num', value: 'No files found' })
      else lines.push({ kind: 'kv', key: 'result num', value: cnt !== undefined ? String(cnt) : '—' })
      return lines
    }
    case 'webfetch': {
      const lines: TooltipBodyLine[] = []
      const t = stringField(st?.title as string | undefined)
      const url = stringField(input.url as string | undefined)
      if (t !== undefined) lines.push({ kind: 'kv', key: 'Web fetch', value: t === '' ? '(empty)' : t })
      if (url !== undefined) lines.push({ kind: 'kv', key: 'URL', value: url === '' ? '(empty)' : url })
      return lines
    }
    case 'websearch': {
      const titleForQuery = typeof st?.title === 'string' ? st.title : undefined
      const q = str(input.query) ?? parseWebsearchTitleQuery(titleForQuery)
      const nReq = num(input.numResults)
      const outRaw = stringField(st?.output as string | undefined)
      const lines: TooltipBodyLine[] = []
      lines.push({ kind: 'kv', key: 'web search', value: q ?? '(empty)' })
      if (nReq !== undefined) lines.push({ kind: 'kv', key: 'results num', value: String(nReq) })
      if (outRaw) {
        const urls = extractUrlsFromSearchOutput(outRaw, URL_LIST_MAX)
        for (const u of urls) {
          lines.push({ kind: 'kv', key: 'URL', value: u })
        }
      }
      return lines
    }
    case 'list': {
      const p = str(input.path)
      if (p) return [{ kind: 'kv', key: 'List directory', value: p }]
      return []
    }
    case 'codesearch': {
      const q = str(input.query)
      if (q) return [{ kind: 'kv', key: 'Search', value: q }]
      return []
    }
    case 'question': {
      const qs = input.questions
      const lines: TooltipBodyLine[] = []
      if (Array.isArray(qs)) {
        lines.push({ kind: 'kv', key: 'Questions', value: String(qs.length) })
      }
      return lines
    }
    case 'skill': {
      const n = str(input.name)
      if (n) return [{ kind: 'kv', key: 'Skill', value: n }]
      return []
    }
    case 'apply_patch': {
      const files = meta.files
      if (Array.isArray(files)) {
        return [{ kind: 'kv', key: 'Files', value: String(files.length) }]
      }
      if (title) return [{ kind: 'kv', key: 'Patch', value: title }]
      return []
    }
    default: {
      const lines: TooltipBodyLine[] = []
      const titleRaw = stringField(st?.title as string | undefined)
      const outRaw = stringField(st?.output as string | undefined)
      if (titleRaw !== undefined) {
        lines.push({ kind: 'kv', key: 'Title', value: titleRaw === '' ? '(empty)' : softCap(titleRaw, PREVIEW_SOFT_MAX) })
      }
      if (outRaw !== undefined) {
        lines.push({ kind: 'kv', key: 'Output', value: outRaw === '' ? '(empty)' : softCap(outRaw, PREVIEW_SOFT_MAX) })
      }
      return lines
    }
  }
}

function englishNonToolBody(part: OcMessagePart): TooltipBodyLine[] {
  switch (part.type) {
    case 'reasoning': {
      const text = part.text?.trim() ?? ''
      return [{ kind: 'kv', key: 'Preview', value: text ? softCap(text, PREVIEW_SOFT_MAX) : '(empty)' }]
    }
    case 'text': {
      const text = part.text?.trim() ?? ''
      return [{ kind: 'kv', key: 'Preview', value: text ? softCap(text, PREVIEW_SOFT_MAX) : '(empty)' }]
    }
    case 'compaction':
      return [{ kind: 'kv', key: 'Note', value: 'Context compaction (summary may follow in session).' }]
    default:
      return [{ kind: 'kv', key: 'Part', value: part.type }]
  }
}

export function buildEnglishTooltipContent(
  part: OcMessagePart,
  ctx: { allMessages?: OcMessage[] } = {}
): EnglishTooltipContent {
  const primaryLabel = getPrimaryLabel(part)
  const statusLabel = getStatusLabel(part)

  if (part.type === 'tool') {
    return {
      primaryLabel,
      statusLabel,
      body: englishToolBody(part, ctx),
    }
  }
  return {
    primaryLabel,
    statusLabel,
    body: englishNonToolBody(part),
  }
}

export function formatEnglishTooltipContentHtml(content: EnglishTooltipContent, escapeHtml: (s: string) => string): string {
  const head = `<div class="action-tip-head"><strong class="action-tip-primary">${escapeHtml(content.primaryLabel)}</strong><span class="action-tip-status">${escapeHtml(content.statusLabel)}</span></div>`
  const bodyHtml = content.body
    .map((line) => {
      if (line.kind === 'kv') {
        return `<div class="action-tip-kv"><span class="action-tip-k">${escapeHtml(line.key)}</span><span class="action-tip-v">${escapeHtml(line.value)}</span></div>`
      }
      if (line.kind === 'error') {
        return `<div class="action-tip-error">${escapeHtml(line.value)}</div>`
      }
      return `<div class="action-tip-text">${escapeHtml(line.value)}</div>`
    })
    .join('')
  return `${head}<div class="action-tip-body">${bodyHtml}</div>`
}

/**
 * @deprecated legacy Chinese KV builder
 */
export function buildTooltipKeyValuesFromPart(part: OcMessagePart, _ctx?: { cwd?: string }): TooltipKeyValue[] {
  const c = buildEnglishTooltipContent(part, {})
  return c.body
    .filter((l): l is { kind: 'kv'; key: string; value: string } => l.kind === 'kv')
    .map((l) => ({ key: l.key, value: l.value }))
}

export function mergeMessagesForActionTooltipLookup(
  segmentMessages: OcMessage[],
  childBranchMessages: OcMessage[]
): OcMessage[] {
  return [...segmentMessages, ...childBranchMessages]
}

export function resolvePartForAction(
  allMessages: OcMessage[],
  act: Pick<MappedAction, 'partId' | 'messageIndex' | 'partIndex'>
): OcMessagePart | undefined {
  if (act.partId) {
    for (const msg of allMessages) {
      const p = msg.parts.find((pr) => pr.id === act.partId)
      if (p) return p
    }
    return undefined
  }
  if (act.messageIndex !== undefined && act.partIndex !== undefined) {
    const msg = allMessages[act.messageIndex]
    if (!msg || msg.info.role !== 'assistant') return undefined
    return msg.parts[act.partIndex]
  }
  return undefined
}

/** @deprecated 使用 resolvePartForAction + mergeMessagesForActionTooltipLookup */
export function resolvePartForMappedAction(
  messages: OcMessage[],
  messageIndex: number | undefined,
  partIndex: number | undefined
): OcMessagePart | undefined {
  return resolvePartForAction(messages, { partId: undefined, messageIndex, partIndex })
}

export function formatTooltipKeyValuesAsHtml(
  rows: TooltipKeyValue[],
  escapeHtml: (s: string) => string
): string {
  return rows
    .map(
      (r) =>
        `<div class="action-tip-kv"><span class="action-tip-k">${escapeHtml(r.key)}</span><span class="action-tip-v">${escapeHtml(r.value)}</span></div>`
    )
    .join('')
}
