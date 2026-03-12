import type { Plugin } from "./types.js"

const BACKEND_URL = process.env.COCKPIT_BACKEND_URL ?? "http://localhost:5000"
const RELEVANT_TYPES = new Set([
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "session.compacted",
  "message.updated",
  "message.part.updated",
  "message.removed",
  "todo.updated",
  "permission.updated",
  "permission.replied",
])

let buffer: { type: string; properties: unknown; timestamp: number }[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const batch = buffer.splice(0)
    if (batch.length === 0) return
    fetch(`${BACKEND_URL}/api/events/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    }).catch((err: Error) => {
      console.error("[AgentCockpit] Failed to forward events:", err.message)
    })
  }, 50)
}

function enqueue(type: string, properties: unknown) {
  buffer.push({ type, properties, timestamp: Date.now() })
  scheduleFlush()
}

export const AgentCockpitPlugin: Plugin = async (_ctx) => {
  console.log(`[AgentCockpit] Plugin initialized → ${BACKEND_URL}`)

  return {
    event: async ({ event }) => {
      if (RELEVANT_TYPES.has(event.type)) {
        enqueue(event.type, (event as any).properties ?? {})
      }
    },

    "tool.execute.before": async (input, output) => {
      enqueue("tool.execute.before", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args: (output as any).args ?? {},
      })
    },

    "tool.execute.after": async (input, output) => {
      enqueue("tool.execute.after", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        args: (input as any).args ?? {},
        title: (output as any).title ?? "",
        outputSnippet: String((output as any).output ?? "").slice(0, 500),
        metadata: (output as any).metadata ?? null,
      })
    },

    "chat.message": async (input, output) => {
      const msg = (output as any).message ?? {}
      const parts: unknown[] = (output as any).parts ?? []

      // System prompt can be in message.system (Anthropic format),
      // or as a text part when message.role === "system"
      let systemPrompt: string | null = msg.system ?? null
      if (!systemPrompt && msg.role === "system") {
        const textPart = parts.find((p: any) => p.type === "text")
        systemPrompt = (textPart as any)?.text ?? null
      }

      enqueue("chat.message", {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: (input as any).variant ?? null,
        systemPrompt,
        role: msg.role ?? "user",
      })
    },
  }
}

export default AgentCockpitPlugin
