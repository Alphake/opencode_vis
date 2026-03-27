import type { OcTodo, OcMessage } from '../types/opencode'
import EventFlowChart from './EventFlowChart'

interface TodoPanelProps {
  todos: OcTodo[]
  messages: OcMessage[]
  loading: boolean
}

const statusConfig = {
  completed: { icon: '✅', color: 'text-status-completed', border: 'border-status-completed/30' },
  in_progress: { icon: '🔄', color: 'text-status-in-progress', border: 'border-status-in-progress/30' },
  pending: { icon: '⏳', color: 'text-status-pending', border: 'border-status-pending/30' },
}

const priorityConfig = {
  high: { label: 'H', color: 'bg-event-error' },
  medium: { label: 'M', color: 'bg-event-tool' },
  low: { label: 'L', color: 'bg-event-thinking' },
}

export default function TodoPanel({ todos, messages, loading }: TodoPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary/50 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span>📋</span>
          <span className="font-medium text-text-primary">Todos</span>
          <span className="text-text-muted">({todos.length})</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-status-completed" /> Done
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-status-in-progress" /> Active
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-status-pending" /> Pending
          </span>
        </div>
      </div>

      {/* Todo List */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            <div className="text-center">
              <p>暂无 Todo</p>
              <p className="text-xs mt-1">该 Session 没有任务计划</p>
            </div>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {todos.map((todo, i) => {
              const status = statusConfig[todo.status]
              const priority = priorityConfig[todo.priority]
              return (
                <div
                  key={i}
                  className={`rounded-xl border bg-bg-secondary p-3 transition-colors hover:bg-bg-hover ${status.border}`}
                >
                  {/* Todo Header */}
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5">{status.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary leading-snug">
                        {todo.content}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${priority.color} text-white`}>
                          {priority.label}
                        </span>
                        <span className={`text-[10px] ${status.color}`}>
                          {todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待办'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* D3 Event Flow Chart (show for in_progress and completed todos) */}
                  {(todo.status === 'completed' || todo.status === 'in_progress') && (
                    <div className="mt-3 border-t border-border/50 pt-2">
                      <EventFlowChart messages={messages} todoContent={todo.content} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="border-t border-border px-4 py-2 bg-bg-secondary/50 shrink-0">
        <div className="flex items-center justify-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-thinking" /> Think
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-tool" /> Tool
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-file-write" /> File
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-bash" /> Bash
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-text" /> Text
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm bg-event-error" /> Error
          </span>
        </div>
      </div>
    </div>
  )
}
