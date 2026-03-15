import { useEffect, useMemo, useState } from "react"
import { AgentTreePanel } from "./components/agents/AgentTreePanel"
import { OverviewPanel } from "./components/agents/OverviewPanel"
import { AgentFlowPanel } from "./components/agents/AgentFlowPanel"
import { AgentStatsPanel } from "./components/agents/AgentStatsPanel"
import { useCockpitStore } from "./store/cockpitStore"
import { connectSocket } from "./services/socket"
import type { Session, Metrics } from "./types"

// ── Types ────────────────────────────────────────────────────

interface TabItem {
  id: string
  type: "overview" | "agent"
  sessionId?: string
  label: string
  agentType?: string
}

const OVERVIEW_TAB: TabItem = { id: "__overview__", type: "overview", label: "Overview" }

const AGENT_COLORS: Record<string, string> = {
  build: "#0D9488", plan: "#B45309", general: "#1D4ED8", explore: "#6D28D9", unknown: "#64748B",
}

function shortTitle(s: { title?: string; agent: string; id: string }): string {
  const title = s.title?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "").trim()
  if (title && title !== "New session" && !title.startsWith("New session -")) {
    return title.length > 20 ? title.slice(0, 18) + "…" : title
  }
  return s.agent !== "unknown" ? s.agent : s.id.slice(0, 8)
}

/** 与后端一致：统一路径分隔符，便于比较 directory */
function normalizeDirectory(d: string): string {
  if (!d) return ""
  return d.replace(/\\/g, "/").trim().replace(/\/+$/, "")
}

// ── App ──────────────────────────────────────────────────────

export function App() {
  const [tabs, setTabs] = useState<TabItem[]>([OVERVIEW_TAB])
  const [activeTabId, setActiveTabId] = useState("__overview__")
  const [selectedDirectory, setSelectedDirectory] = useState("")
  const { connected, metrics, sessions } = useCockpitStore()

  useEffect(() => { connectSocket() }, [])

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]
  const selectedId = activeTab?.sessionId
  const selectedSession = selectedId ? sessions[selectedId] : undefined

  const directories = useMemo(() => {
    return [...new Set(Object.values(sessions).map(s => s.directory).filter(Boolean))].sort()
  }, [sessions])

  const effectiveDirectory = selectedDirectory || (directories.length > 0 ? directories[0] : "")

  // 切换 workspace 时：若当前选中的 session 不属于新 directory，切回 Overview，使左/中/右联动
  useEffect(() => {
    if (!effectiveDirectory || !selectedSession) return
    const dirNorm = normalizeDirectory(effectiveDirectory)
    const sessionDirNorm = normalizeDirectory(selectedSession.directory ?? "")
    if (sessionDirNorm && sessionDirNorm !== dirNorm) {
      setActiveTabId("__overview__")
    }
  }, [effectiveDirectory, selectedSession?.id, selectedSession?.directory])

  function openAgentTab(sessionId: string) {
    const existing = tabs.find(t => t.sessionId === sessionId)
    if (existing) { setActiveTabId(existing.id); return }
    const session = sessions[sessionId]
    const newTab: TabItem = {
      id: sessionId, type: "agent", sessionId,
      label: shortTitle(session ?? { title: "", agent: "agent", id: sessionId }),
      agentType: session?.agent,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(sessionId)
  }

  function closeTab(tabId: string) {
    if (tabId === "__overview__") return
    const idx = tabs.findIndex(t => t.id === tabId)
    const next = tabs.filter(t => t.id !== tabId)
    setTabs(next)
    if (activeTabId === tabId) {
      setActiveTabId(idx > 0 && next[idx - 1] ? next[idx - 1].id : next[0]?.id ?? "__overview__")
    }
  }

  return (
    <div className="flex h-screen bg-gray-100/80 font-sans p-2 gap-2">
      {/* ═══ LEFT ═══ */}
      <div className="w-[260px] shrink-0 bg-white rounded-xl overflow-hidden shadow-sm flex flex-col">
        <AgentTreePanel
          directory={effectiveDirectory}
          directories={directories}
          connected={connected}
          onDirectoryChange={setSelectedDirectory}
          onSelectSession={openAgentTab}
          selectedId={selectedId}
        />
      </div>

      {/* ═══ CENTER ═══ */}
      <div className="flex-1 min-w-0 flex flex-col bg-white rounded-xl overflow-hidden shadow-sm">
        {/* Tab bar */}
        <div className="h-11 flex items-center gap-1 px-3 border-b border-gray-100 bg-gray-50/40 overflow-x-auto shrink-0">
          {tabs.map(tab => {
            const isActive = activeTabId === tab.id
            const dotColor = tab.agentType ? (AGENT_COLORS[tab.agentType] ?? AGENT_COLORS.unknown) : undefined
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`
                  group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full
                  transition-all duration-150 shrink-0 select-none
                  ${isActive
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/80 font-medium"
                    : "text-gray-400 hover:text-gray-600 hover:bg-white/60"
                  }
                `}
              >
                {tab.type === "overview" && (
                  <span className={`text-sm leading-none ${isActive ? "text-blue-500" : "text-gray-300"}`}>◈</span>
                )}
                {tab.type === "agent" && dotColor && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                )}
                <span className="truncate max-w-[120px]">{tab.label}</span>
                {tab.type !== "overview" && (
                  <span
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                    className="w-4 h-4 rounded flex items-center justify-center
                               text-[10px] text-gray-300 opacity-0 group-hover:opacity-100
                               hover:bg-gray-200 hover:text-gray-500 transition-all ml-0.5 cursor-pointer"
                  >×</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeTab.type === "overview" && (
            <div className="h-full overflow-y-auto p-4">
              <OverviewPanel onSelectSession={openAgentTab} selectedId={selectedId} directory={effectiveDirectory} />
            </div>
          )}
          {activeTab.type === "agent" && selectedId && (
            <div className="h-full overflow-y-auto p-5">
              <AgentFlowPanel sessionId={selectedId} />
            </div>
          )}
        </div>
      </div>

      {/* ═══ RIGHT ═══ */}
      <div className="w-[320px] shrink-0 bg-white rounded-xl overflow-hidden shadow-sm flex flex-col">
        {selectedId && selectedSession ? (
          <>
            <div className="h-11 px-4 flex items-center gap-2 border-b border-gray-100 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: AGENT_COLORS[selectedSession.agent] ?? AGENT_COLORS.unknown }} />
              <span className="text-xs font-semibold text-gray-700 truncate">{selectedSession.agent}</span>
              <span className="text-[10px] text-gray-300 font-mono truncate">{selectedId.slice(0, 10)}</span>
              <span className={`ml-auto text-[10px] font-mono font-medium ${
                selectedSession.status === "busy" ? "text-amber-500" :
                selectedSession.status === "error" ? "text-red-500" : "text-emerald-500"
              }`}>{selectedSession.status === "busy" ? "running" : selectedSession.status === "idle" ? "idle" : selectedSession.status}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <AgentStatsPanel sessionId={selectedId} />
            </div>
          </>
        ) : (
          <RightSummary
            connected={connected}
            metrics={metrics}
            sessions={sessions}
            directory={effectiveDirectory}
            normalizeDirectory={normalizeDirectory}
            onSelectSession={openAgentTab}
          />
        )}
      </div>
    </div>
  )
}

// ── Right summary (no agent selected) ─────────────────────────

function RightSummary({ connected, metrics, sessions, directory, normalizeDirectory, onSelectSession }: {
  connected: boolean; metrics: Metrics; sessions: Record<string, Session>; directory: string; normalizeDirectory: (d: string) => string; onSelectSession: (sessionId: string) => void
}) {
  const list = useMemo(() => {
    const dirNorm = normalizeDirectory(directory)
    if (!dirNorm) return Object.values(sessions)
    return Object.values(sessions).filter(s => normalizeDirectory(s.directory ?? "") === dirNorm)
  }, [sessions, directory, normalizeDirectory])
  const types = [...new Set(list.map(s => s.agent))]
  const tok = metrics.totalTokens.input + metrics.totalTokens.output
  const agentsWithErrors = list.filter(s => s.status === "error" || (s.errorHistory?.length ?? 0) > 0)

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 px-4 flex items-center border-b border-gray-100 shrink-0">
        <span className="text-[11px] text-gray-400 uppercase tracking-widest font-semibold">Summary</span>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Error alerts：标明是谁的 error，点击跳转到该 agent 查看详情 */}
        {agentsWithErrors.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">Errors（点击查看该 Agent 详情）</div>
            {agentsWithErrors.map(a => {
              const isLive = a.status === "error"
              const errCount = a.errorHistory?.length ?? 0
              const lastErr = errCount > 0 ? a.errorHistory[errCount - 1] : null
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectSession(a.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border cursor-pointer hover:ring-1 hover:ring-blue-200 transition-all ${
                    isLive ? "bg-red-50 border-red-200" : "bg-amber-50/50 border-amber-200/60"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isLive ? "bg-red-400" : "bg-amber-400"}`} />
                    <span className={`text-xs font-semibold ${isLive ? "text-red-700" : "text-amber-700"}`}>Agent: {a.agent}</span>
                    <span className="text-[10px] text-gray-400 font-mono truncate">Session: {a.id.slice(0, 12)}…</span>
                    <span className={`ml-auto text-[10px] font-medium ${isLive ? "text-red-500" : "text-amber-500"}`}>
                      {isLive ? "live error" : `${errCount} past`}
                    </span>
                  </div>
                  {lastErr && (
                    <div className="mt-1 text-[10px] text-red-500/80 whitespace-pre-wrap break-words">
                      <span className="font-semibold">{lastErr.name}: </span>
                      {lastErr.message}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Connection */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-400"}`} />
          {connected ? "Backend connected" : "Disconnected"}
        </div>

        {/* Metrics：有 directory 时 Sessions 为当前 workspace 数量 */}
        <div className="grid grid-cols-2 gap-2">
          {([
            ["Sessions", String(directory ? list.length : metrics.totalSessions)],
            ["Messages", String(metrics.totalMessages)],
            ["Tokens",   tok >= 1000 ? `${(tok / 1000).toFixed(1)}k` : String(tok)],
            ["Cost",     `$${metrics.totalCost.toFixed(3)}`],
          ] as const).map(([label, value]) => (
            <div key={label} className="bg-gray-50 rounded-lg p-3">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</div>
              <div className="text-sm font-semibold text-gray-700 mt-0.5 font-mono">{value}</div>
            </div>
          ))}
        </div>

        {/* Agent types */}
        {types.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">Agent Types</div>
            <div className="flex flex-wrap gap-1.5">
              {types.map(type => (
                <span key={type}
                  className="flex items-center gap-1.5 text-[11px] text-gray-600
                             bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: AGENT_COLORS[type] ?? AGENT_COLORS.unknown }} />
                  {type}
                  <span className="text-gray-400 font-mono">×{list.filter(s => s.agent === type).length}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-gray-100 mt-auto">
        <p className="text-xs text-gray-400 text-center leading-relaxed">
          Select an agent from the tree<br />to view details
        </p>
      </div>
    </div>
  )
}
