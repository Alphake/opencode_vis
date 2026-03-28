import { useState } from 'react'
import type { OcSession } from '../types/opencode'

interface SidebarProps {
  sessions: OcSession[]
  selectedSessionId: string
  onSelectSession: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  apiConnected: boolean
}

export default function Sidebar({
  sessions,
  selectedSessionId,
  onSelectSession,
  collapsed,
  onToggle,
  apiConnected,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSessions = sessions.filter(s =>
    s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.directory?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Group by directory
  const grouped = filteredSessions.reduce((acc, session) => {
    const dir = session.directory || 'Unknown'
    if (!acc[dir]) acc[dir] = []
    acc[dir].push(session)
    return acc
  }, {} as Record<string, OcSession[]>)

  if (collapsed) {
    return (
      <div
        style={{
          width: 48,
          height: '100%',
          background: '#FFFFFF',
          borderRight: '1px solid #E8E8E8',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onToggle}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
          title="展开侧边栏"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#171717" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        width: 240,
        height: '100%',
        background: '#FFFFFF',
        borderRight: '1px solid #E8E8E8',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Sidebar Header */}
      <div
        style={{
          height: 48,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #E8E8E8',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#171717' }}>Sessions</span>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: apiConnected ? '#0ABE00' : '#FF3B30',
            }}
            title={apiConnected ? 'Connected' : 'Disconnected'}
          />
        </div>
        <button
          onClick={onToggle}
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
          title="折叠侧边栏"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8F8F8F" strokeWidth="2">
            <path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 12px' }}>
        <input
          type="text"
          placeholder="搜索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            height: 32,
            padding: '0 10px',
            background: '#F8F8F8',
            border: '1px solid #E8E8E8',
            borderRadius: 6,
            fontSize: 13,
            outline: 'none',
          }}
        />
      </div>

      {/* Session List */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 0',
        }}
      >
        {Object.entries(grouped).map(([directory, sessions]) => (
          <div key={directory}>
            <div
              style={{
                padding: '6px 12px',
                fontSize: 11,
                color: '#8F8F8F',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {directory.split(/[\\/]/).pop()}
            </div>
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: session.id === selectedSessionId ? '#F0E6FA' : 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: session.id === selectedSessionId ? '#8445BC' : '#C7C7C7',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    color: '#171717',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {session.title || 'Untitled'}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
