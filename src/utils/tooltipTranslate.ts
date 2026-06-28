import type { OcMessage } from '../types/opencode'
import type { MemoryWorkerErrorDiagnosis } from '../services/memoryWorkerApi'
import { isTooltipTranslateEnabledForSession } from '../config/tooltipTranslateSessions'

export type TooltipTranslateFn = (text: string) => string

const LS_PREFIX = 'vibetrace-tooltip-translate:'
const MYMEMORY_MAX_CHARS = 480
const TRANSLATE_CONCURRENCY = 3

const memoryCache = new Map<string, Map<string, string>>()
const inflight = new Set<string>()
const listeners = new Set<() => void>()

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/

export function containsCjk(text: string): boolean {
  return CJK_RE.test(text)
}

function cacheKey(sessionId: string, text: string): string {
  return `${sessionId}\0${text}`
}

function getSessionCache(sessionId: string): Map<string, string> {
  let map = memoryCache.get(sessionId)
  if (map) return map
  map = new Map()
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${sessionId}`)
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') map.set(k, v)
      }
    }
  } catch {
    /* ignore corrupt cache */
  }
  memoryCache.set(sessionId, map)
  return map
}

function persistSessionCache(sessionId: string): void {
  const map = memoryCache.get(sessionId)
  if (!map) return
  try {
    const obj: Record<string, string> = {}
    for (const [k, v] of map.entries()) obj[k] = v
    localStorage.setItem(`${LS_PREFIX}${sessionId}`, JSON.stringify(obj))
  } catch {
    /* quota / private mode */
  }
}

export function subscribeTooltipTranslateCache(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyListeners(): void {
  for (const fn of listeners) fn()
}

async function fetchMyMemoryTranslation(text: string): Promise<string> {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += MYMEMORY_MAX_CHARS) {
    chunks.push(text.slice(i, i + MYMEMORY_MAX_CHARS))
  }
  const parts: string[] = []
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=zh-CN|en`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`translate HTTP ${res.status}`)
    const data = (await res.json()) as {
      responseData?: { translatedText?: string }
      responseStatus?: number
    }
    const translated = data.responseData?.translatedText?.trim()
    if (!translated || data.responseStatus === 429) {
      throw new Error('translate rate limited or empty')
    }
    parts.push(translated)
  }
  return parts.join('')
}

async function translateAndStore(sessionId: string, text: string): Promise<void> {
  if (!containsCjk(text)) return
  const cache = getSessionCache(sessionId)
  if (cache.has(text)) return
  try {
    const translated = await fetchMyMemoryTranslation(text)
    if (translated && translated !== text) {
      cache.set(text, translated)
      persistSessionCache(sessionId)
      notifyListeners()
    }
  } catch {
    /* keep original on failure */
  }
}

function queueTranslation(sessionId: string, text: string): void {
  if (!containsCjk(text)) return
  const cache = getSessionCache(sessionId)
  if (cache.has(text)) return
  const key = cacheKey(sessionId, text)
  if (inflight.has(key)) return
  inflight.add(key)
  void translateAndStore(sessionId, text).finally(() => inflight.delete(key))
}

/** Sync lookup: cached translation or original (queues async fetch on miss). */
export function lookupTooltipTranslation(sessionId: string, text: string): string {
  if (!text || !containsCjk(text)) return text
  const cached = getSessionCache(sessionId).get(text)
  if (cached) return cached
  queueTranslation(sessionId, text)
  return text
}

export function createTooltipTranslateFn(sessionId: string | undefined): TooltipTranslateFn | undefined {
  if (!sessionId || !isTooltipTranslateEnabledForSession(sessionId)) return undefined
  return (text: string) => lookupTooltipTranslation(sessionId, text)
}

function collectFromDiagnosis(d: MemoryWorkerErrorDiagnosis | undefined, out: Set<string>): void {
  if (!d) return
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && containsCjk(v)) out.add(v.trim())
  }
  push(d.error)
  const dx = d.diagnosis
  if (!dx) return
  push(dx.summary)
  push(dx.rootCause)
  push(dx.fixSuggestion)
  for (const x of dx.causalChain ?? []) push(x)
  for (const x of dx.evidence ?? []) push(x)
}

function collectFromMessages(messages: OcMessage[], out: Set<string>): void {
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && containsCjk(v)) out.add(v.trim())
  }

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === 'text' || part.type === 'reasoning') {
        push(part.text)
      }
      if (part.type === 'tool') {
        const st = part.state
        push(st?.title)
        push(st?.output)
        push(st?.error)
        const input = st?.input as Record<string, unknown> | undefined
        if (input) {
          push(input.filePath)
          push(input.path)
          push(input.pattern)
          push(input.query)
          push(input.url)
          push(input.description)
          push(input.content)
          push(input.name)
          const qs = input.questions as Array<{ header?: string }> | undefined
          if (Array.isArray(qs)) {
            for (const q of qs) push(q?.header)
          }
        }
      }
    }
  }
}

export function collectTooltipTranslatableStrings(
  messages: OcMessage[],
  extras?: {
    diagnoses?: MemoryWorkerErrorDiagnosis[]
    actionDetails?: string[]
  },
): string[] {
  const out = new Set<string>()
  collectFromMessages(messages, out)
  for (const d of extras?.diagnoses ?? []) collectFromDiagnosis(d, out)
  for (const detail of extras?.actionDetails ?? []) {
    if (detail.trim() && containsCjk(detail)) out.add(detail.trim())
  }
  return [...out]
}

export async function prewarmTooltipTranslations(sessionId: string, strings: Iterable<string>): Promise<void> {
  if (!isTooltipTranslateEnabledForSession(sessionId)) return
  const pending = [...new Set(strings)].filter((s) => containsCjk(s) && !getSessionCache(sessionId).has(s))
  if (pending.length === 0) return

  for (let i = 0; i < pending.length; i += TRANSLATE_CONCURRENCY) {
    const batch = pending.slice(i, i + TRANSLATE_CONCURRENCY)
    await Promise.all(batch.map((s) => translateAndStore(sessionId, s)))
    await new Promise((r) => setTimeout(r, 120))
  }
}
