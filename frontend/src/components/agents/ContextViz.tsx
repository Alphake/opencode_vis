import { useMemo, useState } from "react"
import type { Message, MessagePart } from "../../types"

// ── Color palette ─────────────────────────────────────────────────────────────

const PART_BAR: Record<string, string> = {
  text:       "bg-blue-300",
  tool:       "bg-orange-300",
  reasoning:  "bg-purple-200",
  compaction: "bg-red-200",
}

const TOOL_DOT: Record<string, string> = {
  completed: "bg-green-500",
  running:   "bg-yellow-400 animate-pulse",
  error:     "bg-red-500",
  pending:   "bg-gray-300",
}

// ── Expanded part detail ──────────────────────────────────────────────────────

function ExpandedPart({ part }: { part: MessagePart }) {
  const [textOpen, setTextOpen] = useState(false)

  if (part.type === "step-start" || part.type === "step-finish") return null

  if (part.type === "compaction") {
    return (
      <div className="flex items-center gap-2 my-0.5">
        <div className="flex-1 h-px border-t border-dashed border-red-300" />
        <span className="text-[10px] text-red-400 font-mono">context compacted</span>
        <div className="flex-1 h-px border-t border-dashed border-red-300" />
      </div>
    )
  }

  if (part.type === "tool") {
    return <ToolPartDetail part={part} />
  }

  if (part.type === "reasoning") {
    return (
      <details className="text-[10px] text-gray-400 border border-gray-200 rounded px-2 py-1 bg-gray-50">
        <summary className="cursor-pointer select-none font-mono">
          reasoning ({(part.content ?? "").length} chars)
        </summary>
        <p className="mt-1 text-gray-500 whitespace-pre-wrap break-words">{part.content}</p>
      </details>
    )
  }

  // text
  const content = part.content ?? ""
  const PREVIEW = 300
  const long = content.length > PREVIEW
  return (
    <div className="border border-blue-200 bg-blue-50 rounded px-2 py-1 text-[11px] text-gray-700 leading-relaxed">
      <p className="whitespace-pre-wrap break-words">
        {textOpen || !long ? content : content.slice(0, PREVIEW) + "…"}
      </p>
      {long && (
        <button
          onClick={() => setTextOpen((o) => !o)}
          className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
        >
          {textOpen ? "Show less" : `Show more (${content.length} chars)`}
        </button>
      )}
    </div>
  )
}

function ToolPartDetail({ part }: { part: MessagePart }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-orange-200 bg-orange-50 rounded px-2 py-1 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${TOOL_DOT[part.toolStatus ?? "pending"]}`} />
        <span className="font-mono font-semibold text-orange-700">{part.toolName ?? "tool"}</span>
        <span className="text-gray-400 text-[10px]">{part.toolStatus ?? "pending"}</span>
        {(part.toolInput || part.toolOutput) && (
          <span className="ml-auto text-gray-300 text-[10px]">{open ? "▲" : "▼"}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {part.toolInput != null && (
            <pre className="text-[10px] text-gray-500 bg-white border border-gray-200 rounded p-1.5 overflow-x-auto max-h-28 whitespace-pre-wrap break-words">
              {JSON.stringify(part.toolInput, null, 2)}
            </pre>
          )}
          {part.toolOutput && (
            <pre className="text-[10px] text-gray-600 bg-white border border-gray-200 rounded p-1.5 overflow-x-auto max-h-28 whitespace-pre-wrap break-words">
              {part.toolOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ── Mini bar strip (collapsed view) ──────────────────────────────────────────

function PartStrip({ parts }: { parts: MessagePart[] }) {
  return (
    <div className="flex gap-0.5 flex-wrap items-center">
      {parts.map((p, i) => {
        if (p.type === "step-start" || p.type === "step-finish") return null
        const color = PART_BAR[p.type] ?? PART_BAR.text
        if (p.type === "tool") {
          return (
            <span
              key={i}
              className={`w-3 h-3 rounded-sm ${color} opacity-80`}
              title={`${p.toolName} (${p.toolStatus})`}
            />
          )
        }
        const w = Math.min(Math.max(Math.ceil((p.content?.length ?? 0) / 40), 2), 20)
        return (
          <span
            key={i}
            className={`h-3 rounded-sm ${color} opacity-70`}
            style={{ width: `${w * 4}px` }}
            title={`${p.type}: ${(p.content ?? "").slice(0, 60)}…`}
          />
        )
      })}
    </div>
  )
}

// ── Message row ───────────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false)
  const isUser = msg.role === "user"
  const tokenCount = msg.tokens.input + msg.tokens.output
  const visibleParts = msg.parts.filter(
    (p) => p.type !== "step-start" && p.type !== "step-finish"
  )

  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={() => visibleParts.length > 0 && setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
          visibleParts.length > 0 ? "hover:bg-gray-50 cursor-pointer" : "cursor-default"
        }`}
      >
        <span
          className={`text-[10px] font-mono px-1.5 py-px rounded shrink-0 ${
            isUser ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
          }`}
        >
          {isUser ? "USER" : (msg.agent?.toUpperCase().slice(0, 5) ?? "ASST")}
        </span>

        <div className="flex-1 min-w-0">
          {visibleParts.length > 0 ? (
            <PartStrip parts={visibleParts} />
          ) : (
            <span className="text-[10px] text-gray-300 font-mono">—</span>
          )}
        </div>

        <span className="text-[10px] text-gray-300 font-mono shrink-0">
          {tokenCount > 0 ? `${(tokenCount / 1000).toFixed(1)}k` : ""}
        </span>

        {visibleParts.length > 0 && (
          <span className="text-gray-300 text-[9px] shrink-0">{open ? "▲" : "▼"}</span>
        )}
      </button>

      {open && visibleParts.length > 0 && (
        <div className="px-3 pb-2 flex flex-col gap-1.5">
          {msg.parts.map((p, i) => (
            <ExpandedPart key={i} part={p} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  messages: Message[]
  tokenLimit?: number
}

export function ContextViz({ messages, tokenLimit = 128000 }: Props) {
  const totalTokens = useMemo(
    () => messages.reduce((s, m) => s + m.tokens.input + m.tokens.output, 0),
    [messages]
  )
  const pct = Math.min(Math.round((totalTokens / tokenLimit) * 100), 100)

  if (messages.length === 0) {
    return <p className="text-xs text-gray-400 py-4 text-center">No messages yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Context usage bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all ${
              pct > 85 ? "bg-red-400" : pct > 60 ? "bg-yellow-400" : "bg-green-400"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-gray-400 shrink-0">
          {pct}% · {(totalTokens / 1000).toFixed(1)}k / {(tokenLimit / 1000).toFixed(0)}k
        </span>
      </div>

      {/* Scrollable message list */}
      <div
        className="flex flex-col overflow-y-auto rounded border border-gray-100"
        style={{ maxHeight: "400px" }}
      >
        {messages.map((m) => (
          <MessageRow key={m.id} msg={m} />
        ))}
      </div>

      <p className="text-[10px] text-gray-300 text-right font-mono">
        {messages.length} msgs · click to expand
      </p>
    </div>
  )
}
