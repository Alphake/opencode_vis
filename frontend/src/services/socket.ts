import { useCockpitStore } from "../store/cockpitStore"

// Connect directly to Flask — avoids Vite proxy buffering SSE
const BACKEND = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:5000"

let es: EventSource | null = null

export function connectSocket() {
  if (es && es.readyState !== EventSource.CLOSED) return

  es = new EventSource(`${BACKEND}/api/events/stream`)
  const store = useCockpitStore.getState()

  es.onopen = () => {
    store.setConnected(true)
    console.log("[AgentCockpit] SSE connected")
  }

  es.onmessage = (e: MessageEvent) => {
    console.log("[Harness Backend · SSE · 原始 data 字符串]", e.data?.slice?.(0, 1500) ?? e.data)
    try {
      const msg = JSON.parse(e.data)
      console.log("[Harness Backend · SSE · 解析后 JSON]", msg)
      if (msg.type === "__snapshot__") {
        store.loadSnapshot(msg.data)
      } else {
        store.handleAgentEvent(msg.type, msg.data)
      }
    } catch {
      console.warn("[Harness Backend · SSE] 解析失败", e.data)
    }
  }

  es.onerror = () => {
    store.setConnected(false)
    console.warn("[AgentCockpit] SSE error, will retry automatically")
    es?.close()
    es = null
    // Reconnect after 3s
    setTimeout(connectSocket, 3000)
  }
}

export function disconnectSocket() {
  es?.close()
  es = null
}
