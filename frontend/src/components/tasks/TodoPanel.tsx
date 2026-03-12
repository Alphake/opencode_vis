import { useCockpitStore } from "../../store/cockpitStore"
import type { TodoItem, ToolCallRecord } from "../../types"

const STATUS_ICON: Record<string, string> = {
  pending: "○",
  in_progress: "●",
  completed: "✓",
  cancelled: "✗",
}
const STATUS_CLASS: Record<string, string> = {
  pending: "text-gray-400",
  in_progress: "text-yellow-500",
  completed: "text-green-500",
  cancelled: "text-gray-300 line-through",
}
const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-50 text-red-600 border-red-200",
  medium: "bg-yellow-50 text-yellow-600 border-yellow-200",
  low: "bg-gray-50 text-gray-400 border-gray-200",
}
const CALL_STATUS_COLOR: Record<string, string> = {
  completed: "#10B981",
  running: "#F59E0B",
  error: "#EF4444",
}

function TodoRow({ item }: { item: TodoItem }) {
  return (
    <div className={`flex items-center gap-2 py-2 px-1 border-b border-gray-50 last:border-0 ${STATUS_CLASS[item.status]}`}>
      <span className="text-sm w-4 shrink-0 text-center font-mono">{STATUS_ICON[item.status]}</span>
      <span className="text-xs text-gray-700 flex-1">{item.content}</span>
      <span className={`text-[10px] border rounded px-1.5 py-0.5 shrink-0 ${PRIORITY_BADGE[item.priority] ?? ""}`}>
        {item.priority}
      </span>
    </div>
  )
}

function ProgressBar({ todos }: { todos: TodoItem[] }) {
  const total = todos.length
  const done = todos.filter((t) => t.status === "completed").length
  const active = todos.filter((t) => t.status === "in_progress").length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] text-gray-400 font-mono">
        <span>{done}/{total} done · {active} active</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-1.5 bg-status-idle rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** Shown when no formal TodoWrite tasks exist — shows session title + tool activity */
function NoTodosView({ sessionId }: { sessionId: string }) {
  const session = useCockpitStore((s) => s.sessions[sessionId])
  const toolCalls = useCockpitStore((s) => s.toolCalls)

  const title = session?.title
    ?.replace(/\s*\(@\w+\s+subagent\)\s*$/, "")
    .trim()
  const hasTitle = title && title !== "New session" && !title.startsWith("New session -")

  const calls: ToolCallRecord[] = toolCalls
    .filter((c) => c.sessionId === sessionId)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 30)

  return (
    <div className="flex flex-col gap-3">
      {/* Session title as task description */}
      {hasTitle && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
          <p className="text-[10px] text-blue-400 uppercase tracking-widest mb-1">Task</p>
          <p className="text-xs text-blue-700 leading-relaxed">{title}</p>
        </div>
      )}

      {/* Recent tool call activity */}
      {calls.length > 0 ? (
        <div className="flex flex-col">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-2">Recent Activity</p>
          {calls.map((c) => (
            <div key={c.callId} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
              <span
                className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ backgroundColor: CALL_STATUS_COLOR[c.status] ?? "#9CA3AF" }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-orange-600 truncate">{c.tool}</div>
                {(c.title || c.outputSnippet) && (
                  <div className="text-[10px] text-gray-400 truncate">{c.title || c.outputSnippet}</div>
                )}
              </div>
              {c.durationMs != null && (
                <span className="text-[10px] text-gray-300 font-mono shrink-0">
                  {c.durationMs < 1000 ? `${c.durationMs}ms` : `${(c.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        !hasTitle && (
          <p className="text-xs text-gray-400 py-2 text-center">No activity recorded yet.</p>
        )
      )}
    </div>
  )
}

interface Props {
  sessionId?: string
}

export function TodoPanel({ sessionId }: Props) {
  const todos = useCockpitStore((s) => s.todos)
  const sessions = useCockpitStore((s) => s.sessions)

  // Filter todos by selected session or show all
  const allTodos: Array<{ sessionId: string; items: TodoItem[] }> = sessionId
    ? [{ sessionId, items: todos[sessionId] ?? [] }]
    : Object.entries(todos).map(([sid, items]) => ({ sessionId: sid, items }))

  const hasAnyTodo = allTodos.some((g) => g.items.length > 0)

  // When a specific agent is selected but has no todos yet: show title + activity.
  // When todos later arrive via SSE, `todos[sessionId]` updates in the store and this
  // component re-renders to show the real todo list automatically.
  if (sessionId && !hasAnyTodo) {
    return <NoTodosView sessionId={sessionId} />
  }

  if (!hasAnyTodo) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-400">
        No todo tasks recorded yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto h-full">
      {allTodos.map(({ sessionId: sid, items }) => {
        if (items.length === 0) return null
        const session = sessions[sid]
        return (
          <div key={sid} className="border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-surface border-b border-border">
              <span className="text-xs font-semibold text-gray-600">
                {session?.agent ?? "unknown"} · {sid.slice(0, 10)}
              </span>
            </div>
            <div className="px-3 py-2">
              <ProgressBar todos={items} />
            </div>
            <div className="px-3 pb-2">
              {items.map((item, i) => (
                <TodoRow key={i} item={item} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
