import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { OcSession } from './types/opencode'
import {
  getSessions,
  getTodos,
  getMessages,
  sendMessage,
  abortSession,
  forkSession,
  createSession,
  updateSessionTitle,
  replyToQuestion,
  rejectQuestion,
  subscribeGlobalEvents,
  subscribeWorkspaceEvents,
} from './services/opencodeApi'
import { normalizeSessionDirectory, uniqueDirectoriesFromSessions } from './utils/sessionFolders'
import type { MappedAction, OcMessage, OcPendingQuestionRequest, OcTodo } from './types/opencode'
import type { MessageSendPayload } from './components/MessageInput'
import Sidebar from './components/Sidebar'
import MessagePanel from './components/MessagePanel'
import SubtaskDebugPanel from './components/SubtaskDebugPanel'
import ActionAnalysisModal from './components/ActionAnalysisModal'
import SubtaskMessageConnector from './components/SubtaskMessageConnector'
import { groupAssistantSubtasks, isTodoWriteMessage } from './utils/subtaskGrouping'
import { buildMappedActionsFromMessages } from './utils/actionMapping'
import {
  findSubtaskIndexForTodo,
  subtaskShouldUseTodoLink,
} from './utils/subtaskLinkage'
import {
  archivedCompletedList,
  buildSessionTodoModel,
  getLatestTodowriteBatchProgress,
} from './utils/todoRegistry'
import { buildUserMessageWithGuidance } from './config/harnessGuidance'

/** 每条「含 todo 写入」的 message 下标 → 当时同步到的 todos（用于重放 diff） */
type TodosSnapshotMap = Record<string, OcTodo[]>
const AUTO_ABORT_STUCK_RUNNING_AFTER_MS = 24 * 60 * 60 * 1000

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
  /** 递增以驱动 Todo 面板在选中子任务时自动展开到正确分区 */
  const [todoPanelRevealGeneration, setTodoPanelRevealGeneration] = useState(0)
  const [selectedDirectory, setSelectedDirectory] = useState<string>('')
  const [creatingSession, setCreatingSession] = useState(false)
  /** 按 sessionID 保存待作答的 question 请求（SSE `question.asked`） */
  const [pendingQuestions, setPendingQuestions] = useState<Record<string, OcPendingQuestionRequest>>({})
  const [questionSubmitting, setQuestionSubmitting] = useState(false)
  const [aborting, setAborting] = useState(false)
  const [analysisAction, setAnalysisAction] = useState<(MappedAction & { row: number }) | null>(null)

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
  const todoPanelScrollRef = useRef<HTMLDivElement>(null)
  const subtaskScrollRef = useRef<HTMLDivElement>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const selectedSessionIdRef = useRef(selectedSessionId)
  selectedSessionIdRef.current = selectedSessionId

  const pendingQuestionsRef = useRef(pendingQuestions)
  pendingQuestionsRef.current = pendingQuestions
  const autoAbortedRunningKeysRef = useRef<Set<string>>(new Set())

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

      if (eventType === 'question.asked') {
        const props = payload.properties as Partial<OcPendingQuestionRequest> | undefined
        if (props?.id && props.sessionID && Array.isArray(props.questions)) {
          const root = event as { directory?: string }
          const dir = typeof root.directory === 'string' ? root.directory : undefined
          setPendingQuestions((prev) => ({
            ...prev,
            [props.sessionID!]: {
              id: props.id!,
              sessionID: props.sessionID!,
              questions: props.questions as OcPendingQuestionRequest['questions'],
              tool: props.tool,
              directory: dir,
            },
          }))
        }
      }

      if (eventType === 'question.replied' || eventType === 'question.rejected') {
        const props = payload.properties as { sessionID?: string; requestID?: string } | undefined
        if (props?.sessionID && props?.requestID) {
          setPendingQuestions((prev) => {
            const cur = prev[props.sessionID!]
            if (cur?.id === props.requestID) {
              const { [props.sessionID!]: _, ...rest } = prev
              return rest
            }
            return prev
          })
        }
      }

      if (eventType.startsWith('question')) {
        const props = payload.properties as { sessionID?: string } | undefined
        const sid = props?.sessionID
        if (sid && sid === selectedSessionIdRef.current) {
          const dir = sessionsRef.current.find((s) => s.id === sid)?.directory
          getMessages(sid, `SSE:${eventType}`, dir)
            .then(setMessages)
            .catch((err) => console.warn('[SSE] Failed to refresh messages:', err))
        }
      }

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

  /** 对于超过 24h 且无后续 assistant 消息收口的 running/pending tool，自动 abort 会话（每条 call 只触发一次）。 */
  useEffect(() => {
    if (!selectedSessionId || aborting) return
    const now = Date.now()
    let stuckCallId: string | undefined
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (!msg || msg.info.role !== 'assistant') continue
      const hasLaterAssistant = messages.slice(i + 1).some((m) => m?.info.role === 'assistant')
      if (hasLaterAssistant) continue
      for (const p of msg.parts) {
        if (p.type !== 'tool') continue
        const st = p.state?.status
        if (st !== 'running' && st !== 'pending') continue
        const start = p.state?.time?.start ?? msg.info.time?.created
        if (typeof start !== 'number' || !Number.isFinite(start)) continue
        if (now - start < AUTO_ABORT_STUCK_RUNNING_AFTER_MS) continue
        stuckCallId = p.callID
        break
      }
      if (stuckCallId) break
    }
    if (!stuckCallId) return

    const runKey = `${selectedSessionId}:${stuckCallId}`
    if (autoAbortedRunningKeysRef.current.has(runKey)) return
    autoAbortedRunningKeysRef.current.add(runKey)

    const dir = sessionsRef.current.find((s) => s.id === selectedSessionId)?.directory
    setAborting(true)
    void (async () => {
      try {
        await abortSession(selectedSessionId, dir)
        const [list, msgs] = await Promise.all([
          getSessions(),
          getMessages(selectedSessionId, 'auto abort stuck running >24h', dir),
        ])
        setSessions(list)
        setMessages(msgs)
      } catch (err) {
        console.warn('[auto-abort stuck running] failed:', err)
        autoAbortedRunningKeysRef.current.delete(runKey)
      } finally {
        setAborting(false)
      }
    })()
  }, [messages, selectedSessionId, aborting])

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

  const sessionTodoModel = useMemo(
    () => buildSessionTodoModel(messages, todos, todosSnapshotAtMessageIndex),
    [messages, todos, todosSnapshotAtMessageIndex],
  )

  const archivedForPanel = useMemo(
    () => archivedCompletedList(sessionTodoModel.completedArchive),
    [sessionTodoModel.completedArchive],
  )

  const latestTodowriteBatchProgress = useMemo(
    () => getLatestTodowriteBatchProgress(sessionTodoModel, archivedForPanel),
    [sessionTodoModel, archivedForPanel],
  )

  const assistantSubtasks = useMemo(() => {
    const fb =
      sessionTodoModel.latestActive.length > 0 ? sessionTodoModel.latestActive : todos
    return groupAssistantSubtasks(messages, {
      canonicalTodosAtMessageIndex(i) {
        const c = sessionTodoModel.canonicalAtMessageIndex.get(i)
        return c !== undefined && c.length > 0 ? c : undefined
      },
      todosAfterMessageIndex(i) {
        const snap = todosSnapshotAtMessageIndex[String(i)]
        return snap !== undefined ? snap : undefined
      },
      fallbackSessionTodos: fb,
    })
  }, [messages, todosSnapshotAtMessageIndex, todos, sessionTodoModel])

  /**
   * 右栏子任务：与 `groupAssistantSubtasks` 结果一一对应并全部展示（含尚无 todowrite 的前期调研段）。
   */
  const visibleSubtasks = useMemo(
    () => assistantSubtasks.map((subtask, sourceIndex) => ({ subtask, sourceIndex })),
    [assistantSubtasks],
  )

  /** execution 子任务：用 todo id 高亮 */
  const linkedTodoIds = useMemo(() => {
    if (linkedSubtaskIndex === null) return null
    const st = assistantSubtasks[linkedSubtaskIndex]
    if (!st || !subtaskShouldUseTodoLink(st)) return null
    return new Set(st.linkedTodoIds)
  }, [linkedSubtaskIndex, assistantSubtasks])

  useEffect(() => {
    if (messages.length === 0) return
    const payload = assistantSubtasks.map((st, si) => {
      const segmentMsgs = st.assistantMessageIndices
        .map(i => messages[i])
        .filter((m): m is OcMessage => m != null)
      return {
        segmentIndex: si,
        phase: st.phase,
        subtask_id: st.subtask_id,
        todos: st.todos,
        todosNewlyCompleted: st.todosNewlyCompleted,
        linkedTodoIds: st.linkedTodoIds,
        assistantMessageIndices: st.assistantMessageIndices,
        messages: st.assistantMessageIndices.map(i => formatMessageForConsole(messages[i], i)),
        flowActions: buildMappedActionsFromMessages(segmentMsgs),
      }
    })
    console.log('[AssistantSubtasks]', payload)
  }, [assistantSubtasks, messages])

  const toggleSubtaskLink = useCallback((si: number) => {
    setLinkedSubtaskIndex(prev => (prev === si ? null : si))
  }, [])

  const handleTodoClick = useCallback(
    (todo: OcTodo) => {
      const preferred = findSubtaskIndexForTodo(assistantSubtasks, todo)
      if (
        preferred !== null &&
        subtaskShouldUseTodoLink(assistantSubtasks[preferred]!)
      ) {
        setLinkedSubtaskIndex(preferred)
        return
      }
      const id = todo.id?.trim()
      if (!id) return
      const fallback = visibleSubtasks.find(({ subtask }) =>
        subtask.linkedTodoIds.includes(id)
      )
      if (fallback) setLinkedSubtaskIndex(fallback.sourceIndex)
    },
    [assistantSubtasks, visibleSubtasks]
  )

  useEffect(() => {
    setLinkedSubtaskIndex(null)
    setTodoPanelRevealGeneration(0)
  }, [selectedSessionId])

  useEffect(() => {
    if (linkedSubtaskIndex !== null) {
      setTodoPanelRevealGeneration(g => g + 1)
    }
  }, [linkedSubtaskIndex])

  useEffect(() => {
    if (linkedSubtaskIndex !== null && linkedSubtaskIndex >= assistantSubtasks.length) {
      setLinkedSubtaskIndex(null)
    }
  }, [linkedSubtaskIndex, assistantSubtasks.length])

  useEffect(() => {
    if (linkedTodoIds && linkedTodoIds.size > 0) {
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          const scroll = todoPanelScrollRef.current
          if (!scroll) return
          for (const el of scroll.querySelectorAll('[data-todo-link-id]')) {
            const k = el.getAttribute('data-todo-link-id')?.trim() ?? ''
            if (k && linkedTodoIds.has(k)) {
              el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              break
            }
          }
        })
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
  }, [linkedSubtaskIndex, linkedTodoIds, todoPanelRevealGeneration])

  useEffect(() => {
    if (linkedSubtaskIndex === null) return
    const st = assistantSubtasks[linkedSubtaskIndex]
    if (!st || st.assistantMessageIndices.length === 0) return
    const first = Math.min(...st.assistantMessageIndices)
    requestAnimationFrame(() => {
      messageScrollRef.current
        ?.querySelector(`[data-message-index="${first}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [linkedSubtaskIndex, assistantSubtasks])

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

  const handleQuestionReply = useCallback(async (answers: string[][]) => {
    const pq = pendingQuestionsRef.current[selectedSessionId]
    if (!pq) return
    setQuestionSubmitting(true)
    try {
      await replyToQuestion(pq.id, answers, pq.directory)
      setPendingQuestions((prev) => {
        const { [pq.sessionID]: _, ...rest } = prev
        return rest
      })
      const dir = sessionsRef.current.find((s) => s.id === selectedSessionId)?.directory
      const msgs = await getMessages(selectedSessionId, 'question 回复后', dir)
      setMessages(msgs)
    } catch (e) {
      console.error('[question reply]', e)
      window.alert(
        '提交答案失败。请确认 OpenCode 已支持 POST /question/{requestID}/reply（OpenCode SDK v2 与 opencode serve 新版本提供该路由）。',
      )
    } finally {
      setQuestionSubmitting(false)
    }
  }, [selectedSessionId])

  const handleQuestionReject = useCallback(async () => {
    const pq = pendingQuestionsRef.current[selectedSessionId]
    if (!pq) return
    setQuestionSubmitting(true)
    try {
      await rejectQuestion(pq.id, pq.directory)
      setPendingQuestions((prev) => {
        const { [pq.sessionID]: _, ...rest } = prev
        return rest
      })
      const dir = sessionsRef.current.find((s) => s.id === selectedSessionId)?.directory
      const msgs = await getMessages(selectedSessionId, 'question 拒绝后', dir)
      setMessages(msgs)
    } catch (e) {
      console.error('[question reject]', e)
      window.alert('操作失败。')
    } finally {
      setQuestionSubmitting(false)
    }
  }, [selectedSessionId])

  /** 消息气泡内联 question 提交/跳过后，与底部面板一致：刷新消息并清掉同会话的 SSE pending */
  const handleQuestionAnswered = useCallback(async () => {
    if (!selectedSessionId) return
    const dir = sessionsRef.current.find((s) => s.id === selectedSessionId)?.directory
    try {
      const msgs = await getMessages(selectedSessionId, '内联 question 提交后', dir)
      setMessages(msgs)
    } catch (e) {
      console.error('[handleQuestionAnswered]', e)
    }
    setPendingQuestions((prev) => {
      const next = { ...prev }
      delete next[selectedSessionId]
      return next
    })
  }, [selectedSessionId])

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

  const handleAbortMessage = useCallback(async () => {
    if (!selectedSessionId) return
    const dir = sessions.find(s => s.id === selectedSessionId)?.directory
    setAborting(true)
    try {
      await abortSession(selectedSessionId, dir)
      const [list, msgs] = await Promise.all([
        getSessions(),
        getMessages(selectedSessionId, 'abort 后刷新', dir),
      ])
      setSessions(list)
      setMessages(msgs)
    } finally {
      setAborting(false)
    }
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

  const handleForkFromAction = useCallback(async (action: MappedAction & { row: number }) => {
    const targetSessionId = action.sessionID || selectedSessionId
    if (!targetSessionId || !action.messageID) return
    const dir = sessions.find((s) => s.id === targetSessionId)?.directory ?? activeSessionDirectory

    setCreatingSession(true)
    try {
      const forked = await forkSession(targetSessionId, {
        messageID: action.messageID,
        directory: dir,
      })
      const list = await getSessions()
      setSessions(list)
      setApiConnected(true)
      setSelectedDirectory(normalizeSessionDirectory(forked.directory))
      setSelectedSessionId(forked.id)
      const [msgs, td] = await Promise.all([
        getMessages(forked.id, 'fork 后加载会话', forked.directory),
        getTodos(forked.id, forked.directory),
      ])
      setMessages(msgs)
      setTodos(td)
    } catch (e) {
      console.error('Failed to fork session from action:', e)
    } finally {
      setCreatingSession(false)
    }
  }, [sessions, selectedSessionId, activeSessionDirectory])

  const handleAnalyzeFromAction = useCallback((action: MappedAction & { row: number }) => {
    setAnalysisAction(action)
  }, [])

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
              latestTodos={sessionTodoModel.latestActive}
              archivedTodos={archivedForPanel}
              latestTodowriteBatchProgress={latestTodowriteBatchProgress}
              loading={loading}
              sessionId={selectedSessionId}
              sessionTitle={selectedSession?.title}
              onRefresh={() => loadSessionData(selectedSessionId, activeSessionDirectory)}
              onSendMessage={handleSendMessage}
              onAbortMessage={handleAbortMessage}
              aborting={aborting}
              messageListScrollRef={messageScrollRef}
              todoPanelScrollRef={todoPanelScrollRef}
              highlightMessageIndices={null}
              highlightTodoIds={linkedTodoIds}
              todoPanelRevealGeneration={todoPanelRevealGeneration}
              onTodoClick={handleTodoClick}
              onSessionTitleCommit={handleSessionTitleCommit}
              pendingQuestion={
                selectedSessionId ? pendingQuestions[selectedSessionId] ?? null : null
              }
              onQuestionReply={handleQuestionReply}
              onQuestionReject={handleQuestionReject}
              questionSubmitting={questionSubmitting}
              sessionDirectory={activeSessionDirectory}
              onQuestionAnswered={handleQuestionAnswered}
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
              visibleSubtasks={visibleSubtasks}
              linkedSubtaskIndex={linkedSubtaskIndex}
              onSelectSubtask={toggleSubtaskLink}
              onForkFromAction={handleForkFromAction}
              onAnalyzeFromAction={handleAnalyzeFromAction}
              listScrollRef={subtaskScrollRef}
              sessionDirectory={activeSessionDirectory}
            />
          </div>
        </div>

        <SubtaskMessageConnector
          containerRef={linkAreaRef}
          todoPanelScrollRef={todoPanelScrollRef}
          subtaskScrollRef={subtaskScrollRef}
          subtaskIndex={linkedSubtaskIndex}
          linkedTodoIds={linkedTodoIds}
        />
        {analysisAction ? (
          <ActionAnalysisModal action={analysisAction} onClose={() => setAnalysisAction(null)} />
        ) : null}
      </div>
    </div>
  )
}

export default App
