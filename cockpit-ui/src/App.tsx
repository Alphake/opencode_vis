import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { OcSession } from './types/opencode'
import {
  getSessions,
  getTodos,
  getMessages,
  sendMessage,
  createSession,
  updateSessionTitle,
  subscribeGlobalEvents,
  subscribeWorkspaceEvents,
} from './services/opencodeApi'
import { normalizeSessionDirectory, uniqueDirectoriesFromSessions } from './utils/sessionFolders'
import type { OcMessage, OcTodo } from './types/opencode'
import type { MessageSendPayload } from './components/MessageInput'
import Sidebar from './components/Sidebar'
import MessagePanel from './components/MessagePanel'
import SubtaskDebugPanel from './components/SubtaskDebugPanel'
import SubtaskMessageConnector from './components/SubtaskMessageConnector'
import { groupAssistantSubtasks, isTodoWriteMessage } from './utils/subtaskGrouping'
import { buildMappedActionsFromMessages } from './utils/actionMapping'
import { buildMessageHighlightSet, findSubtaskIndexForTodo } from './utils/subtaskLinkage'
import { buildUserMessageWithGuidance } from './config/harnessGuidance'

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
  const [linkedSubtaskIndex, setLinkedSubtaskIndex] = useState<number | null>(null)
  const [selectedDirectory, setSelectedDirectory] = useState<string>('')
  const [creatingSession, setCreatingSession] = useState(false)

  const directories = useMemo(() => {
    const u = uniqueDirectoriesFromSessions(sessions)
    return u.length > 0 ? u : ['']
  }, [sessions])

  const sessionsInFolder = useMemo(() => {
    return sessions
      .filter(s => normalizeSessionDirectory(s.directory) === selectedDirectory)
      .sort((a, b) => b.time.updated - a.time.updated)
  }, [sessions, selectedDirectory])

  const linkAreaRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const subtaskScrollRef = useRef<HTMLDivElement>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const activeSessionDirectory = useMemo(
    () => sessions.find(s => s.id === selectedSessionId)?.directory,
    [sessions, selectedSessionId],
  )

  // Load sessions on mount
  useEffect(() => {
    getSessions()
      .then((data) => {
        setSessions(data)
        setApiConnected(true)
        const sorted = [...data].sort((a, b) => b.time.updated - a.time.updated)
        if (sorted.length > 0) {
          const first = sorted[0]!
          setSelectedSessionId(first.id)
          setSelectedDirectory(normalizeSessionDirectory(first.directory))
        }
      })
      .catch(() => setApiConnected(false))
  }, [])

  /** 当前选中的 session 已从列表消失时，回退到同文件夹或全局最新；文件夹内无会话且未选中时保持空白 */
  useEffect(() => {
    if (sessions.length === 0) return
    if (selectedSessionId && sessions.some(s => s.id === selectedSessionId)) return

    const inFolder = sessions
      .filter(s => normalizeSessionDirectory(s.directory) === selectedDirectory)
      .sort((a, b) => b.time.updated - a.time.updated)

    if (inFolder.length > 0) {
      setSelectedSessionId(inFolder[0]!.id)
      return
    }
    if (!selectedSessionId) return

    const sorted = [...sessions].sort((a, b) => b.time.updated - a.time.updated)
    const pick = sorted[0]!
    setSelectedSessionId(pick.id)
    setSelectedDirectory(normalizeSessionDirectory(pick.directory))
  }, [sessions, selectedSessionId, selectedDirectory])

  // Subscribe to global SSE events
  useEffect(() => {
    const unsubscribe = subscribeGlobalEvents((event) => {
      const payload = event?.payload || event
      const eventType = payload?.type
      if (!eventType) return

      if (eventType.startsWith('message') || eventType.startsWith('session')) {
        console.log('[OpenCode · App] SSE 事件触发刷新消息列表', eventType)
        getSessions()
          .then(setSessions)
          .catch(err => console.warn('[SSE] Failed to refresh sessions:', err))
        const dir = sessionsRef.current.find(s => s.id === selectedSessionId)?.directory
        if (selectedSessionId) {
          getMessages(selectedSessionId, `SSE:${eventType}`, dir)
            .then(setMessages)
            .catch(err => console.warn('[SSE] Failed to refresh messages:', err))
        }
      }

      if (eventType.startsWith('todo')) {
        const dir = sessionsRef.current.find(s => s.id === selectedSessionId)?.directory
        if (selectedSessionId) {
          getTodos(selectedSessionId, dir)
            .then(setTodos)
            .catch(err => console.warn('[SSE] Failed to refresh todos:', err))
        }
      }
    })

    return unsubscribe
  }, [selectedSessionId])

  // 并行监听当前 workspace 的 GET /event（仅控制台有输出；handler 空避免与 global 重复刷新 UI）
  useEffect(() => {
    return subscribeWorkspaceEvents(() => {})
  }, [])

  // Load messages + todos when session changes
  const loadSessionData = useCallback(async (sessionId: string, directory?: string) => {
    if (!sessionId) return
    setLoading(true)
    try {
      const [msgs, td] = await Promise.all([
        getMessages(sessionId, '进入会话/切换 session 首次加载', directory),
        getTodos(sessionId, directory),
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
    void loadSessionData(selectedSessionId, activeSessionDirectory)
  }, [selectedSessionId, activeSessionDirectory, loadSessionData])

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

  const highlightMessageIndices = useMemo(() => {
    if (linkedSubtaskIndex === null) return null
    const st = assistantSubtasks[linkedSubtaskIndex]
    if (!st) return null
    return buildMessageHighlightSet(st, messages)
  }, [linkedSubtaskIndex, assistantSubtasks, messages])

  const toggleSubtaskLink = useCallback((si: number) => {
    setLinkedSubtaskIndex(prev => (prev === si ? null : si))
  }, [])

  const handleTodoClick = useCallback(
    (todo: OcTodo) => {
      const si = findSubtaskIndexForTodo(assistantSubtasks, todo)
      if (si === null) return
      setLinkedSubtaskIndex(si)
    },
    [assistantSubtasks]
  )

  useEffect(() => {
    setLinkedSubtaskIndex(null)
  }, [selectedSessionId])

  useEffect(() => {
    if (linkedSubtaskIndex !== null && linkedSubtaskIndex >= assistantSubtasks.length) {
      setLinkedSubtaskIndex(null)
    }
  }, [linkedSubtaskIndex, assistantSubtasks.length])

  useEffect(() => {
    if (highlightMessageIndices === null || highlightMessageIndices.size === 0) return
    const first = Math.min(...highlightMessageIndices)
    requestAnimationFrame(() => {
      messageScrollRef.current
        ?.querySelector(`[data-message-index="${first}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [linkedSubtaskIndex, highlightMessageIndices])

  useEffect(() => {
    if (linkedSubtaskIndex === null) return
    requestAnimationFrame(() => {
      subtaskScrollRef.current
        ?.querySelector(`[data-subtask-card-index="${linkedSubtaskIndex}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [linkedSubtaskIndex])

  const handleSessionTitleCommit = useCallback(
    async (title: string) => {
      if (!selectedSessionId) return
      const dir = sessions.find(s => s.id === selectedSessionId)?.directory
      await updateSessionTitle(selectedSessionId, title, dir)
      const list = await getSessions()
      setSessions(list)
    },
    [selectedSessionId, sessions],
  )

  const handleSendMessage = useCallback(async (payload: MessageSendPayload) => {
    if (!selectedSessionId) return
    const dir = sessions.find(s => s.id === selectedSessionId)?.directory
    // 引导语在 buildUserMessageWithGuidance（cockpit-ui/src/config/harnessGuidance.ts）中配置
    await sendMessage(selectedSessionId, buildUserMessageWithGuidance(payload.combinedText), dir, {
      imageParts: payload.imageParts,
    })
    const msgs = await getMessages(selectedSessionId, 'POST 发送完成后拉取完整列表', dir)
    setMessages(msgs)
  }, [selectedSessionId, sessions])

  const selectedSession = sessions.find(s => s.id === selectedSessionId)

  const handleSelectDirectory = useCallback(
    (dir: string) => {
      setSelectedDirectory(dir)
      const inFolder = sessions
        .filter(s => normalizeSessionDirectory(s.directory) === dir)
        .sort((a, b) => b.time.updated - a.time.updated)
      if (inFolder.length === 0) {
        setSelectedSessionId('')
      } else {
        setSelectedSessionId(inFolder[0]!.id)
      }
    },
    [sessions],
  )

  const handleCreateSession = useCallback(async () => {
    setCreatingSession(true)
    try {
      const dir = selectedDirectory || undefined
      const created = await createSession(dir)
      const list = await getSessions()
      setSessions(list)
      setApiConnected(true)
      setSelectedDirectory(normalizeSessionDirectory(created.directory))
      setSelectedSessionId(created.id)
    } catch (e) {
      console.error('Failed to create session:', e)
      setApiConnected(false)
    } finally {
      setCreatingSession(false)
    }
  }, [selectedDirectory])

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
      {/* 左侧：文件夹窄栏 + 会话列表 */}
      <Sidebar
        sessionsInFolder={sessionsInFolder}
        directories={directories}
        selectedDirectory={selectedDirectory}
        onSelectDirectory={handleSelectDirectory}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onCreateSession={handleCreateSession}
        creatingSession={creatingSession}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        apiConnected={apiConnected}
      />

      {/* 中栏 + 右栏：同一相对定位容器，便于子任务与消息连线 */}
      <div
        ref={linkAreaRef}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
        }}
      >
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
              onRefresh={() => loadSessionData(selectedSessionId, activeSessionDirectory)}
              onSendMessage={handleSendMessage}
              messageListScrollRef={messageScrollRef}
              highlightMessageIndices={highlightMessageIndices}
              onTodoClick={handleTodoClick}
              onSessionTitleCommit={handleSessionTitleCommit}
            />
          </div>
        </div>

        <div
          style={{
            width: 600,
            flexShrink: 0,
            background: '#FFFFFF',
            borderLeft: '1px solid #E8E8E8',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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
            <SubtaskDebugPanel
              messages={messages}
              assistantSubtasks={assistantSubtasks}
              linkedSubtaskIndex={linkedSubtaskIndex}
              onSelectSubtask={toggleSubtaskLink}
              listScrollRef={subtaskScrollRef}
            />
          </div>
        </div>

        <SubtaskMessageConnector
          containerRef={linkAreaRef}
          messageScrollRef={messageScrollRef}
          subtaskScrollRef={subtaskScrollRef}
          subtaskIndex={linkedSubtaskIndex}
          messageIndices={highlightMessageIndices}
        />
      </div>
    </div>
  )
}

export default App
