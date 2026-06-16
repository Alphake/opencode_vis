import type { IngestTracePayload } from '../types/trace'

function resolveMemoryWorkerBase(): string {
  const raw = import.meta.env.VITE_MEMORY_WORKER_BASE
  // 空字符串或未配置 = 同源 /ingest-trace，由 Vite 代理到 memory-worker（plugin 模式）
  if (raw === undefined || raw === '') return ''
  if (typeof raw === 'string') return raw.trim().replace(/\/$/, '')
  return ''
}

const BASE = resolveMemoryWorkerBase()

function parseMemoryWorkerJson<T>(text: string, endpoint: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    const preview = text.trim().slice(0, 80)
    throw new Error(`memory-worker ${endpoint} returned non-JSON (${preview}). Check Vite proxy / worker restart.`)
  }
}

export interface MemoryWorkerIngestResult {
  ok: boolean
  runId?: string
  runDir?: string
  error?: string
  /** Worker returned an existing run instead of starting a second pipeline. */
  duplicate?: boolean
  dedupKey?: string
  reason?: string
  taskSwitch?: {
    runDir?: string
    mode?: string
    decision?: unknown
  }
  extractedTask?: MemoryWorkerTaskSegment
  pendingTask?: MemoryWorkerTaskSegment
  errorDiagnosis?: MemoryWorkerErrorDiagnosisBatch
  [key: string]: unknown
}

export interface MemoryWorkerErrorDiagnosis {
  status: 'running' | 'ok' | 'failed' | string
  dedupKey?: string
  signatureHash?: string
  sessionId?: string
  endAssistantMessageId?: string
  subtaskIndex?: number
  subtaskId?: string
  hasError?: boolean
  runDir?: string
  diagnosisSessionID?: string
  diagnosis?: {
    summary?: string
    rootCause?: string
    causalChain?: string[]
    evidence?: string[]
    fixSuggestion?: string
    confidence?: 'high' | 'medium' | 'low' | string
    [key: string]: unknown
  }
  errorActions?: Array<{
    index?: number
    type?: string
    tool?: string | null
    status?: string
    error?: unknown
  }>
  error?: string
  cached?: boolean
  [key: string]: unknown
}

export interface MemoryWorkerErrorDiagnosisBatch {
  ok: boolean
  count: number
  items: MemoryWorkerErrorDiagnosis[]
  reason?: string
  error?: string
}

export interface MemoryWorkerTaskSegment {
  taskId?: string
  fromStartUserMessageId: string
  fromEndAssistantMessageId: string
  toEndAssistantMessageId: string
  turnCount: number
  title?: string
  description?: string
  summary?: string
  nextPendingEndAssistantMessageId?: string
}

export interface TaskSkillRecord {
  skillName: string
  skillPath: string
  status: string
  operation?: string
  rationale?: string
  createdAt?: string
  feedbackRunDir?: string
}

export interface TaskSkillsResult {
  ok: boolean
  sessionId: string
  taskId: string
  status: string
  skills: TaskSkillRecord[]
  skillWriteRoot?: string
  discoveredCount?: number
  error?: string
}

export interface TaskSkillDetailResult {
  ok: boolean
  sessionId: string
  taskId: string
  skill: TaskSkillRecord
  skillMd: string
  skillMdPath: string
  skillReadError?: string
  provenance?: unknown
  feedback?: {
    runDir?: string
    request?: unknown
    analysis?: unknown
    result?: unknown
    error?: string
  }
  error?: string
}

export interface FeedbackDistillRequest {
  sessionId: string
  taskId: string
  directory?: string
  parentSessionID?: string
  taskSegment?: unknown
  selectedAnchor?: unknown
  comment: string
  feedbackContext?: unknown
}

export interface IngestContext {
  directory?: string
  parentSessionID?: string
}

export interface ForkMetaReference {
  forkAnchorMessageId: string
  forkAnchorPartId?: string
  sourceParentSessionId: string
  forkedSessionId: string
}

export interface IngestReference {
  sessionId: string
  endAssistantMessageId: string
  directory?: string
  maxTurns?: number
  parentSessionID?: string
  forkMeta?: ForkMetaReference
}

export interface TaskSwitchPromptReference {
  sessionId: string
  userPrompt: string
  directory?: string
  parentSessionID?: string
  forkMeta?: ForkMetaReference
}

export async function notifyTaskSwitchPrompt(
  ref: TaskSwitchPromptReference,
): Promise<MemoryWorkerIngestResult> {
  const res = await fetch(`${BASE}/task-switch-prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ref),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /task-switch-prompt failed: ${res.status} ${text}`)
  }
  return parseMemoryWorkerJson<MemoryWorkerIngestResult>(text, '/task-switch-prompt')
}

export async function ingestTraceReference(
  ref: IngestReference,
): Promise<MemoryWorkerIngestResult> {
  const res = await fetch(`${BASE}/ingest-trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ref),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /ingest-trace failed: ${res.status} ${text}`)
  }
  try {
    return JSON.parse(text) as MemoryWorkerIngestResult
  } catch {
    throw new Error('memory-worker /ingest-trace returned non-JSON')
  }
}

export async function fetchTaskSkills(sessionId: string, taskId: string, directory?: string): Promise<TaskSkillsResult> {
  const qs = new URLSearchParams({ sessionId, taskId })
  if (directory?.trim()) qs.set('directory', directory.trim())
  const res = await fetch(`${BASE}/task-skills?${qs.toString()}`)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /task-skills failed: ${res.status} ${text}`)
  }
  return parseMemoryWorkerJson<TaskSkillsResult>(text, '/task-skills')
}

export async function fetchPanelAnalysisForSession(
  sessionId: string,
): Promise<MemoryWorkerErrorDiagnosisBatch> {
  const qs = new URLSearchParams({ sessionId })
  const res = await fetch(`${BASE}/panel-analysis?${qs.toString()}`)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /panel-analysis failed: ${res.status} ${text}`)
  }
  return parseMemoryWorkerJson<MemoryWorkerErrorDiagnosisBatch>(text, '/panel-analysis')
}

export async function fetchTaskSkillDetail(
  sessionId: string,
  taskId: string,
  skillKey: string,
): Promise<TaskSkillDetailResult> {
  const qs = new URLSearchParams({ sessionId, taskId, skillKey })
  const res = await fetch(`${BASE}/task-skill-detail?${qs.toString()}`)
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /task-skill-detail failed: ${res.status} ${text}`)
  }
  return parseMemoryWorkerJson<TaskSkillDetailResult>(text, '/task-skill-detail')
}

export async function distillTaskFeedback(req: FeedbackDistillRequest): Promise<TaskSkillsResult & { runDir?: string; skill?: TaskSkillRecord }> {
  const res = await fetch(`${BASE}/task-feedback-distill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /task-feedback-distill failed: ${res.status} ${text}`)
  }
  return parseMemoryWorkerJson<TaskSkillsResult & { runDir?: string; skill?: TaskSkillRecord }>(text, '/task-feedback-distill')
}

/** @deprecated Prefer `ingestTraceReference`; full trace payloads are kept for compatibility. */
export async function ingestTraceToMemoryWorker(
  trace: IngestTracePayload,
  context?: IngestContext,
): Promise<MemoryWorkerIngestResult> {
  const res = await fetch(`${BASE}/ingest-trace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      trace,
      directory: context?.directory,
      parentSessionID: context?.parentSessionID,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`memory-worker /ingest-trace failed: ${res.status} ${text}`)
  }
  try {
    return JSON.parse(text) as MemoryWorkerIngestResult
  } catch {
    throw new Error('memory-worker /ingest-trace returned non-JSON')
  }
}

