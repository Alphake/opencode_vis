import { useCockpitStore } from "../../store/cockpitStore"

export function TopNav() {
  const { connected, metrics } = useCockpitStore()

  return (
    <header className="h-12 border-b border-border bg-white flex items-center px-6 gap-8 shrink-0">
      <span className="text-sm font-semibold text-gray-900 tracking-tight select-none">
        Agent Cockpit
      </span>
      <div className="ml-auto flex items-center gap-4 text-xs text-gray-400">
        <span>Sessions: {metrics.totalSessions}</span>
        <span>Tokens: {(metrics.totalTokens.input + metrics.totalTokens.output).toLocaleString()}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-status-idle" : "bg-status-error"}`}
          />
          <span>{connected ? "Connected" : "Disconnected"}</span>
        </div>
      </div>
    </header>
  )
}
