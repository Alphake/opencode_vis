import { useState } from 'react'

interface ReasoningBlockProps {
  text: string
  time?: { start: number; end: number }
}

export default function ReasoningBlock({ text, time }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const duration = time ? ((time.end - time.start) / 1000).toFixed(1) : null

  // Truncate preview
  const preview = text.length > 120 ? text.slice(0, 120) + '...' : text

  return (
    <div className="rounded-lg border border-border/50 bg-bg-tertiary/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-hover/50 transition-colors cursor-pointer"
      >
        <span className="text-xs">💭</span>
        <span className="text-xs text-event-thinking font-medium">Thinking</span>
        {duration && (
          <span className="text-[10px] text-text-muted mono">{duration}s</span>
        )}
        <span className="flex-1 text-xs text-text-muted truncate ml-2">
          {preview}
        </span>
        <span className="text-xs text-text-muted">
          {expanded ? '▼' : '▶'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-2">
          <pre className="text-xs text-text-secondary/80 whitespace-pre-wrap break-words leading-relaxed">
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}
