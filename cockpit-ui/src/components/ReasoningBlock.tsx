import { useState } from 'react'

interface ReasoningBlockProps {
  text: string
  time?: { start: number; end: number }
}

export default function ReasoningBlock({ text, time }: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const duration = time ? ((time.end - time.start) / 1000).toFixed(1) : null

  // Truncate preview
  const preview = text.length > 100 ? text.slice(0, 100) + '...' : text

  return (
    <div
      className="rounded-lg overflow-hidden w-full"
      style={{
        background: 'var(--surface-base)',
        border: '1px solid var(--border-weak-base)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 text-left transition-colors cursor-pointer"
        style={{
          height: 32,
          background: 'transparent',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface-base-hover)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Thinking icon */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-event-thinking)"
          strokeWidth="2"
        >
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>

        <span
          className="text-xs font-medium"
          style={{ color: 'var(--color-event-thinking)' }}
        >
          Thinking
        </span>

        {duration && (
          <span
            className="mono"
            style={{ color: 'var(--text-weaker)', fontSize: 11 }}
          >
            {duration}s
          </span>
        )}

        <span
          className="flex-1 text-xs truncate"
          style={{ color: 'var(--text-weaker)', marginLeft: 4 }}
        >
          {preview}
        </span>

        <span
          style={{
            color: 'var(--icon-weak-base)',
            transition: 'transform 0.15s ease',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--border-weaker-base)',
            padding: '8px 12px',
          }}
        >
          <pre
            className="whitespace-pre-wrap break-words"
            style={{
              fontFamily: 'var(--font-family-sans)',
              fontSize: 12,
              lineHeight: 'var(--line-height-normal)',
              color: 'var(--text-weak)',
            }}
          >
            {text}
          </pre>
        </div>
      )}
    </div>
  )
}
