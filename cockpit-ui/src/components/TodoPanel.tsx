import { useState } from 'react'
import type { OcTodo } from '../types/opencode'

interface TodoPanelProps {
  todos: OcTodo[]
}

export default function TodoPanel({ todos }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true)

  if (todos.length === 0) return null

  const completedCount = todos.filter(t => t.status === 'completed').length
  const totalCount = todos.length

  // Sort: pending first, then in_progress, then completed
  // BUT: keep original order within each group (newest at end)
  const sortedTodos = [...todos].sort((a, b) => {
    const order = { pending: 0, in_progress: 1, completed: 2 }
    const aOrder = order[a.status] ?? 0
    const bOrder = order[b.status] ?? 0
    if (aOrder !== bOrder) return aOrder - bOrder

    // Within same status, keep original order (newest at end)
    return 0
  })

  return (
    <div
      style={{
        maxWidth: '100%',
        margin: '0 16px',
        background: 'var(--color-bg-white)',
        border: '1px solid var(--color-border-light)',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {completedCount} of {totalCount} 待办事项 completed
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--color-text-tertiary)"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Todo List */}
      {expanded && (
        <div
          style={{
            padding: '0 12px 8px',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {sortedTodos.map((todo) => (
            <TodoItem key={todo.id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  )
}

function TodoItem({ todo }: { todo: OcTodo }) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in_progress'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '4px 0',
        opacity: isCompleted ? 0.5 : 1,
      }}
    >
      {/* Status Icon */}
      <div
        style={{
          width: 14,
          height: 14,
          marginTop: 2,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isCompleted ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : isInProgress ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
        )}
      </div>

      {/* Content */}
      <p
        style={{
          fontSize: '13px',
          color: isCompleted ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
          textDecoration: isCompleted ? 'line-through' : 'none',
          lineHeight: 1.4,
          wordBreak: 'break-word',
          margin: 0,
        }}
      >
        {todo.content}
      </p>
    </div>
  )
}
