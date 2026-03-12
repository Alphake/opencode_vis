import { useEffect, useState } from "react"
import { AgentGraph } from "./components/agents/AgentGraph"
import { AgentDetail } from "./components/agents/AgentDetail"
import { TaskPage } from "./pages/TaskPage"
import { ChatWindow } from "./components/messages/ChatWindow"
import { AgentHandoffs } from "./components/messages/AgentHandoffs"
import { useCockpitStore } from "./store/cockpitStore"
import { connectSocket } from "./services/socket"
import { api } from "./services/api"

type Tab = "agent" | "task" | "msg"
type MsgView = "chat" | "handoffs"

const TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "task", label: "Task" },
  { id: "msg", label: "Msg" },
]

export function App() {
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [tab, setTab] = useState<Tab>("agent")
  const [msgView, setMsgView] = useState<MsgView>("chat")
  const { connected, metrics } = useCockpitStore()

  useEffect(() => {
    connectSocket()
  }, [])

  // Fetch historical tool calls for the selected agent and merge into store
  useEffect(() => {
    if (!selectedId) return
    api.tools.calls(selectedId).then((calls) => {
      useCockpitStore.getState().mergeToolCalls(calls)
    }).catch(() => {})
  }, [selectedId])

  return (
    <div className="flex flex-col h-screen bg-white text-gray-900 font-sans">
      {/* Header */}
      <header className="h-12 border-b border-border bg-white flex items-center px-6 gap-8 shrink-0">
        <span className="text-sm font-semibold text-gray-900 tracking-tight select-none">
          Agent Cockpit
        </span>
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
          <span>Sessions: {metrics.totalSessions}</span>
          <span>Tokens: {(metrics.totalTokens.input + metrics.totalTokens.output).toLocaleString()}</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-status-idle" : "bg-status-error"}`} />
            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden flex">
        {/* Left: Agent Graph (shared, always visible) */}
        <div className="w-[380px] shrink-0 border-r border-border">
          <AgentGraph onSelectSession={setSelectedId} selectedId={selectedId} />
        </div>

        {/* Right: Tab panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border shrink-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                  tab === t.id
                    ? "text-gray-900 bg-white border border-b-white border-border -mb-px"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
            {selectedId && (
              <span className="ml-3 text-[10px] text-gray-300 font-mono">
                {selectedId.slice(0, 14)}…
              </span>
            )}

            {/* Msg view toggle — only when msg tab is active and an agent is selected */}
            {tab === "msg" && selectedId && (
              <div className="ml-auto flex items-center gap-1 mr-1">
                <button
                  onClick={() => setMsgView("chat")}
                  className={`px-2 py-1 text-[10px] rounded transition-colors ${
                    msgView === "chat"
                      ? "bg-gray-100 text-gray-700 font-medium"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setMsgView("handoffs")}
                  className={`px-2 py-1 text-[10px] rounded transition-colors ${
                    msgView === "handoffs"
                      ? "bg-gray-100 text-gray-700 font-medium"
                      : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  Handoffs
                </button>
              </div>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === "agent" && (
              <div className="h-full overflow-y-auto p-4">
                <AgentDetail sessionId={selectedId ?? ""} />
              </div>
            )}
            {tab === "task" && <TaskPage sessionId={selectedId} />}
            {tab === "msg" && (
              <div className="h-full overflow-hidden">
                {msgView === "chat" || !selectedId ? (
                  <div className="h-full overflow-y-auto bg-surface">
                    <ChatWindow sessionId={selectedId ?? null} />
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto">
                    <AgentHandoffs sessionId={selectedId} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
