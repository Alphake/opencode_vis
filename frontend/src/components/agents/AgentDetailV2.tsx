import { useEffect, useMemo, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import type { Message, ToolCallRecord, TodoItem } from "../../types"

const EMPTY_TODOS: TodoItem[] = []

// ── Palette ──────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  build: "#3B82F6", general: "#8B5CF6", explore: "#6B7280", plan: "#06B6D4", unknown: "#9CA3AF",
}

const STATUS_BADGE: Record<string, string> = {
  idle:  "bg-emerald-50 text-emerald-600 border-emerald-200",
  busy:  "bg-amber-50 text-amber-600 border-amber-200",
  error: "bg-red-50 text-red-600 border-red-200",
}

const ENTRY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  user:       { bg: "bg-blue-50",    text: "text-blue-600",    label: "USER" },
  reasoning:  { bg: "bg-violet-50",  text: "text-violet-600",  label: "THINK" },
  text:       { bg: "bg-slate-100",  text: "text-slate-500",   label: "ASST" },
  tool:       { bg: "bg-amber-50",   text: "text-amber-600",   label: "TOOL" },
  compaction: { bg: "bg-red-50",     text: "text-red-400",     label: "COMP" },
}

const PRIO_STYLE: Record<string, string> = {
  high:   "bg-red-50 text-red-500 border-red-200",
  medium: "bg-amber-50 text-amber-500 border-amber-200",
  low:    "bg-gray-50 text-gray-400 border-gray-200",
}

// ── Helpers ──────────────────────────────────────────────────

function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}
function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
function fmtTime(ts?: number): string {
  return ts ? new Date(ts).toTimeString().slice(0, 8) : ""
}

// ── Tool stats ───────────────────────────────────────────────

interface ToolStat {
  name: string; calls: number; success: number; errors: number; rate: number; avgMs: number
}

function deriveToolStats(calls: ToolCallRecord[]): ToolStat[] {
  const m = new Map<string, ToolStat>()
  for (const c of calls) {
    if (!m.has(c.tool)) m.set(c.tool, { name: c.tool, calls: 0, success: 0, errors: 0, rate: 1, avgMs: 0 })
    const s = m.get(c.tool)!
    s.calls++
    if (c.status === "completed") s.success++
    if (c.status === "error") s.errors++
  }
  for (const s of m.values()) {
    const wd = calls.filter(c => c.tool === s.name && c.durationMs != null)
    s.avgMs = wd.length ? wd.reduce((a, c) => a + (c.durationMs ?? 0), 0) / wd.length : 0
    s.rate = s.calls > 0 ? s.success / s.calls : 1
  }
  return [...m.values()].sort((a, b) => b.calls - a.calls)
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
        const t: TlEntry["type"] = p.type === "reasoning" ? "reasoning" : p.type === "tool" ? "tool" : "text"
        out.push({
          key: `${msg.id}-${t}${i++}`, type: t, content: p.content ?? "",
          toolName: p.toolName, toolStatus: p.toolStatus, toolInput: p.toolInput, toolOutput: p.toolOutput,
          timestamp: msg.timestamp,
        })
      }
    }
  }
  return out
}

// ── Collapsible section header ───────────────────────────────

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

export function AgentDetailV2({ sessionId }: { sessionId: string }) {
  const session = useCockpitStore(s => s.sessions[sessionId])
  const liveMsgs = useCockpitStore(s => s.messages)
  const allToolCalls = useCockpitStore(s => s.toolCalls)
  const todosRaw = useCockpitStore(s => s.todos[sessionId])
  const todos: TodoItem[] = todosRaw ?? EMPTY_TODOS
  const [fetched, setFetched] = useState<Message[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [toolsOpen, setToolsOpen] = useState(true)
  const [todosOpen, setTodosOpen] = useState(true)
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

  const toolCalls = useMemo(() => allToolCalls.filter(c => c.sessionId === sessionId), [allToolCalls, sessionId])
  const toolStats = useMemo(() => deriveToolStats(toolCalls), [toolCalls])
  const timeline = useMemo(() => buildTimeline(messages), [messages])

  const toggle = (k: string) => setExpanded(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  if (!session) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Select an agent from the tree.</div>
  }

  const color = AGENT_COLORS[session.agent] ?? AGENT_COLORS.unknown
  const tok = session.tokens
  const total = tok.input + tok.output + tok.cacheRead
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  const runtime = session.createdAt ? Math.round((Date.now() - session.createdAt) / 1000) : null
  const todoDone = todos.filter(t => t.status === "completed").length

  return (
    <div className="space-y-1">
      {/* ═══ Info Card ═══ */}
      <div className="rounded-xl border border-gray-100 p-4" style={{ background: `linear-gradient(135deg, ${color}08 0%, white 60%)` }}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-3.5 h-3.5 rounded-full ring-2 ring-white shadow" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-gray-800">{session.agent}</span>
          {session.modelId && (
            <span className="text-[11px] text-gray-400 font-mono bg-gray-100 rounded px-1.5 py-0.5">{session.modelId}</span>
          )}
          <span className={`ml-auto text-[10px] border rounded-full px-2.5 py-0.5 font-semibold ${STATUS_BADGE[session.status] ?? ""}`}>
            {session.status === "busy" ? "running" : session.status === "idle" ? "ready" : session.status}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          {([
            ["Runtime", runtime != null ? `${runtime}s` : "—"],
            ["Tokens",  fmtTok(total)],
            ["Cost",    `$${session.cost.toFixed(4)}`],
            ["Children", String(session.children.length)],
          ] as const).map(([label, val]) => (
            <div key={label} className="bg-white/60 rounded-lg px-3 py-2 border border-gray-50">
              <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
              <div className="text-xs font-mono font-semibold text-gray-700">{val}</div>
            </div>
          ))}
        </div>

        <div className="h-2 bg-gray-100 rounded-full flex overflow-hidden gap-px">
          <div className="bg-blue-400 rounded-sm transition-all" style={{ width: `${pct(tok.input)}%` }} />
          <div className="bg-violet-400 rounded-sm transition-all" style={{ width: `${pct(tok.output)}%` }} />
          <div className="bg-emerald-400 rounded-sm transition-all" style={{ width: `${pct(tok.cacheRead)}%` }} />
        </div>
        <div className="flex gap-4 mt-1.5 text-[10px] text-gray-400 font-mono">
          <span className="flex items-center gap-1"><span className="w-2 h-1 bg-blue-400 rounded-sm" />In: {fmtTok(tok.input)}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-1 bg-violet-400 rounded-sm" />Out: {fmtTok(tok.output)}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-1 bg-emerald-400 rounded-sm" />Cache: {fmtTok(tok.cacheRead)}</span>
        </div>
      </div>

      {/* ═══ Tools ═══ */}
      {toolStats.length > 0 && (
        <div>
          <SecHead title="Tools" badge={toolStats.length} open={toolsOpen} toggle={() => setToolsOpen(o => !o)} />
          {toolsOpen && (
            <div className="rounded-lg border border-gray-100 overflow-hidden mb-1">
              <div className="grid grid-cols-[1fr_50px_56px_64px] gap-x-2 px-3 py-1.5 bg-gray-50 text-[10px] text-gray-400 font-medium">
                <span>Name</span><span className="text-right">Calls</span><span className="text-right">OK%</span><span className="text-right">Avg</span>
              </div>
              {toolStats.map(s => (
                <div key={s.name} className="grid grid-cols-[1fr_50px_56px_64px] gap-x-2 px-3 py-1.5 text-xs border-t border-gray-50 hover:bg-gray-50/50">
                  <span className="font-mono text-gray-700 truncate">{s.name}</span>
                  <span className="text-right text-gray-600 font-mono">{s.calls}</span>
                  <span className={`text-right font-mono ${s.rate < 0.8 ? "text-red-500" : "text-emerald-600"}`}>
                    {Math.round(s.rate * 100)}%
                  </span>
                  <span className="text-right font-mono text-gray-400">{s.avgMs > 0 ? fmtMs(s.avgMs) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ Todos ═══ */}
      {todos.length > 0 && (
        <div>
          <SecHead title="Todos" badge={todos.length} extra={`${todoDone}/${todos.length} done`}
            open={todosOpen} toggle={() => setTodosOpen(o => !o)} />
          {todosOpen && (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 mb-1">
              {todos.map((it, i) => {
                const icon = it.status === "completed" ? "✓" : it.status === "in_progress" ? "●" : it.status === "cancelled" ? "✗" : "○"
                const ic = it.status === "completed" ? "text-emerald-500" : it.status === "in_progress" ? "text-amber-500" : it.status === "cancelled" ? "text-gray-300" : "text-gray-400"
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <span className={`w-4 text-center text-sm leading-none mt-0.5 ${ic}`}>{icon}</span>
                    <span className={`flex-1 ${it.status === "cancelled" ? "line-through text-gray-300" : "text-gray-700"}`}>{it.content}</span>
                    <span className={`text-[10px] border rounded px-1.5 py-px shrink-0 ${PRIO_STYLE[it.priority] ?? ""}`}>{it.priority}</span>
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
                  ? (toolErr ? ENTRY_STYLE.compaction : toolOk ? { bg: "bg-emerald-50", text: "text-emerald-600", label: "TOOL" } : ENTRY_STYLE.tool)
                  : (ENTRY_STYLE[e.type] ?? ENTRY_STYLE.text)
                const canExpand = (e.type === "text" && e.content.length > 120)
                  || (e.type === "reasoning" && e.content.length > 0)
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
                        <p className={`text-xs leading-relaxed ${e.type === "user" ? "text-gray-800" : "text-gray-600"} ${!isExp && e.content.length > 120 ? "line-clamp-2" : ""}`}>
                          {e.content}
                        </p>
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
    </div>
  )
}
