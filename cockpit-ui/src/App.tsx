import { useState, useEffect, useCallback, useMemo } from 'react'
import type { OcSession } from './types/opencode'
import { getSessions, getTodos, getMessages, sendMessage, subscribeGlobalEvents } from './services/opencodeApi'
import type { OcMessage, OcTodo } from './types/opencode'
import Sidebar from './components/Sidebar'
import MessagePanel from './components/MessagePanel'
import SubtaskDebugPanel from './components/SubtaskDebugPanel'
import { groupAssistantSubtasks, isTodoWriteMessage } from './utils/subtaskGrouping'
import { buildMappedActionsFromMessages } from './utils/actionMapping'

/** 每条「含 todo 写入」的 message 下标 → 当时同步到的 todos（用于重放 diff） */
type TodosSnapshotMap = Record<string, OcTodo[]>

function formatMessageForConsole(msg: OcMessage | undefined, index: number) {
  if (!msg) {
    return { index, missing: true as const }
  }
  const partsSummary = msg.parts.map(p => {
    switch (p.type) {
      case 'text':
        return { type: 'text' as const, textLen: (p.text || '').length }
      case 'reasoning':
        return { type: 'reasoning' as const, textLen: (p.text || '').length }
      case 'tool':
        return { type: 'tool' as const, tool: p.tool, status: p.state?.status }
      case 'text-file':
        return { type: 'text-file' as const, path: p.path }
      case 'image':
        return { type: 'image' as const }
      case 'step-start':
        return { type: 'step-start' as const }
      case 'step-finish':
        return { type: 'step-finish' as const, reason: p.reason }
      case 'compaction':
        return { type: 'compaction' as const }
      default:
        return { type: 'unknown' as const }
    }
  })
  return {
    index,
    id: msg.info.id,
    role: msg.info.role,
    userContent: msg.info.role === 'user' ? msg.info.content : undefined,
    partsCount: msg.parts.length,
    partsSummary,
    time: msg.info.time,
  }
}

function App() {
  const [sessions, setSessions] = useState<OcSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [messages, setMessages] = useState<OcMessage[]>([])
  const [todos, setTodos] = useState<OcTodo[]>([])
  const [todosSnapshotAtMessageIndex, setTodosSnapshotAtMessageIndex] = useState<TodosSnapshotMap>({})
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

  useEffect(() => {
    setTodosSnapshotAtMessageIndex({})
  }, [selectedSessionId])

  // 为「当前最后一条 todo-write message」保存 todos 快照，便于重算分组时做 completed diff（历史较早的写入若无快照则为空）
  useEffect(() => {
    if (!selectedSessionId || loading) return
    const writeIdxs: number[] = []
    messages.forEach((m, i) => {
      if (isTodoWriteMessage(m)) writeIdxs.push(i)
    })
    if (writeIdxs.length === 0) return
    const lastWrite = writeIdxs[writeIdxs.length - 1]!
    const key = String(lastWrite)
    setTodosSnapshotAtMessageIndex(prev => ({
      ...prev,
      [key]: todos.map(t => ({ ...t })),
    }))
  }, [messages, todos, selectedSessionId, loading])

  const assistantSubtasks = useMemo(() => {
    return groupAssistantSubtasks(messages, {
      todosAfterMessageIndex(i) {
        const snap = todosSnapshotAtMessageIndex[String(i)]
        return snap !== undefined ? snap : undefined
      },
      fallbackSessionTodos: todos,
    })
  }, [messages, todosSnapshotAtMessageIndex, todos])

  useEffect(() => {
    if (messages.length === 0) return
    const payload = assistantSubtasks.map((st, si) => {
      const segmentMsgs = st.assistantMessageIndices
        .map(i => messages[i])
        .filter((m): m is OcMessage => m != null)
      return {
        segmentIndex: si,
        subtask_id: st.subtask_id,
        todos: st.todos,
        todosNewlyCompleted: st.todosNewlyCompleted,
        assistantMessageIndices: st.assistantMessageIndices,
        messages: st.assistantMessageIndices.map(i => formatMessageForConsole(messages[i], i)),
        flowActions: buildMappedActionsFromMessages(segmentMsgs),
      }
    })
    console.log('[AssistantSubtasks]', payload)
  }, [assistantSubtasks, messages])

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

      {/* Center MessagePanel：限制最大宽度，相对变窄 */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 640,
            minHeight: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <MessagePanel
            messages={messages}
            todos={todos}
            loading={loading}
            sessionId={selectedSessionId}
            sessionTitle={selectedSession?.title}
            onRefresh={() => loadSessionData(selectedSessionId)}
            onSendMessage={handleSendMessage}
          />
        </div>
      </div>

      {/* Right Panel */}
      <div
        style={{
          width: 520,
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
            height: 44,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #E8E8E8',
            fontSize: 12,
            fontWeight: 500,
            color: '#171717',
          }}
        >
          子任务分组（调试）
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            padding: '12px 14px',
            gap: 12,
          }}
        >
          <SubtaskDebugPanel messages={messages} assistantSubtasks={assistantSubtasks} />
        </div>
      </div>
    </div>
  )
}

export default App
