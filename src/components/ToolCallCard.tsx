import { useState } from 'react'

interface ToolCallCardProps {
  tool: string
  callID: string
  state: {
    status: 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    output?: string
  }
}

// Map tool names to icons
const toolIcons: Record<string, string> = {
  websearch: '🔍',
  read_file: '📖',
  write_file: '✏️',
  edit_file: '📝',
  grep: '🔎',
  glob: '📂',
  bash: '💻',
  execute: '⚡',
  list_dir: '📁',
  replace_in_file: '🔄',
  search_content: '🔎',
  fetch: '🌐',
}

export default function ToolCallCard({ tool, callID, state }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const icon = toolIcons[tool] || '🔧'
  const statusColor = state.status === 'completed' ? 'text-status-completed' : state.status === 'error' ? 'text-event-error' : 'text-status-in-progress'

  const formatInput = (input?: Record<string, unknown>) => {
    if (!input) return null
    try {
      // Show most relevant fields
      const entries = Object.entries(input)
        .filter(([k]) => !['sessionId', 'messageId'].includes(k))
        .slice(0, 4)
      if (entries.length === 0) return null
      return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')
    } catch {
      return JSON.stringify(input)
    }
  }

  const inputStr = formatInput(state.input)

  return (
    <div className="rounded-lg border border-border bg-bg-tertiary overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-bg-hover transition-colors cursor-pointer"
      >
        <span className="text-sm">{icon}</span>
        <span className="mono text-xs font-medium text-event-tool">{tool}</span>
        <span className={`text-xs ${statusColor}`}>
          {state.status === 'running' ? '⏳' : state.status === 'error' ? '❌' : '✓'}
        </span>
        {inputStr && (
          <span className="flex-1 text-xs text-text-muted truncate ml-2" title={inputStr}>
            {inputStr.split('\n')[0]}
          </span>
        )}
        <span className="text-xs text-text-muted ml-auto">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {inputStr && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Input</div>
              <pre className="text-xs mono text-text-secondary whitespace-pre-wrap break-all bg-bg-primary/50 rounded p-2">
                {inputStr}
              </pre>
            </div>
          )}
          {state.output && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Output</div>
              <pre className="text-xs mono text-text-secondary whitespace-pre-wrap break-all bg-bg-primary/50 rounded p-2 max-h-40 overflow-y-auto">
                {state.output.length > 2000 ? state.output.slice(0, 2000) + '\n... (truncated)' : state.output}
              </pre>
            </div>
          )}
          <div className="text-[10px] mono text-text-muted">
            {callID}
          </div>
        </div>
      )}
    </div>
  )
}
