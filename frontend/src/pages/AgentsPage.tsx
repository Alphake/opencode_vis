import { useState } from "react"
import { AgentGraph } from "../components/agents/AgentGraph"
import { AgentDetail } from "../components/agents/AgentDetail"

export function AgentsPage() {
  const [selectedId, setSelectedId] = useState<string | undefined>()

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: relation graph */}
      <div className="flex-1 min-w-0 border-r border-border">
        <AgentGraph onSelectSession={setSelectedId} selectedId={selectedId} />
      </div>

      {/* Right: agent detail */}
      <div className="w-[400px] shrink-0 p-4 overflow-y-auto">
        {selectedId ? (
          <AgentDetail sessionId={selectedId} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-400 text-center px-8">
            Click any node in the graph to inspect an agent.
          </div>
        )}
      </div>
    </div>
  )
}
