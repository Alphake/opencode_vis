import type { OcSession } from '../types/opencode'

interface HeaderProps {
  sessions: OcSession[]
  selectedSessionId: string
  onSelectSession: (id: string) => void
  apiConnected: boolean
}

export default function Header({ sessions, selectedSessionId, onSelectSession, apiConnected }: HeaderProps) {
  const selected = sessions.find(s => s.id === selectedSessionId)

  return (
    <header className="flex items-center gap-4 px-4 py-2.5 border-b border-border bg-bg-secondary shrink-0">
      {/* Logo / Title */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent-dim border border-accent-border flex items-center justify-center">
          <span className="text-sm">🛩️</span>
        </div>
        <h1 className="text-base font-semibold text-text-primary tracking-tight">
          Agent Cockpit
        </h1>
      </div>

      {/* Session Selector */}
      <div className="flex-1 max-w-xl">
        <select
          value={selectedSessionId}
          onChange={(e) => onSelectSession(e.target.value)}
          className="w-full px-3 py-1.5 rounded-lg bg-bg-tertiary border border-border text-text-primary text-sm
                     focus:outline-none focus:border-accent-border appearance-none cursor-pointer
                     hover:bg-bg-hover transition-colors"
        >
          <option value="">-- 选择 Session --</option>
          {sessions
            .sort((a, b) => b.time.updated - a.time.updated)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title || s.slug}
              </option>
            ))}
        </select>
      </div>

      {/* Status Indicators */}
      <div className="flex items-center gap-3 shrink-0 text-xs text-text-secondary">
        {/* API Status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${apiConnected ? 'bg-status-completed' : 'bg-status-pending'}`} />
          <span>API</span>
        </div>

        {/* Session Info */}
        {selected && (
          <>
            <div className="h-3 w-px bg-border" />
            <span className="mono text-text-muted">
              {selected.messages !== undefined ? `${selected.messages} msgs` : ''}
            </span>
            <div className="h-3 w-px bg-border" />
            <span className="text-text-muted truncate max-w-[200px]" title={selected.directory}>
              {selected.directory.split('\\').pop()}
            </span>
          </>
        )}

        {/* Messages count */}
        {selectedSessionId && (
          <>
            <div className="h-3 w-px bg-border" />
            <span className="text-text-muted">
              {selected?.slug}
            </span>
          </>
        )}
      </div>
    </header>
  )
}
