import { useState, useEffect, useCallback } from 'react'
import type { OcSession } from './types/opencode'
import { getSessions, getTodos, getMessages, sendMessage, subscribeGlobalEvents } from './services/opencodeApi'
import type { OcMessage, OcTodo } from './types/opencode'
import Sidebar from './components/Sidebar'
import MessagePanel from './components/MessagePanel'

function App() {
  const [sessions, setSessions] = useState<OcSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [messages, setMessages] = useState<OcMessage[]>([])
  const [todos, setTodos] = useState<OcTodo[]>([])
  const [loading, setLoading] = useState(false)
  const [apiConnected, setApiConnected] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Load sessions on mount
  useEffect(() => {
    getSessions()
      .then((data) => {
        setSessions(data)
        setApiConnected(true)
        const sorted = [...data].sort((a, b) => b.time.updated - a.time.updated)
        if (sorted.length > 0) {
          setSelectedSessionId(sorted[0].id)
        }
      })
      .catch(() => setApiConnected(false))
  }, [])

  // Subscribe to global SSE events
  useEffect(() => {
    const unsubscribe = subscribeGlobalEvents((event) => {
      const payload = event?.payload || event
      const eventType = payload?.type
      if (!eventType) return

      if (eventType.startsWith('message') || eventType.startsWith('session')) {
        getMessages(selectedSessionId)
          .then(setMessages)
          .catch(err => console.warn('[SSE] Failed to refresh messages:', err))
      }

      if (eventType.startsWith('todo')) {
        getTodos(selectedSessionId)
          .then(setTodos)
          .catch(err => console.warn('[SSE] Failed to refresh todos:', err))
      }
    })

    return unsubscribe
  }, [selectedSessionId])

  // Load messages + todos when session changes
  const loadSessionData = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    setLoading(true)
    try {
      const [msgs, td] = await Promise.all([
        getMessages(sessionId),
        getTodos(sessionId),
      ])
      setMessages(msgs)
      setTodos(td)
    } catch (err) {
      console.error('Failed to load session data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessionData(selectedSessionId)
  }, [selectedSessionId, loadSessionData])

  const handleSendMessage = useCallback(async (text: string) => {
    if (!selectedSessionId) return
    await sendMessage(selectedSessionId, text)
    const msgs = await getMessages(selectedSessionId)
    setMessages(msgs)
  }, [selectedSessionId])

  const selectedSession = sessions.find(s => s.id === selectedSessionId)

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#F8F8F8',
      }}
    >
      {/* Left Sidebar (240px) */}
      <Sidebar
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        apiConnected={apiConnected}
      />

      {/* Center MessagePanel (flex: 1) */}
      <MessagePanel
        messages={messages}
        todos={todos}
        loading={loading}
        sessionId={selectedSessionId}
        sessionTitle={selectedSession?.title}
        onRefresh={() => loadSessionData(selectedSessionId)}
        onSendMessage={handleSendMessage}
      />

      {/* Right Panel (400px) */}
      <div
        style={{
          width: 400,
          flexShrink: 0,
          background: '#FFFFFF',
          borderLeft: '1px solid #E8E8E8',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Right Panel Header */}
        <div
          style={{
            height: 48,
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #E8E8E8',
            fontSize: 14,
            fontWeight: 500,
            color: '#171717',
          }}
        >
          右侧面板
        </div>
        <div
          style={{
            flex: 1,
            padding: '24px',
            color: '#8F8F8F',
            fontSize: 14,
          }}
        >
          待开发（D3 event flow）
        </div>
      </div>
    </div>
  )
}

export default App
