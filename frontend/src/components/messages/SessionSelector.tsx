import { useCockpitStore } from "../../store/cockpitStore"
import type { Session } from "../../types"

const STATUS_DOT: Record<string, string> = {
  idle: "bg-status-idle",
  busy: "bg-status-busy animate-pulse",
  error: "bg-status-error",
}

interface SessionNodeProps {
  session: Session
  depth: number
  selectedId: string | null
  allSessions: Record<string, Session>
  onSelect: (id: string) => void
}

function SessionNode({ session, depth, selectedId, allSessions, onSelect }: SessionNodeProps) {
  return (
    <div>
      <button
        onClick={() => onSelect(session.id)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
          selectedId === session.id ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[session.status]}`} />
        <span className="font-mono">{session.agent}</span>
        <span className="text-gray-300 truncate">{session.id.slice(0, 10)}</span>
      </button>
      {session.children.map((childId) => {
        const child = allSessions[childId]
        return child ? (
          <SessionNode
            key={childId}
            session={child}
            depth={depth + 1}
            selectedId={selectedId}
            allSessions={allSessions}
            onSelect={onSelect}
          />
        ) : null
      })}
    </div>
  )
}

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
}

export function SessionSelector({ selectedId, onSelect }: Props) {
  const sessions = useCockpitStore((s) => s.sessions)
  const roots = Object.values(sessions).filter((s) => !s.parentId)

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors mb-1 ${
          selectedId === null ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-500 hover:bg-gray-50"
        }`}
      >
        <span className="text-gray-400">◈</span>
        All Sessions
      </button>
      <div className="w-full h-px bg-border mb-2" />
      {roots.length === 0 ? (
        <p className="text-xs text-gray-400 px-2">No sessions yet.</p>
      ) : (
        roots.map((s) => (
          <SessionNode
            key={s.id}
            session={s}
            depth={0}
            selectedId={selectedId}
            allSessions={sessions}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}
