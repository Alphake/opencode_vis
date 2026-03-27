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
  return res.json()
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

// ===== SSE (real-time events) =====

export function subscribeSessionEvents(
  sessionId: string,
  onEvent: (event: any) => void
): () => void {
  const url = `${BASE}/session/${sessionId}/event`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data))
    } catch {
      console.warn('Failed to parse SSE event:', e.data)
    }
  }

  es.onerror = () => {
    console.warn('SSE connection error, reconnecting...')
  }

  return () => es.close()
}

export function subscribeGlobalEvents(
  onEvent: (event: any) => void
): () => void {
  const url = `${BASE}/global/event`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data))
    } catch {
      console.warn('Failed to parse global SSE event:', e.data)
    }
  }

  es.onerror = () => {
    console.warn('Global SSE connection error, reconnecting...')
  }

  return () => es.close()
}
