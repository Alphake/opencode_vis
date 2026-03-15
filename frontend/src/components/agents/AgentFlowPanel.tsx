import { useEffect, useMemo, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import type { Message, TodoItem, Session } from "../../types"

const EMPTY_TODOS: TodoItem[] = []

const AGENT_COLORS: Record<string, string> = {
  build: "#0D9488", plan: "#B45309", general: "#1D4ED8", explore: "#6D28D9", unknown: "#64748B",
}
const STATUS_BADGE: Record<string, string> = {
  idle: "bg-slate-50 text-slate-600 border-slate-200",
  busy: "bg-amber-50 text-amber-600 border-amber-200",
  retrying: "bg-amber-50 text-amber-600 border-amber-200",
  pending: "bg-indigo-50 text-indigo-600 border-indigo-200",
  error: "bg-red-50 text-red-600 border-red-200",
}
const ENTRY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  user:       { bg: "bg-blue-50",   text: "text-blue-600",   label: "USER" },
  reasoning:  { bg: "bg-violet-50", text: "text-violet-600", label: "THINK" },
  text:       { bg: "bg-slate-100", text: "text-slate-500",  label: "ASST" },
  tool:       { bg: "bg-amber-50",  text: "text-amber-600",  label: "TOOL" },
  toolOk:     { bg: "bg-emerald-50", text: "text-emerald-600", label: "TOOL" },
  toolErr:    { bg: "bg-red-50",    text: "text-red-500",    label: "ERR" },
  compaction: { bg: "bg-red-50",    text: "text-red-400",    label: "COMP" },
}
function fmtTime(ts?: number): string {
  return ts ? new Date(ts).toTimeString().slice(0, 8) : ""
}

// ── Timeline ─────────────────────────────────────────────────

interface TlEntry {
  key: string
  type: "user" | "text" | "reasoning" | "tool" | "compaction"
  content: string
  toolName?: string
  toolStatus?: string
  toolInput?: unknown
  toolOutput?: string
  timestamp?: number
}

function buildTimeline(msgs: Message[]): TlEntry[] {
  const out: TlEntry[] = []
  let i = 0
  for (const msg of msgs) {
    if (msg.role === "user") {
      const txt = msg.parts.filter(p => p.type === "text").map(p => p.content ?? "").join("\n").trim()
      if (txt) out.push({ key: `${msg.id}-u${i++}`, type: "user", content: txt, timestamp: msg.timestamp })
    } else {
      for (const p of msg.parts) {
        if (p.type === "step-start" || p.type === "step-finish") continue
        if (p.type === "compaction") {
          out.push({ key: `${msg.id}-c${i++}`, type: "compaction", content: "", timestamp: msg.timestamp })
          continue
        }
        const content = (p.content ?? "").trim()
        if ((p.type === "text" || p.type === "reasoning") && !content) continue
        const t: TlEntry["type"] = p.type === "reasoning" ? "reasoning" : p.type === "tool" ? "tool" : "text"
        out.push({
          key: `${msg.id}-${t}${i++}`, type: t, content,
          toolName: p.toolName, toolStatus: p.toolStatus, toolInput: p.toolInput, toolOutput: p.toolOutput,
          timestamp: msg.timestamp,
        })
      }
    }
  }
  return out
}

// ── Section header ───────────────────────────────────────────

function SecHead({ title, badge, extra, open, toggle }: {
  title: string; badge?: string | number; extra?: React.ReactNode; open: boolean; toggle: () => void
}) {
  return (
    <button onClick={toggle} className="w-full flex items-center gap-2 py-2.5 text-left select-none">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
      {badge !== undefined && (
        <span className="text-[10px] bg-gray-100 text-gray-500 font-mono px-1.5 py-0.5 rounded-md">{badge}</span>
      )}
      {extra && <span className="text-[10px] text-gray-400 font-mono">{extra}</span>}
      <span className="ml-auto text-gray-300 text-[10px] transition-transform"
        style={{ transform: open ? "rotate(0)" : "rotate(-90deg)" }}>▾</span>
    </button>
  )
}

// ── Main ─────────────────────────────────────────────────────

export function AgentFlowPanel({ sessionId }: { sessionId: string }) {
  const session = useCockpitStore(s => s.sessions[sessionId])
  const sessions = useCockpitStore(s => s.sessions)
  const liveMsgs = useCockpitStore(s => s.messages)
  const todosRaw = useCockpitStore(s => s.todos[sessionId])
  const todos: TodoItem[] = todosRaw ?? EMPTY_TODOS

  const [fetched, setFetched] = useState<Message[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [todosOpen, setTodosOpen] = useState(true)
  const [mailboxOpen, setMailboxOpen] = useState(true)
  const [mailboxInExpanded, setMailboxInExpanded] = useState(false)
  const [tlOpen, setTlOpen] = useState(true)

  useEffect(() => {
    if (sessionId) api.sessions.messages(sessionId).then(setFetched).catch(() => {})
  }, [sessionId])

  const messages = useMemo(() => {
    const byId = new Map<string, Message>()
    for (const m of fetched) byId.set(m.id, m)
    for (const m of (liveMsgs[sessionId] ?? [])) byId.set(m.id, m)
    return [...byId.values()].sort((a, b) => a.timestamp - b.timestamp)
  }, [fetched, liveMsgs, sessionId])

  const timeline = useMemo(() => buildTimeline(messages), [messages])

  const toggle = (k: string) => setExpanded(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  if (!session) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Select an agent from the tree.</div>
  }

  const color = AGENT_COLORS[session.agent] ?? AGENT_COLORS.unknown
  const todoDone = todos.filter(t => t.status === "completed").length
  const hasParent = !!session.parentId
  const hasChildren = session.children.length > 0
  const showMailbox = hasParent || hasChildren

  const taskFromParent = hasParent
    ? messages.find(m => m.role === "user")?.parts
        .filter(p => p.type === "text").map(p => p.content ?? "").join(" ").trim()
    : undefined
  const parentSession: Session | undefined = session.parentId ? sessions[session.parentId] : undefined

  const currentActivity = session.status === "busy" && timeline.length > 0 ? timeline[timeline.length - 1] : null

  const rawTitle = session.title?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "").trim()
  const titleText = rawTitle && rawTitle !== "New session" && !rawTitle.startsWith("New session -") ? rawTitle : undefined

  return (
    <div className="space-y-1">
      {/* ═══ Task Title ═══ */}
      <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
        <span className="w-3 h-3 rounded-full ring-2 ring-white shadow" style={{ backgroundColor: color }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800 truncate">{titleText ?? session.agent}</div>
          {titleText && <div className="text-[11px] text-gray-400 font-mono mt-0.5">{session.agent}</div>}
        </div>
        <span className={`text-[10px] border rounded-full px-2.5 py-0.5 font-semibold shrink-0 ${STATUS_BADGE[session.status] ?? ""}`}>
          {session.status === "busy" ? "running" : session.status === "idle" ? "idle" : session.status}
        </span>
      </div>

      {/* ═══ Current Activity (busy) ═══ */}
      {currentActivity && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 flex items-start gap-2.5">
          <span className="relative flex items-center justify-center w-3 h-3 mt-0.5 shrink-0">
            <span className="absolute w-3 h-3 rounded-full bg-amber-400 animate-ping opacity-30" />
            <span className="w-2 h-2 rounded-full bg-amber-400 relative z-10" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-amber-600 font-semibold uppercase tracking-wider mb-0.5">Current Activity</div>
            {currentActivity.type === "tool" ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono font-semibold text-gray-700">{currentActivity.toolName}</span>
                <span className="text-amber-500 font-mono text-[10px]">{currentActivity.toolStatus ?? "running"}</span>
              </div>
            ) : (
              <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                {currentActivity.content}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ═══ Todos ═══ */}
      <div>
        <SecHead title="Todos" badge={todos.length || undefined}
          extra={todos.length > 0 ? `${todoDone}/${todos.length} done` : undefined}
          open={todosOpen} toggle={() => setTodosOpen(o => !o)} />
        {todosOpen && (
          todos.length > 0 ? (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 mb-1">
              {todos.map((it, i) => {
                const icon = it.status === "completed" ? "✓" : it.status === "in_progress" ? "●" : it.status === "cancelled" ? "✗" : "○"
                const ic = it.status === "completed" ? "text-emerald-500" : it.status === "in_progress" ? "text-amber-500" : it.status === "cancelled" ? "text-gray-300" : "text-gray-400"
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <span className={`w-4 text-center text-sm leading-none mt-0.5 ${ic}`}>{icon}</span>
                    <span className={`flex-1 ${it.status === "cancelled" ? "line-through text-gray-300" : "text-gray-700"}`}>{it.content}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg mb-1">
              No tasks defined
            </div>
          )
        )}
      </div>

      {/* ═══ Mailbox ═══ */}
      {showMailbox && (
        <div>
          <SecHead title="Mailbox" badge={hasChildren ? session.children.length : undefined}
            open={mailboxOpen} toggle={() => setMailboxOpen(o => !o)} />
          {mailboxOpen && (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden mb-1">
              {hasParent && (
                <div className="px-3 py-2.5 flex items-start gap-2">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 shrink-0 mt-px">← IN</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] mb-0.5">
                      <span className="font-semibold text-gray-600">{parentSession?.agent ?? "parent"}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-gray-500">{session.agent}</span>
                    </div>
                    <p className={`text-xs text-gray-500 whitespace-pre-wrap break-words ${!mailboxInExpanded && (taskFromParent?.length ?? 0) > 200 ? "line-clamp-3" : ""}`}>
                      {taskFromParent || "Task content not captured"}
                    </p>
                    {(taskFromParent?.length ?? 0) > 200 && (
                      <button
                        type="button"
                        onClick={() => setMailboxInExpanded(e => !e)}
                        className="mt-0.5 text-[10px] text-blue-500 hover:underline"
                      >
                        {mailboxInExpanded ? "收起" : "展开"}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {session.children.map(childId => {
                const child = sessions[childId]
                if (!child) return null
                const ct = child.title?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "").trim()
                const showCt = ct && ct !== "New session" && !ct.startsWith("New session -")
                return (
                  <div key={childId} className="px-3 py-2.5 flex items-start gap-2">
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 shrink-0 mt-px">→ OUT</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="font-semibold text-gray-600">{session.agent}</span>
                        <span className="text-gray-300">→</span>
                        <span className="text-gray-500">{child.agent}</span>
                        <span className={`ml-auto text-[10px] border rounded-full px-1.5 py-px font-medium ${STATUS_BADGE[child.status] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>{child.status === "busy" ? "running" : child.status === "idle" ? "idle" : child.status}</span>
                      </div>
                      {showCt && <p className="text-xs text-gray-500 break-words mt-0.5">{ct}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Timeline ═══ */}
      <div>
        <SecHead title="Timeline" badge={timeline.length} open={tlOpen} toggle={() => setTlOpen(o => !o)} />
        {tlOpen && (
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {timeline.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">No messages yet.</p>
            ) : (
              timeline.map(e => {
                const isExp = expanded.has(e.key)
                const isTool = e.type === "tool"
                const toolOk = e.toolStatus === "completed"
                const toolErr = e.toolStatus === "error"
                const style = isTool
                  ? (toolErr ? ENTRY_STYLE.toolErr : toolOk ? ENTRY_STYLE.toolOk : ENTRY_STYLE.tool)
                  : (ENTRY_STYLE[e.type] ?? ENTRY_STYLE.text)
                const isLongText = (e.type === "user" || e.type === "text" || e.type === "reasoning") && e.content.length > 150
                const canExpand = (e.type === "text" && e.content.length > 120)
                  || (e.type === "reasoning" && e.content.length > 0)
                  || (e.type === "user" && e.content.length > 150)
                  || isTool

                return (
                  <div
                    key={e.key}
                    className={`flex items-start gap-2.5 px-3 py-2 transition-colors ${canExpand ? "cursor-pointer hover:bg-gray-50/70" : ""}`}
                    onClick={() => canExpand && toggle(e.key)}
                  >
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 w-12 text-center ${style.bg} ${style.text}`}>
                      {style.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      {e.type === "compaction" ? (
                        <div className="flex items-center gap-2 py-0.5">
                          <div className="flex-1 h-px border-t border-dashed border-red-200" />
                          <span className="text-[10px] text-red-400 font-mono">context compacted</span>
                          <div className="flex-1 h-px border-t border-dashed border-red-200" />
                        </div>
                      ) : isTool ? (
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold text-gray-700">{e.toolName ?? "tool"}</span>
                            <span className={`text-[10px] font-mono ${toolOk ? "text-emerald-500" : toolErr ? "text-red-500" : "text-amber-500"}`}>
                              {e.toolStatus ?? "pending"}
                            </span>
                          </div>
                          {isExp && (
                            <div className="mt-1.5 space-y-1">
                              {e.toolInput != null && (
                                <pre className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded p-1.5 max-h-36 overflow-auto whitespace-pre-wrap break-words">
                                  {JSON.stringify(e.toolInput, null, 2)}
                                </pre>
                              )}
                              {e.toolOutput && (
                                <pre className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded p-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                                  {e.toolOutput}
                                </pre>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className={`text-xs leading-relaxed ${e.type === "user" ? "text-gray-800" : "text-gray-600"} ${!isExp && isLongText ? "line-clamp-4" : ""}`}>
                            {e.content}
                          </p>
                          {isLongText && (
                            <button
                              type="button"
                              className="mt-0.5 text-[10px] text-blue-500 hover:underline"
                              onClick={(ev) => { ev.stopPropagation(); toggle(e.key) }}
                            >
                              {isExp ? "收起" : "展开查看完整"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-300 font-mono shrink-0 mt-0.5 tabular-nums">
                      {fmtTime(e.timestamp)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* ═══ 与 OpenCode 交流 ═══ */}
      <div className="pt-2 mt-2 border-t border-gray-100">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const v = (e.currentTarget.elements.namedItem("opencode-input") as HTMLInputElement)?.value?.trim()
            if (!v || !sessionId) return
            api.sessions.sendMessage(sessionId, v).then(() => {
              ;(e.currentTarget.elements.namedItem("opencode-input") as HTMLInputElement).value = ""
            }).catch(() => {})
          }}
        >
          <input
            name="opencode-input"
            type="text"
            placeholder="与 OpenCode 交流…"
            className="flex-1 min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-xs placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-blue-500 text-white px-3 py-2 text-xs font-medium hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            发送
          </button>
        </form>
      </div>
    </div>
  )
}
