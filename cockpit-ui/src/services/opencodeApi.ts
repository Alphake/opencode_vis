const BASE = 'http://127.0.0.1:4096'

import type {
  OcSession,
  OcTodo,
  OcMessage,
} from '../types/opencode'

const LOG = {
  http: '[OpenCode · HTTP]',
  sseRaw: '[OpenCode · SSE · 原始 data 字符串]',
  sseParsed: '[OpenCode · SSE · 解析后 JSON]',
} as const

function clip(s: string, n = 1200): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}… (${s.length} chars)`
}

/** 多项目目录下，与创建会话时一致，后续 message/todo 等请求也必须带此头，否则 OpenCode 会路由到错误实例（表现为无回复、空响应等）。 */
function withDirectoryHeaders(base: Record<string, string>, directory?: string): Record<string, string> {
  if (!directory) return base
  return { ...base, 'x-opencode-directory': directory }
}

// ===== REST API =====

export async function getSessions(options?: { directory?: string }): Promise<OcSession[]> {
  const params = new URLSearchParams()
  if (options?.directory) params.set('directory', options.directory)
  const qs = params.toString()
  const url = qs ? `${BASE}/session?${qs}` : `${BASE}/session`
  console.log(`${LOG.http} GET 会话列表`, url, options?.directory ? { directory: options.directory } : '')
  const res = await fetch(url, { headers: withDirectoryHeaders({}, options?.directory) })
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`)
  const data = await res.json()
  console.log(`${LOG.http} GET /session 响应`, Array.isArray(data) ? `${data.length} sessions` : data)
  return data
}

/**
 * 新建会话。可选 `directory` 会通过 `x-opencode-directory` 传给 OpenCode，与桌面/Web 多项目切换一致。
 * 不传则使用服务端当前工作区目录。
 *
 * 部分版本在带 directory 创建时会返回 **200 但 body 为空**；此时会再拉取该目录下的 session 列表并取最新一条作为新建结果。
 */
export async function createSession(directory?: string): Promise<OcSession> {
  const url = `${BASE}/session`
  const headers = withDirectoryHeaders({ 'Content-Type': 'application/json' }, directory)
  console.log(`${LOG.http} POST 新建会话`, url, directory ? { directory } : {})
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`Failed to create session: ${res.status} ${bodyText}`)
  }
  const trimmed = bodyText.trim()
  if (trimmed) {
    try {
      const data = JSON.parse(trimmed) as OcSession
      console.log(`${LOG.http} POST /session 响应`, data?.id, data?.directory)
      return data
    } catch {
      console.warn(`${LOG.http} POST /session 200 但 JSON 解析失败`, clip(trimmed, 400))
    }
  } else {
    console.warn(
      `${LOG.http} POST /session 200 且 body 为空，改为 GET /session?directory=… 取最新会话（OpenCode 多目录已知行为）`,
    )
  }

  const list = await getSessions(directory ? { directory } : undefined)
  const sorted = [...list].sort((a, b) => b.time.updated - a.time.updated)
  const pick = sorted[0]
  if (!pick) {
    throw new Error(
      'Create session: empty response and no sessions returned for this directory. Check OpenCode server logs.',
    )
  }
  console.log(`${LOG.http} 选用列表最新会话作为新建结果`, pick.id, pick.directory)
  return pick
}

/** PATCH /session/:id，更新标题（OpenCode：session.update） */
export async function updateSessionTitle(
  sessionId: string,
  title: string,
  directory?: string,
): Promise<OcSession> {
  const url = `${BASE}/session/${sessionId}`
  console.log(`${LOG.http} PATCH 会话标题`, url, { title: clip(title, 80) }, directory ? { directory } : '')
  const res = await fetch(url, {
    method: 'PATCH',
    headers: withDirectoryHeaders({ 'Content-Type': 'application/json' }, directory),
    body: JSON.stringify({ title }),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`Failed to update session title: ${res.status} ${bodyText}`)
  }
  const data = JSON.parse(bodyText) as OcSession
  console.log(`${LOG.http} PATCH /session 响应`, data?.id, data?.title)
  return data
}

export async function getTodos(sessionId: string, directory?: string): Promise<OcTodo[]> {
  const url = `${BASE}/session/${sessionId}/todo`
  console.log(`${LOG.http} GET todos`, url, directory ? { directory } : '')
  const res = await fetch(url, { headers: withDirectoryHeaders({}, directory) })
  if (!res.ok) throw new Error(`Failed to fetch todos: ${res.status}`)
  const data = await res.json()
  console.log(`${LOG.http} GET /todo 响应`, data.length, '条', data)
  return data
}

export async function getMessages(sessionId: string, reason?: string, directory?: string): Promise<OcMessage[]> {
  const url = `${BASE}/session/${sessionId}/message`
  console.log(`${LOG.http} GET 消息列表（完整对话 JSON）`, url, reason ? `← ${reason}` : '', directory ? { directory } : '')
  const res = await fetch(url, { headers: withDirectoryHeaders({}, directory) })
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`)
  const data = await res.json()
  console.log(`${LOG.http} GET /message 响应: ${data.length} 条消息（正文以本接口为准，不在 SSE 里）`)
  data.forEach((msg: OcMessage, i: number) => {
    console.log(`  [${i}] role=${msg.info.role}, parts=${msg.parts.length}, id=${msg.info.id}`)
    msg.parts.forEach((part, j) => {
      console.log(`       part[${j}]: type=${part.type}`)
    })
  })
  return data
}

/** 与 OpenCode POST /session/:id/message 对齐；服务端会为 part 补全 id */
export type UserMessagePartBody =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: string; media_type: string; data: string }
    }

/**
 * 发送用户消息。`text` 为单条 text part（通常已含 harness 引导）；`images` 会先作为 image parts 再跟 text（便于视觉模型）。
 */
export async function sendMessage(
  sessionId: string,
  text: string,
  directory?: string,
  options?: { imageParts?: Array<{ media_type: string; data: string }> },
): Promise<void> {
  const url = `${BASE}/session/${sessionId}/message`
  const imageParts: UserMessagePartBody[] = (options?.imageParts ?? []).map((img) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: img.media_type,
      data: img.data,
    },
  }))
  const parts: UserMessagePartBody[] = [...imageParts, { type: 'text', text }]
  const reqBody = { parts }
  console.log(
    `${LOG.http} POST 发送用户消息`,
    url,
    { parts: parts.length, 预览: clip(text, 200) },
    directory ? { directory } : '',
  )
  const res = await fetch(url, {
    method: 'POST',
    headers: withDirectoryHeaders({ 'Content-Type': 'application/json' }, directory),
    body: JSON.stringify(reqBody),
  })
  const bodyText = await res.text()
  console.log(
    `${LOG.http} POST /message 响应 status=${res.status}（多为「本轮处理结束」后返回；body 见下，通常不是完整流式过程）`,
    clip(bodyText, 800),
  )
  if (!res.ok) throw new Error(`Failed to send message: ${res.status} ${bodyText}`)
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('text/html') || /^\s*</i.test(bodyText)) {
    throw new Error(
      `[OpenCode] POST /message 返回了 HTML 页面而不是 API JSON，通常是请求路径错误。正确路径应为 /session/<sessionId>/message（不要写成 /session}/）。当前 URL：${url}`,
    )
  }
}

export async function getDiff(sessionId: string): Promise<any[]> {
  const res = await fetch(`${BASE}/session/${sessionId}/diff`)
  if (!res.ok) throw new Error(`Failed to fetch diff: ${res.status}`)
  return res.json()
}

/**
 * 回复 OpenCode `question` 工具（SDK v2：`POST /question/{requestID}/reply`，body: `{ answers }`）。
 * `answers` 与 `questions` 数组顺序一致；每题为所选 option 的 `label` 组成的数组。
 */
export async function replyToQuestion(
  requestId: string,
  answers: string[][],
  directory?: string,
): Promise<void> {
  const url = `${BASE}/question/${encodeURIComponent(requestId)}/reply`
  console.log(`${LOG.http} POST 回答问题`, url, { answersCount: answers.length }, directory ? { directory } : '')
  const res = await fetch(url, {
    method: 'POST',
    headers: withDirectoryHeaders({ 'Content-Type': 'application/json' }, directory),
    body: JSON.stringify({ answers }),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`replyToQuestion failed: ${res.status} ${bodyText}`)
  }
  console.log(`${LOG.http} POST /question/.../reply`, clip(bodyText, 200))
}

/** OpenCode SDK v2：`GET /question`，列出待处理的 question 请求（用于根据 messageID/callID 解析 requestID） */
export async function getPendingQuestions(directory?: string): Promise<
  Array<{
    id: string
    sessionID: string
    questions: unknown[]
    tool?: { messageID: string; callID: string }
  }>
> {
  const params = new URLSearchParams()
  if (directory) params.set('directory', directory)
  const qs = params.toString()
  const url = qs ? `${BASE}/question?${qs}` : `${BASE}/question`
  console.log(`${LOG.http} GET 待处理 question 列表`, url, directory ? { directory } : '')
  const res = await fetch(url, { headers: withDirectoryHeaders({}, directory) })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`getPendingQuestions failed: ${res.status} ${t}`)
  }
  const data = await res.json()
  const list = Array.isArray(data) ? data : []
  console.log(`${LOG.http} GET /question`, list.length, '条')
  return list
}

/** `POST /question/{requestID}/reject` */
export async function rejectQuestion(requestId: string, directory?: string): Promise<void> {
  const url = `${BASE}/question/${encodeURIComponent(requestId)}/reject`
  console.log(`${LOG.http} POST 拒绝回答问题`, url, directory ? { directory } : '')
  const res = await fetch(url, {
    method: 'POST',
    headers: withDirectoryHeaders({}, directory),
  })
  const bodyText = await res.text()
  if (!res.ok) {
    throw new Error(`rejectQuestion failed: ${res.status} ${bodyText}`)
  }
}

// ===== SSE (real-time events) =====

// 说明：
// - GET /global/event、GET /event 均为 text/event-stream。
// - OpenCode 常对每条 SSE 使用 **自定义 event: 名称**（如 message.part.updated）。
// - 浏览器原生 EventSource.onmessage **只会**收到未命名或 `event: message` 的包，
//   因此若服务端只发命名事件，你会「完全看不到」——这不是没监听，是 API 限制。
// - 下面用 fetch + 手动按行解析，可收到所有 event 名并打日志。

const SSE_RECONNECT_MS = 2500

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function sseReconnectWarn(label: string, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e)
  console.warn(
    `${label} 流结束或出错，将重连`,
    msg,
    '（TypeError: network error 多为：OpenCode 未启动、VITE 代理/baseURL 不对、HTTPS 混用、或连接被服务端/网络断开）'
  )
}

/** 解析 SSE：空行触发一次 dispatch（event 名 + data 拼接） */
function createSseLineDispatcher(
  onDispatch: (eventName: string, data: string) => void
): (line: string) => void {
  let eventName = 'message'
  const dataLines: string[] = []

  return (line: string) => {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed === '') {
      if (dataLines.length > 0) {
        const data = dataLines.join('\n')
        dataLines.length = 0
        const ev = eventName
        eventName = 'message'
        onDispatch(ev, data)
      } else {
        eventName = 'message'
      }
      return
    }
    if (trimmed.startsWith(':')) return
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim()
      return
    }
    if (trimmed.startsWith('data:')) {
      const rest = trimmed.slice(5)
      dataLines.push(rest.startsWith(' ') ? rest.slice(1) : rest)
    }
  }
}

async function streamGlobalSse(
  url: string,
  signal: AbortSignal,
  onEvent: (event: unknown) => void
): Promise<void> {
  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`SSE HTTP ${res.status}`)
  }
  const body = res.body
  if (!body) throw new Error('SSE body null')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  const dispatchLine = createSseLineDispatcher((eventName, dataStr) => {
    console.log(
      '[OpenCode · SSE · event 类型名]',
      eventName,
      `${LOG.sseRaw}`,
      clip(dataStr, 2500)
    )
    try {
      const parsed = JSON.parse(dataStr) as Record<string, unknown>
      const t =
        (parsed?.payload as { type?: string } | undefined)?.type ??
        (parsed as { type?: string }).type
      console.log(`${LOG.sseParsed}`, { wireEvent: eventName, busType: t, 对象: parsed })
      onEvent(parsed)
    } catch {
      console.warn('[OpenCode · SSE] data 非 JSON', dataStr.slice(0, 500))
    }
  })

  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n')
    buf = parts.pop() ?? ''
    for (const line of parts) {
      dispatchLine(line)
    }
  }
}

/**
 * 订阅 GET /global/event（全局 SSE）。
 * 使用 fetch 流式解析，可收到带 `event:` 字段的包；App 里仍用 payload.type 做过滤。
 */
export function subscribeGlobalEvents(
  onEvent: (event: any) => void
): () => void {
  const url = `${BASE}/global/event`
  const ac = new AbortController()

  console.log(
    `${LOG.http} 即将建立 SSE（fetch 流解析，含自定义 event:）`,
    url,
    '完整对话 JSON 仍以 GET /message 为准'
  )

  ;(async function loop() {
    while (!ac.signal.aborted) {
      try {
        await streamGlobalSse(url, ac.signal, onEvent)
      } catch (e) {
        if (ac.signal.aborted) break
        sseReconnectWarn('[OpenCode · SSE]', e)
      }
      if (ac.signal.aborted) break
      await sleep(SSE_RECONNECT_MS)
    }
  })()

  return () => ac.abort()
}

/**
 * 可选：当前 workspace 的 GET /event（与 /global/event 二选一或并行调试用）。
 * 同样用手动解析，避免 EventSource 丢事件。
 */
export function subscribeWorkspaceEvents(onEvent: (event: any) => void): () => void {
  const url = `${BASE}/event`
  const ac = new AbortController()
  console.log(`${LOG.http} 即将建立 SSE（workspace）`, url)

  ;(async function loop() {
    while (!ac.signal.aborted) {
      try {
        await streamGlobalSse(url, ac.signal, onEvent)
      } catch (e) {
        if (ac.signal.aborted) break
        sseReconnectWarn('[OpenCode · SSE /event]', e)
      }
      if (ac.signal.aborted) break
      await sleep(SSE_RECONNECT_MS)
    }
  })()

  return () => ac.abort()
}
