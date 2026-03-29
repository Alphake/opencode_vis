import { useState } from 'react'
import type { OcTodo } from '../types/opencode'

interface TodoPanelProps {
  todos: OcTodo[]
  /** 点击某条待办：用于点亮对应子任务面板与中间消息 */
  onTodoClick?: (todo: OcTodo) => void
}

export default function TodoPanel({ todos, onTodoClick }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true)

  if (todos.length === 0) return null

  const completedCount = todos.filter(t => t.status === 'completed').length
  const totalCount = todos.length

  // NO sorting - use API returned order (newest at end)
  // Only filter/complete indicator at top

  return (
    <div
      style={{
        maxWidth: '100%',
        margin: '0 16px',
        background: '#FFFFFF',
        border: '1px solid #E8E8E8',
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6F6F6F" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <path d="M9 12l2 2 4-4" />
          </svg>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#171717' }}>
            {completedCount} of {totalCount} 待办事项 completed
          </span>
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8F8F8F"
          strokeWidth="2"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {/* Todo List - NO sorting, use original order from API */}
      {expanded && (
        <div
          style={{
            padding: '0 12px 8px',
            maxHeight: 120,
            overflowY: 'auto',
          }}
        >
          {todos.map((todo, index) => (
            <TodoItem
              key={`todo-${index}`}
              todo={todo}
              clickable={Boolean(onTodoClick)}
              onPick={onTodoClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TodoItem({
  todo,
  clickable,
  onPick,
}: {
  todo: OcTodo
  clickable?: boolean
  onPick?: (todo: OcTodo) => void
}) {
  const isCompleted = todo.status === 'completed'
  const isInProgress = todo.status === 'in_progress'

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable && onPick
          ? () => onPick(todo)
          : undefined
      }
      onKeyDown={
        clickable && onPick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPick(todo)
              }
            }
          : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '8px',
        padding: '4px 0',
        opacity: isCompleted ? 0.5 : 1,
        cursor: clickable ? 'pointer' : 'default',
        borderRadius: 6,
        outline: 'none',
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0ABE00" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : isInProgress ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8445BC" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8F8F8F" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
          </svg>
        )}
      </div>

      {/* Content */}
      <p
        style={{
          fontSize: '13px',
          color: isCompleted ? '#8F8F8F' : '#171717',
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
