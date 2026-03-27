import { useState, useEffect, useCallback } from 'react'
import type { OcSession } from './types/opencode'
import { getSessions, getTodos, getMessages } from './services/opencodeApi'
import type { OcMessage, OcTodo } from './types/opencode'
import Header from './components/Header'
import MessagePanel from './components/MessagePanel'
import TodoPanel from './components/TodoPanel'

function App() {
  const [sessions, setSessions] = useState<OcSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [messages, setMessages] = useState<OcMessage[]>([])
  const [todos, setTodos] = useState<OcTodo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [apiConnected, setApiConnected] = useState(false)

  // Load sessions on mount
  useEffect(() => {
    getSessions()
      .then((data) => {
        setSessions(data)
        setApiConnected(true)
        // Auto-select the most recently updated session with messages
        const sorted = [...data].sort((a, b) => b.time.updated - a.time.updated)
        if (sorted.length > 0) {
          setSelectedSessionId(sorted[0].id)
        }
      })
      .catch((err) => {
        setError(`无法连接 opencode API (${BASE})：${err.message}`)
        setApiConnected(false)
      })
  }, [])

  // Load messages + todos when session changes
  const loadSessionData = useCallback(async (sessionId: string) => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const [msgs, td] = await Promise.all([
        getMessages(sessionId),
        getTodos(sessionId),
      ])
      setMessages(msgs)
      setTodos(td)
    } catch (err: any) {
      setError(`加载 session 数据失败：${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessionData(selectedSessionId)
  }, [selectedSessionId, loadSessionData])

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <Header
        sessions={sessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        apiConnected={apiConnected}
      />

      {error && (
        <div className="mx-4 mt-2 px-4 py-2 rounded-lg bg-red-900/30 border border-red-800/50 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Messages */}
        <div className="flex-1 min-w-0 border-r border-border">
          <MessagePanel
            messages={messages}
            loading={loading}
            sessionId={selectedSessionId}
            onRefresh={() => loadSessionData(selectedSessionId)}
          />
        </div>

        {/* Right: Todos + Visualization */}
        <div className="w-[420px] min-w-[320px] max-w-[50vw]">
          <TodoPanel todos={todos} messages={messages} loading={loading} />
        </div>
      </div>
    </div>
  )
}

const BASE = 'http://127.0.0.1:4096'

export default App
