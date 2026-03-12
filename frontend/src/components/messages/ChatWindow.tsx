import { useEffect, useMemo, useRef, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import type { Message, MessagePart } from "../../types"

// ── Colors ────────────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  build: "bg-blue-100 text-blue-700 border-blue-200",
  general: "bg-purple-100 text-purple-700 border-purple-200",
  explore: "bg-gray-100 text-gray-600 border-gray-200",
  plan: "bg-cyan-100 text-cyan-700 border-cyan-200",
}

const TOOL_STATUS_STYLE: Record<string, string> = {
  completed: "border-l-green-400 bg-green-50",
  running: "border-l-yellow-400 bg-yellow-50",
  error: "border-l-red-400 bg-red-50",
  pending: "border-l-gray-300 bg-gray-50",
}

// ── Tool call inline card ─────────────────────────────────────────────────────

function ToolCard({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false)
  const style = TOOL_STATUS_STYLE[part.toolStatus ?? "pending"]

  return (
    <div className={`border-l-2 rounded-r px-2 py-1 my-1 text-xs ${style}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className="font-mono font-semibold text-gray-600">{part.toolName ?? "tool"}</span>
        <span className="text-gray-400">{part.toolStatus ?? "pending"}</span>
        {part.toolStatus === "completed" && (
          <span className="ml-auto text-gray-300">{open ? "▲" : "▼"}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {part.toolInput != null && (
            <pre className="text-[10px] text-gray-500 bg-white border border-gray-200 rounded p-1.5 overflow-x-auto max-h-24">
              {JSON.stringify(part.toolInput, null, 2)}
            </pre>
          )}
          {part.toolOutput && (
            <pre className="text-[10px] text-gray-600 bg-white border border-gray-200 rounded p-1.5 overflow-x-auto max-h-24">
              {part.toolOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Single message bubble ─────────────────────────────────────────────────────

function MessageBubble({
  msg,
  agentColor,
  userLabel,
}: {
  msg: Message
  agentColor: string
  userLabel: string
}) {
  const isUser = msg.role === "user"
  const timeStr = msg.timestamp ? new Date(msg.timestamp).toTimeString().slice(0, 8) : ""

  return (
    <div className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}>
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        {!isUser && (
          <span className={`text-[10px] font-mono border rounded px-1.5 py-px ${agentColor}`}>
            {msg.agent ?? "assistant"}
          </span>
        )}
        <span className="text-[10px] text-gray-300 font-mono">{timeStr}</span>
        {isUser && (
          <span className="text-[10px] font-mono border rounded px-1.5 py-px border-orange-200 bg-orange-50 text-orange-600">
            {userLabel}
          </span>
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-white border border-border text-gray-800 rounded-tl-sm"
        }`}
      >
        {msg.parts.map((p, i) => {
          if (p.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap break-words leading-relaxed text-xs">
                {p.content}
              </p>
            )
          }
          if (p.type === "tool") return <ToolCard key={i} part={p} />
          if (p.type === "reasoning") {
            return (
              <details key={i} className="text-xs mt-1">
                <summary className="text-gray-400 cursor-pointer select-none">reasoning…</summary>
                <p className="text-gray-500 whitespace-pre-wrap mt-1">{p.content}</p>
              </details>
            )
          }
          if (p.type === "compaction") {
            return (
              <div key={i} className="flex items-center gap-1 my-1">
                <div className="flex-1 h-px bg-red-200" />
                <span className="text-[10px] text-red-400 font-mono">context compacted</span>
                <div className="flex-1 h-px bg-red-200" />
              </div>
            )
          }
          return null
        })}
        {msg.parts.length === 0 && <span className="text-xs text-gray-400 italic">…</span>}
      </div>

      {/* Token info */}
      {(msg.tokens.input + msg.tokens.output) > 0 && (
        <span className="text-[10px] text-gray-300 font-mono px-1">
          {(msg.tokens.input + msg.tokens.output).toLocaleString()} tokens
          {msg.cost > 0 ? ` · $${msg.cost.toFixed(5)}` : ""}
        </span>
      )}
    </div>
  )
}

// ── Chat window ───────────────────────────────────────────────────────────────

interface Props {
  sessionId: string | null   // null = all sessions merged
}

export function ChatWindow({ sessionId }: Props) {
  const allMessages = useCockpitStore((s) => s.messages)
  const sessions = useCockpitStore((s) => s.sessions)
  const [fetchedMessages, setFetchedMessages] = useState<Message[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionId) return
    api.sessions.messages(sessionId).then(setFetchedMessages).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [fetchedMessages, allMessages])

  const messages = useMemo(() => {
    type Tagged = Message & { _sessionId: string }
    if (sessionId) {
      const live = allMessages[sessionId] ?? []
      const byId = new Map<string, Message>()
      for (const m of fetchedMessages) byId.set(m.id, m)
      for (const m of live) byId.set(m.id, m)
      return [...byId.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((m) => ({ ...m, _sessionId: sessionId }) as Tagged)
    }
    return Object.entries(allMessages)
      .flatMap(([sid, msgs]) => msgs.map((m) => ({ ...m, _sessionId: sid }) as Tagged))
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [sessionId, allMessages, fetchedMessages])

  if (messages.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        No messages yet for this session.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full px-2 py-3">
      {messages.map((msg) => {
        const msgSession = sessions[msg._sessionId]
        const agentColor = AGENT_COLORS[msgSession?.agent ?? ""] ?? AGENT_COLORS.explore

        // "user" role in a subagent = parent agent sending a task
        let userLabel = "user"
        if (msg.role === "user" && msgSession?.parentId) {
          const parent = sessions[msgSession.parentId]
          userLabel = parent ? `${parent.agent} →` : "parent →"
        }

        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            agentColor={agentColor}
            userLabel={userLabel}
          />
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
