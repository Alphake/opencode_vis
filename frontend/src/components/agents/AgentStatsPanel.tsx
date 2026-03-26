import { useEffect, useMemo, useState } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import { api } from "../../services/api"
import type { ToolCallRecord } from "../../types"

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

function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}
function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
function fmtTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8)
}

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

function SecHead({ title, badge, open, toggle }: {
  title: string; badge?: string | number; open: boolean; toggle: () => void
}) {
  return (
    <button onClick={toggle} className="w-full flex items-center gap-2 py-2 text-left select-none">
      <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{title}</span>
      {badge !== undefined && (
        <span className="text-[10px] bg-gray-100 text-gray-500 font-mono px-1.5 py-0.5 rounded-md">{badge}</span>
      )}
      <span className="ml-auto text-gray-300 text-[10px] transition-transform"
        style={{ transform: open ? "rotate(0)" : "rotate(-90deg)" }}>▾</span>
    </button>
  )
}

/** 若 content 以 title 开头（如 "ErrorName: ..."），只显示后面部分，避免重复 */
function dropRedundantErrorPrefix(title: string, content: string): string {
  const t = content.trim()
  if (!t || !title) return content
  const prefix1 = title + ": "
  const prefix2 = title + ":"
  if (t === title) return ""
  if (t.startsWith(prefix1)) {
    const rest = t.slice(prefix1.length).trim()
    return rest === title ? "" : rest
  }
  if (t.startsWith(prefix2)) {
    const rest = t.slice(prefix2.length).trim()
    return rest === title ? "" : rest
  }
  return content
}

function ErrorEntry({
  kind,
  title,
  extra,
  time,
  content,
}: {
  kind: "session" | "tool"
  title: string
  extra?: string
  time: number
  content: string
}) {
  const [expanded, setExpanded] = useState(false)
  let displayContent = dropRedundantErrorPrefix(title, content)
  if (displayContent === title || displayContent === title + ":") displayContent = ""
  const showToggle = displayContent.length > 80
  return (
    <div className="px-3 py-2 text-xs">
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-[10px] rounded px-1.5 py-px font-bold uppercase shrink-0 ${kind === "session" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
          {kind}
        </span>
        <span className="font-mono font-semibold text-red-600 truncate min-w-0">{title}</span>
        {extra && <span className="text-[10px] text-gray-400 font-mono shrink-0">{extra}</span>}
        <span className="ml-auto text-[10px] text-gray-300 font-mono tabular-nums shrink-0">{fmtTime(time)}</span>
      </div>
      {displayContent ? (
        <>
          <p className={`text-[10px] text-red-500 leading-relaxed whitespace-pre-wrap break-words ${!expanded && showToggle ? "line-clamp-2" : ""}`}>
            {displayContent}
          </p>
          {showToggle && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="mt-0.5 text-[10px] text-blue-500 hover:underline"
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
        </>
      ) : null}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────

export function AgentStatsPanel({ sessionId }: { sessionId: string }) {
  const session = useCockpitStore(s => s.sessions[sessionId])
  const allToolCalls = useCockpitStore(s => s.toolCalls)

  const [toolsOpen, setToolsOpen] = useState(true)
  const [configOpen, setConfigOpen] = useState(true)
  const [errorsOpen, setErrorsOpen] = useState(true)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)

  useEffect(() => {
    if (sessionId) {
      api.tools.calls(sessionId).then(calls => {
        useCockpitStore.getState().mergeToolCalls(calls)
      }).catch(() => {})
    }
  }, [sessionId])

  const toolCalls = useMemo(() => allToolCalls.filter(c => c.sessionId === sessionId), [allToolCalls, sessionId])
  const toolStats = useMemo(() => deriveToolStats(toolCalls), [toolCalls])
  const errorCalls = useMemo(() => toolCalls.filter(c => c.status === "error").sort((a, b) => b.startedAt - a.startedAt), [toolCalls])
  const rawSessionErrors = session?.errorHistory ?? []
  const sessionErrors = useMemo(() => {
    const seen = new Set<string>()
    return rawSessionErrors.filter(e => {
      const key = `${(e.name ?? "").trim()}|${(e.message ?? "").trim()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [rawSessionErrors])
  const errorCallsToShow = useMemo(() => {
    const sessionMessages = new Set(sessionErrors.map(e => (e.message ?? "").trim()))
    return errorCalls.filter(c => {
      const msg = (c.outputSnippet ?? "").trim()
      return msg && !sessionMessages.has(msg)
    })
  }, [sessionErrors, errorCalls])

  if (!session) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">No agent selected.</div>
  }

  const color = AGENT_COLORS[session.agent] ?? AGENT_COLORS.unknown
  const tok = session.tokens
  const totalBar = tok.input + tok.output
  const total = tok.input + tok.output + tok.cacheRead
  const pct = (v: number) => (totalBar > 0 ? (v / totalBar) * 100 : 0)
  const runtime = session.createdAt ? Math.round((Date.now() - session.createdAt) / 1000) : null
  const totalToolCallCount = toolCalls.length
  const runningTools = toolCalls.filter(c => c.status === "running").length

  return (
    <div className="p-4 space-y-3 overflow-y-auto h-full">
      {/* ═══ Info Card (no duplicate header — header is in panel title bar) ═══ */}
      <div className="rounded-xl border border-gray-100 p-4" style={{ background: `linear-gradient(135deg, ${color}08 0%, white 60%)` }}>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {([
            ["Runtime", runtime != null ? `${runtime}s` : "—"],
            ["Tokens", fmtTok(total)],
            ["Cost", `$${session.cost.toFixed(4)}`],
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
        </div>
        <div className="flex gap-3 mt-1.5 text-[10px] text-gray-400 font-mono">
          <span className="flex items-center gap-1"><span className="w-2 h-1 bg-blue-400 rounded-sm" />In: {fmtTok(tok.input)}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-1 bg-violet-400 rounded-sm" />Out: {fmtTok(tok.output)}</span>
        </div>
      </div>

      {/* ═══ Errors (above Tools — important) ═══ */}
      <div>
        <SecHead title="Errors"
          badge={sessionErrors.length + errorCallsToShow.length > 0 ? sessionErrors.length + errorCallsToShow.length : undefined}
          open={errorsOpen} toggle={() => setErrorsOpen(o => !o)} />
        {errorsOpen && (
          (sessionErrors.length + errorCallsToShow.length) > 0 ? (
            <div className="rounded-lg border border-red-100 divide-y divide-red-50 overflow-hidden">
              {sessionErrors.map((e, i) => (
                <ErrorEntry
                  key={`se-${i}`}
                  kind="session"
                  title={e.name}
                  time={e.timestamp}
                  content={e.message}
                />
              ))}
              {errorCallsToShow.map(c => (
                <ErrorEntry
                  key={c.callId}
                  kind="tool"
                  title={c.tool}
                  extra={c.durationMs != null ? fmtMs(c.durationMs) : undefined}
                  time={c.startedAt}
                  content={c.outputSnippet ?? ""}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-3 rounded-lg border border-emerald-200 bg-emerald-50/50">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-emerald-600 font-medium">All Clear</span>
              <span className="text-[10px] text-emerald-400">No errors recorded</span>
            </div>
          )
        )}
      </div>

      {/* ═══ Tools ═══ */}
      <div>
        <SecHead title="Tools"
          badge={toolStats.length > 0 ? `${totalToolCallCount} calls${runningTools > 0 ? ` · ${runningTools} active` : ""}` : undefined}
          open={toolsOpen} toggle={() => setToolsOpen(o => !o)} />
        {toolsOpen && (
          toolStats.length > 0 ? (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <div className="grid grid-cols-[1fr_44px_44px_56px] gap-x-2 px-3 py-1.5 bg-gray-50 text-[10px] text-gray-400 font-medium">
                <span>Name</span><span className="text-right">Calls</span><span className="text-right">OK%</span><span className="text-right">Avg</span>
              </div>
              {toolStats.map(s => (
                <div key={s.name} className="grid grid-cols-[1fr_44px_44px_56px] gap-x-2 px-3 py-1.5 text-xs border-t border-gray-50 hover:bg-gray-50/50">
                  <span className="font-mono text-gray-700 truncate">{s.name}</span>
                  <span className="text-right text-gray-600 font-mono">{s.calls}</span>
                  <span className={`text-right font-mono ${s.rate < 0.8 ? "text-red-500" : "text-emerald-600"}`}>
                    {Math.round(s.rate * 100)}%
                  </span>
                  <span className="text-right font-mono text-gray-400">{s.avgMs > 0 ? fmtMs(s.avgMs) : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">
              No tool calls recorded
            </div>
          )
        )}
      </div>

      {/* ═══ Config ═══ */}
      <div>
        <SecHead title="Configuration" open={configOpen} toggle={() => setConfigOpen(o => !o)} />
        {configOpen && (
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden">
            {([
              ["Model", session.modelId],
              ["Provider", session.providerId],
              ["Agent Type", session.agent],
              ["Session ID", session.id],
              ["Parent", session.parentId ?? "root"],
              ["Directory", session.directory ?? "—"],
            ] as const).map(([label, val]) => (
              <div key={label} className="flex items-start gap-2 px-3 py-2 text-xs">
                <span className="text-gray-400 w-24 shrink-0">{label}</span>
                <span className="font-mono text-gray-700 break-all min-w-0">{val || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ System Prompt ═══ */}
      {session.systemPrompt && (
        <div>
          <SecHead title="System Prompt" open={promptOpen} toggle={() => setPromptOpen(o => !o)} />
          {promptOpen && (
            <div className="text-xs text-gray-600 leading-relaxed bg-gray-50 rounded-lg p-3 border border-gray-100">
              <div className={`overflow-y-auto whitespace-pre-wrap break-words ${!promptExpanded && session.systemPrompt.length > 1500 ? "max-h-52" : ""}`}>
                {session.systemPrompt}
              </div>
              {session.systemPrompt.length > 1500 && (
                <button
                  type="button"
                  onClick={() => setPromptExpanded(e => !e)}
                  className="mt-2 text-[10px] text-blue-500 hover:underline"
                >
                  {promptExpanded ? "收起" : "展开全部"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
