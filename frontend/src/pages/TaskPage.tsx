import { useState } from "react"
import { TodoPanel } from "../components/tasks/TodoPanel"
import { ToolsLog } from "../components/tasks/ToolsLog"
import { SkillsPanel } from "../components/tasks/SkillsPanel"

type SubTab = "tools" | "skills" | "mcp"

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP" },
]

function McpPlaceholder() {
  return (
    <p className="text-xs text-gray-400 py-4 text-center">
      MCP server data will appear here when MCP tools are invoked.<br />
      Tool calls with <code className="font-mono bg-gray-100 px-1 rounded">__</code> in the name are MCP calls.
    </p>
  )
}

interface Props {
  sessionId?: string
}

export function TaskPage({ sessionId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("tools")

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Todo list */}
      <div className="w-72 shrink-0 border-r border-border p-4 overflow-y-auto">
        <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-3">Todo Tasks</p>
        <TodoPanel sessionId={sessionId} />
      </div>

      {/* Right: Invocation detail */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Sub-tab bar */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b border-border shrink-0">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                subTab === t.id
                  ? "text-gray-900 bg-white border border-b-white border-border -mb-px"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {subTab === "tools" && <ToolsLog sessionId={sessionId} />}
          {subTab === "skills" && <SkillsPanel sessionId={sessionId} />}
          {subTab === "mcp" && <McpPlaceholder />}
        </div>
      </div>
    </div>
  )
}
