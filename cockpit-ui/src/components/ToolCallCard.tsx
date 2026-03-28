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

// Tool name to SVG icon mapping
const toolIcons: Record<string, JSX.Element> = {
  bash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  read_file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  write_file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  edit_file: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  ),
  glob: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  grep: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  search_content: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  fetch: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  websearch: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
}

// Default icon
const DefaultIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
)

export default function ToolCallCard({ tool, callID, state }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)

  const icon = toolIcons[tool] || <DefaultIcon />
  const statusColor =
    state.status === 'completed'
      ? { color: 'var(--color-status-completed)' }
      : state.status === 'error'
        ? { color: 'var(--surface-critical-strong)' }
        : { color: 'var(--color-status-in-progress)' }

  const formatInput = (input?: Record<string, unknown>) => {
    if (!input) return null
    try {
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
    <div
      className="rounded-lg overflow-hidden w-full"
      style={{
        background: 'var(--surface-base)',
        border: '1px solid var(--border-weak-base)',
      }}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 text-left transition-colors cursor-pointer"
        style={{
          height: 37,
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface-base-hover)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Tool icon */}
        <span style={{ color: 'var(--icon-weak-base)' }}>{icon}</span>

        {/* Tool name */}
        <span
          className="mono text-sm font-medium"
          style={{ color: 'var(--text-base)', textTransform: 'capitalize' }}
        >
          {tool}
        </span>

        {/* Status indicator */}
        <span style={statusColor}>
          {state.status === 'running' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : state.status === 'error' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>

        {/* Input preview */}
        {inputStr && (
          <span
            className="flex-1 text-xs truncate"
            style={{
              color: 'var(--text-weaker)',
              fontFamily: 'var(--font-family-mono)',
              marginLeft: 8,
            }}
            title={inputStr}
          >
            {inputStr.split('\n')[0]}
          </span>
        )}

        {/* Expand arrow */}
        <span
          style={{
            color: 'var(--icon-weak-base)',
            marginLeft: 'auto',
            transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border-weaker-base)',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {inputStr && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-weaker)', fontWeight: 500 }}
              >
                Input
              </div>
              <pre
                className="whitespace-pre-wrap break-all"
                style={{
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 12,
                  lineHeight: 'var(--line-height-large)',
                  color: 'var(--text-weak)',
                  background: 'var(--surface-raised-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 8,
                }}
              >
                {inputStr}
              </pre>
            </div>
          )}
          {state.output && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wider mb-1"
                style={{ color: 'var(--text-weaker)', fontWeight: 500 }}
              >
                Output
              </div>
              <pre
                className="whitespace-pre-wrap break-all"
                style={{
                  fontFamily: 'var(--font-family-mono)',
                  fontSize: 12,
                  lineHeight: 'var(--line-height-large)',
                  color: 'var(--text-weak)',
                  background: 'var(--surface-raised-base)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 8,
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {state.output.length > 2000 ? state.output.slice(0, 2000) + '\n... (truncated)' : state.output}
              </pre>
            </div>
          )}
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--text-weaker)',
              fontFamily: 'var(--font-family-mono)',
            }}
          >
            {callID}
          </div>
        </div>
      )}
    </div>
  )
}
