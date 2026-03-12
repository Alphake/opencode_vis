import { useEffect, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import type { Message } from "../../types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTextContent(msg: Message | undefined, maxLen = 1200): string {
  if (!msg) return ""
  return msg.parts
    .filter((p) => p.type === "text")
    .map((p) => p.content ?? "")
    .join("\n")
    .trim()
    .slice(0, maxLen)
}

function mergeMessages(fetched: Message[], live: Message[]): Message[] {
  const map = new Map<string, Message>()
  for (const m of fetched) map.set(m.id, m)
  for (const m of live) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.timestamp - b.timestamp)
}

// ── Collapsible text ─────────────────────────────────────────────────────────

function CollapsibleText({
  text,
  previewLines = 2,
  className = "",
}: {
  text: string
  previewLines?: number
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const lines = text.split("\n")
  const needsExpand = lines.length > previewLines || text.length > 160

  const preview = needsExpand && !expanded
    ? lines.slice(0, previewLines).join("\n").slice(0, 160)
    : text

  return (
    <div>
      <p className={`text-xs text-gray-700 whitespace-pre-wrap leading-relaxed ${className}`}>
        {preview}{needsExpand && !expanded ? "…" : ""}
      </p>
      {needsExpand && (
        <button
          onClick={() => setExpanded((o) => !o)}
          className="text-[10px] text-blue-500 hover:text-blue-600 mt-1 transition-colors"
        >
          {expanded ? "Show less ▲" : "Show more ▼"}
        </button>
      )}
    </div>
  )
}

// ── Direction badge ───────────────────────────────────────────────────────────

function DirBadge({ dir }: { dir: "in" | "out" }) {
  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-px rounded ${
      dir === "in"
        ? "bg-blue-100 text-blue-600"
        : "bg-purple-100 text-purple-600"
    }`}>
      {dir === "in" ? "← recv" : "→ sent"}
    </span>
  )
}

// ── Inline text block (task or result inside a child card) ────────────────────

function TextRow({
  dir,
  label,
  text,
  empty = "Not captured yet.",
}: {
  dir: "in" | "out"
  label: string
  text: string
  empty?: string
}) {
  return (
    <div className={`rounded px-2.5 py-2 border-l-2 ${
      dir === "in" ? "border-blue-300 bg-blue-50/50" : "border-purple-300 bg-purple-50/50"
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <DirBadge dir={dir} />
        <span className="text-[10px] text-gray-500 font-medium">{label}</span>
      </div>
      {text ? (
        <CollapsibleText text={text} />
      ) : (
        <p className="text-xs text-gray-400 italic">{empty}</p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  sessionId: string
}

export function AgentHandoffs({ sessionId }: Props) {
  const session = useCockpitStore((s) => s.sessions[sessionId])
  const sessions = useCockpitStore((s) => s.sessions)
  const allMessages = useCockpitStore((s) => s.messages)

  const [ownFetched, setOwnFetched] = useState<Message[]>([])
  const [childFetched, setChildFetched] = useState<Record<string, Message[]>>({})

  useEffect(() => {
    if (!sessionId) return
    api.sessions.messages(sessionId).then(setOwnFetched).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    if (!session?.children?.length) return
    for (const childId of session.children) {
      api.sessions.messages(childId).then((msgs) => {
        setChildFetched((prev) => ({ ...prev, [childId]: msgs }))
      }).catch(() => {})
    }
  }, [session?.children])

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Select an agent from the graph.
      </div>
    )
  }

  const isSubagent = !!session.parentId
  const hasChildren = session.children.length > 0

  if (!isSubagent && !hasChildren) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400 px-8 text-center">
        No inter-agent communications.
      </div>
    )
  }

  const ownMsgs = mergeMessages(ownFetched, allMessages[sessionId] ?? [])
  const parentSession = session.parentId ? sessions[session.parentId] : null

  const taskReceived = ownMsgs.find((m) => m.role === "user")
  const resultReported = [...ownMsgs].reverse().find(
    (m) => m.role === "assistant" && m.parts.some((p) => p.type === "text" && (p.content?.length ?? 0) > 20)
  )

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">

      {/* ── Task received from parent ── */}
      {isSubagent && (
        <section>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">Task from parent</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">{parentSession?.agent ?? "parent"}</span>
              <span className="text-gray-300 text-xs">→</span>
              <span className="text-xs text-gray-600">{session.agent}</span>
            </div>
            <div className="p-3">
              <TextRow dir="in" label="task assigned" text={getTextContent(taskReceived)} />
            </div>
          </div>
        </section>
      )}

      {/* ── Children ── */}
      {hasChildren && (
        <section>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">
            Delegated subagents ({session.children.length})
          </p>
          <div className="flex flex-col gap-2">
            {session.children.map((childId) => {
              const child = sessions[childId]
              const msgs = mergeMessages(childFetched[childId] ?? [], allMessages[childId] ?? [])
              const childTask = msgs.find((m) => m.role === "user")
              const childResult = [...msgs].reverse().find(
                (m) => m.role === "assistant" && m.parts.some((p) => p.type === "text" && (p.content?.length ?? 0) > 20)
              )
              const childTitle = child?.title
                ?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "")
                .trim()
              const showTitle = childTitle && childTitle !== "New session" && !childTitle.startsWith("New session -")

              return (
                <div key={childId} className="border border-border rounded-lg overflow-hidden">
                  {/* Child header */}
                  <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
                    <span className="text-xs font-semibold text-gray-700">{child?.agent ?? "subagent"}</span>
                    {showTitle && (
                      <span className="text-[10px] text-gray-500 truncate flex-1">{childTitle}</span>
                    )}
                    <span className="font-mono text-[10px] text-gray-300 shrink-0">{childId.slice(0, 10)}</span>
                    <span className={`text-[10px] border rounded-full px-2 py-px shrink-0 font-medium ${
                      child?.status === "idle"  ? "text-green-600 border-green-200 bg-green-50"  :
                      child?.status === "busy"  ? "text-yellow-600 border-yellow-200 bg-yellow-50" :
                      child?.status === "error" ? "text-red-600 border-red-200 bg-red-50" :
                      "text-gray-500 border-gray-200"
                    }`}>
                      {child?.status ?? "—"}
                    </span>
                  </div>

                  {/* Task + result */}
                  <div className="p-3 flex flex-col gap-2">
                    <TextRow
                      dir="out"
                      label="task assigned"
                      text={getTextContent(childTask)}
                      empty="Task not captured yet."
                    />
                    {childResult ? (
                      <TextRow
                        dir="in"
                        label="result reported back"
                        text={getTextContent(childResult)}
                      />
                    ) : (
                      child?.status === "busy" && (
                        <div className="flex items-center gap-1.5 text-[10px] text-yellow-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                          Working…
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Result reported to parent ── */}
      {isSubagent && resultReported && (
        <section>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">Result reported to parent</p>
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-surface border-b border-border flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-700">{session.agent}</span>
              <span className="text-gray-300 text-xs">→</span>
              <span className="text-xs text-gray-600">{parentSession?.agent ?? "parent"}</span>
            </div>
            <div className="p-3">
              <TextRow dir="out" label="result sent" text={getTextContent(resultReported)} />
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
