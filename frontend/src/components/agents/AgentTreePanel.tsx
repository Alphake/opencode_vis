import { useMemo } from "react"
import { useCockpitStore } from "../../store/cockpitStore"
import type { Session } from "../../types"

// ── Types ────────────────────────────────────────────────────

interface TreeNode { session: Session; children: TreeNode[] }

// ── Palette ──────────────────────────────────────────────────

/** 与 Overview message 调色盘不重合的 agent 颜色 */
const AGENT_COLORS: Record<string, string> = {
  build: "#0D9488", plan: "#B45309", general: "#1D4ED8", explore: "#6D28D9", unknown: "#64748B",
}

/** 状态 tag 用：idle 静止不抢眼，pending 等待批准/用户介入 */
const STATUS_META: Record<string, { color: string; bg: string; text: string; border: string; label: string }> = {
  idle:     { color: "#64748B", bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-200", label: "idle" },
  busy:     { color: "#F59E0B", bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", label: "running" },
  retrying: { color: "#F59E0B", bg: "bg-amber-50", text: "text-amber-600", border: "border-amber-200", label: "retrying" },
  pending:  { color: "#6366F1", bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-200", label: "pending" },
  error:    { color: "#EF4444", bg: "bg-red-50", text: "text-red-500", border: "border-red-200", label: "error" },
}

const CONNECTOR      = "rgba(203, 213, 225, 0.55)"
const CONNECTOR_BUSY = "rgba(245, 158, 11, 0.4)"
const ARROW_NORMAL   = "rgba(148, 163, 184, 0.55)"
const ARROW_BUSY     = "rgba(245, 158, 11, 0.6)"

// ── Helpers ──────────────────────────────────────────────────

function shortTitle(s: Session): string {
  const title = s.title?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "").trim()
  if (title && title !== "New session" && !title.startsWith("New session -")) {
    return title.length > 34 ? title.slice(0, 32) + "…" : title
  }
  return s.agent !== "unknown" ? s.agent : s.id.slice(0, 12)
}

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function buildTree(sessions: Record<string, Session>, directory: string): TreeNode[] {
  const filtered = Object.values(sessions).filter(s => s.directory === directory)
  const ids = new Set(filtered.map(s => s.id))
  const make = (s: Session): TreeNode => ({
    session: s,
    children: s.children
      .filter(id => ids.has(id))
      .map(id => sessions[id])
      .filter((c): c is Session => !!c)
      .map(make),
  })
  return filtered
    .filter(s => !s.parentId || !ids.has(s.parentId))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(make)
}

const DEFAULT_STATUS_STYLE = { bg: "bg-gray-50", text: "text-gray-500", border: "border-gray-200", label: "idle" }

function Arrow({ color }: { color: string }) {
  return (
    <svg width="6" height="8" viewBox="0 0 6 8" className="shrink-0">
      <path d="M0 0.5L5 4L0 7.5Z" fill={color} />
    </svg>
  )
}

// ── Tree node ────────────────────────────────────────────────

function TreeNodeView({ node, selectedId, onSelect }: {
  node: TreeNode; selectedId: string | undefined; onSelect: (id: string) => void
}) {
  const { session } = node
  const agentColor = AGENT_COLORS[session.agent] ?? AGENT_COLORS.unknown
  const isSelected = session.id === selectedId
  const isBusy = session.status === "busy"
  const totalTokens = session.tokens.input + session.tokens.output + session.tokens.cacheRead
  const sessionErrs = session.errorHistory?.length ?? 0
  const toolErrs = session.toolErrorCount ?? 0
  const errCount = sessionErrs + toolErrs

  return (
    <div>
      <button
        onClick={() => onSelect(session.id)}
        className={`
          w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 border group
          ${isSelected
            ? "bg-blue-50/80 border-blue-200 shadow-sm ring-1 ring-blue-100"
            : "bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm"
          }
        `}
        style={{ borderLeftWidth: 3, borderLeftColor: isSelected ? agentColor : `${agentColor}66` }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: agentColor }}>{session.agent}</span>
          {(() => {
            const style = STATUS_META[session.status] ?? DEFAULT_STATUS_STYLE
            return (
              <span className={`ml-auto text-[10px] rounded-full px-1.5 py-px border font-medium ${style.bg} ${style.text} ${style.border}`}>
                {style.label}
              </span>
            )
          })()}
        </div>
        <div className="mt-1 text-[11px] text-gray-500 truncate leading-snug">{shortTitle(session)}</div>
        <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-400 font-mono">
          <span>{fmtTokens(totalTokens)}</span>
          {session.cost > 0 && <span>${session.cost.toFixed(4)}</span>}
          <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-gray-300">
            {session.id.slice(0, 8)}
          </span>
        </div>
        {errCount > 0 && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-red-500">
            {Array.from({ length: Math.min(errCount, 5) }).map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
            ))}
            <span>{errCount} 次错误</span>
          </div>
        )}
      </button>

      {node.children.length > 0 && (
        <div className="mt-1">
          {node.children.map((child, i) => {
            const isLast = i === node.children.length - 1
            const cBusy = child.session.status === "busy"
            return (
              <div key={child.session.id} className="relative ml-4 pl-5 mt-1.5">
                {!isLast ? (
                  <div className={`absolute left-0 top-0 bottom-0 w-px ${cBusy ? "tree-line-busy" : ""}`}
                    style={cBusy ? undefined : { backgroundColor: CONNECTOR }} />
                ) : (
                  <div className={`absolute left-0 top-0 w-px ${cBusy ? "tree-line-busy" : ""}`}
                    style={{ height: 22, ...(cBusy ? {} : { backgroundColor: CONNECTOR }) }} />
                )}
                <div className="absolute left-0 h-px"
                  style={{ top: 22, width: 14, backgroundColor: cBusy ? CONNECTOR_BUSY : CONNECTOR }} />
                <span className="absolute" style={{ left: 11, top: 18 }}>
                  <Arrow color={cBusy ? ARROW_BUSY : ARROW_NORMAL} />
                </span>
                <TreeNodeView node={child} selectedId={selectedId} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Main panel ───────────────────────────────────────────────

interface Props {
  directory: string
  directories: string[]
  connected: boolean
  onDirectoryChange: (dir: string) => void
  onSelectSession: (id: string) => void
  selectedId: string | undefined
}

export function AgentTreePanel({
  directory, directories, connected,
  onDirectoryChange, onSelectSession, selectedId,
}: Props) {
  const sessions = useCockpitStore(s => s.sessions)
  const tree = useMemo(() => (directory ? buildTree(sessions, directory) : []), [sessions, directory])

  return (
    <div className="h-full flex flex-col">
      {/* ── Title bar (h-11, matches other panels) ── */}
      <div className="h-11 px-4 flex items-center border-b border-gray-100 shrink-0">
        <span className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Agents</span>
        <span className="ml-auto flex items-center gap-1.5" title={connected ? "Backend connected" : "Backend disconnected"}>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
          <span className={`text-[10px] font-medium ${connected ? "text-emerald-500" : "text-red-400"}`}>
            {connected ? "Connected" : "Offline"}
          </span>
        </span>
      </div>

      {/* ── Directory selector ── */}
      <div className="px-3 py-2 border-b border-gray-50">
        <select
          value={directory}
          onChange={e => onDirectoryChange(e.target.value)}
          className="w-full text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5
                     text-gray-700 font-mono focus:outline-none focus:ring-1 focus:ring-blue-200
                     focus:border-blue-300 transition-all appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%239CA3AF' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 8px center",
            paddingRight: "28px",
          }}
        >
          {directories.length === 0 && <option value="">Waiting for sessions…</option>}
          {directories.map(d => (
            <option key={d} value={d}>{d.length > 36 ? "…" + d.slice(-33) : d}</option>
          ))}
        </select>
      </div>

      {/* ── Tree ── */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <span className="text-2xl text-gray-200 select-none">◇</span>
            <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">
              {directory ? "No agents in this workspace yet.\nStart an OpenCode session." : "Waiting for session data…"}
            </p>
          </div>
        ) : (
          tree.map(root => (
            <TreeNodeView key={root.session.id} node={root} selectedId={selectedId} onSelect={onSelectSession} />
          ))
        )}
      </div>
    </div>
  )
}
