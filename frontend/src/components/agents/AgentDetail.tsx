import { useEffect, useState } from "react"
import Markdown from "react-markdown"
import { useCockpitStore } from "../../store/cockpitStore"
import { ContextViz } from "./ContextViz"
import { api } from "../../services/api"
import type { Message } from "../../types"

const STATUS_BADGE: Record<string, string> = {
  idle: "bg-green-50 text-green-700 border-green-200",
  busy: "bg-yellow-50 text-yellow-700 border-yellow-200",
  error: "bg-red-50 text-red-700 border-red-200",
}

const AGENT_COLOR: Record<string, string> = {
  build: "text-blue-600",
  general: "text-purple-600",
  explore: "text-gray-500",
  plan: "text-cyan-600",
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-widest">{title}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  )
}

interface Props {
  sessionId: string
}

export function AgentDetail({ sessionId }: Props) {
  const session = useCockpitStore((s) => s.sessions[sessionId])
  const [messages, setMessages] = useState<Message[]>([])

  useEffect(() => {
    if (!sessionId) return
    api.sessions.messages(sessionId).then(setMessages).catch(() => {})
  }, [sessionId])

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Select an agent from the graph.
      </div>
    )
  }

  const runtime = session.createdAt
    ? Math.round((Date.now() - session.createdAt) / 1000)
    : null

  return (
    <div className="flex flex-col gap-3 overflow-y-auto h-full pr-1">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <span className={`text-base font-semibold ${AGENT_COLOR[session.agent] ?? "text-gray-700"}`}>
            {session.agent}
          </span>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{session.id}</p>
        </div>
        <span className={`text-xs border rounded-full px-2 py-0.5 font-medium ${STATUS_BADGE[session.status] ?? ""}`}>
          {session.status}
        </span>
      </div>

      {/* Basic Info */}
      <Section title="Basic Info">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {[
            ["Model", session.modelId ?? "—"],
            ["Provider", session.providerId ?? "—"],
            ["Parent", session.parentId ? session.parentId.slice(0, 12) + "…" : "root"],
            ["Children", session.children.length.toString()],
            ["Runtime", runtime != null ? `${runtime}s` : "—"],
            ["Cost", `$${session.cost.toFixed(5)}`],
          ].map(([k, v]) => (
            <>
              <dt className="text-gray-400">{k}</dt>
              <dd className="text-gray-700 font-mono">{v}</dd>
            </>
          ))}
        </dl>
        {/* Token bar */}
        <div className="mt-3 space-y-1">
          <div className="flex justify-between text-[10px] text-gray-400 font-mono">
            <span>Input: {session.tokens.input.toLocaleString()}</span>
            <span>Output: {session.tokens.output.toLocaleString()}</span>
            <span>Cache: {session.tokens.cacheRead.toLocaleString()}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full flex overflow-hidden gap-0.5">
            {[
              { pct: session.tokens.input, color: "bg-blue-300" },
              { pct: session.tokens.output, color: "bg-purple-300" },
              { pct: session.tokens.cacheRead, color: "bg-green-300" },
            ].map(({ pct, color }, i) => {
              const total = session.tokens.input + session.tokens.output + session.tokens.cacheRead
              const w = total > 0 ? Math.round((pct / total) * 100) : 0
              return <div key={i} className={`${color} h-full rounded-sm`} style={{ width: `${w}%` }} />
            })}
          </div>
        </div>
      </Section>

      {/* System Prompt */}
      <Section title="System Prompt">
        {session.systemPrompt ? (
          <div className="text-xs text-gray-600 max-h-52 overflow-y-auto leading-relaxed">
            <Markdown>{session.systemPrompt}</Markdown>
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            Not yet captured — system prompt arrives on the first chat.message hook call
            with role="system".
          </p>
        )}
      </Section>

      {/* Context Window */}
      <Section title="Context Window">
        <ContextViz messages={messages} />
      </Section>
    </div>
  )
}
