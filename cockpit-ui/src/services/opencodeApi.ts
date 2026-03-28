const BASE = 'http://127.0.0.1:4096'

import type {
  OcSession,
  OcTodo,
  OcMessage,
} from '../types/opencode'

// ===== REST API =====

export async function getSessions(): Promise<OcSession[]> {
  const res = await fetch(`${BASE}/session`)
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  const data = await res.json()
  console.log('[API] getSessions returned:', Array.isArray(data) ? `${data.length} sessions` : data)
  return data
}

export async function getTodos(sessionId: string): Promise<OcTodo[]> {
  const res = await fetch(`${BASE}/session/${sessionId}/todo`)
  if (!res.ok) throw new Error(`Failed to fetch todos: ${res.status}`)
  return res.json()
}

export async function getMessages(sessionId: string): Promise<OcMessage[]> {
  const res = await fetch(`${BASE}/session/${sessionId}/message`)
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`)
  return res.json()
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  const res = await fetch(`${BASE}/session/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text }] }),
  })
  if (!res.ok) throw new Error(`Failed to send message: ${res.status}`)
}

export async function getDiff(sessionId: string): Promise<any[]> {
  const res = await fetch(`${BASE}/session/${sessionId}/diff`)
  if (!res.ok) throw new Error(`Failed to fetch diff: ${res.status}`)
  return res.json()
}

// ===== SSE (real-time events) =====

// SSE 端点说明（来自 opencode 源码分析）：
// - GET /global/event → 全局事件流（跨 workspace，事件包含 directory 字段）
// - GET /event       → 当前 workspace 事件流
// - ❌ 没有 /session/:id/event 端点！（会 fallthrough 到 app.opencode.ai 代理）
// 客户端需要从 /global/event 事件中按 directory 或 session 过滤

export function subscribeGlobalEvents(
  onEvent: (event: any) => void
): () => void {
  const url = `${BASE}/global/event`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data)
      console.log('[SSE] Global event:', parsed?.payload?.type || parsed?.type, parsed)
      onEvent(parsed)
    } catch {
      console.warn('[SSE] Failed to parse global event:', e.data)
    }
  }

  es.onerror = (err) => {
    console.warn('[SSE] Global connection error, reconnecting...', err)
  }

  return () => es.close()
}
