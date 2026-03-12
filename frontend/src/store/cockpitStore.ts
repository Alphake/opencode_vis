import { create } from "zustand"
import type { Session, Message, ToolStats, ToolCallRecord, TodoItem, SkillRecord, Metrics, Snapshot } from "../types"
import { api } from "../services/api"

// Debounced tool-stats refresh: coalesces rapid tool events into one fetch
let _statsTimer: ReturnType<typeof setTimeout> | null = null
function scheduleStatsRefresh(setFn: (stats: ToolStats[]) => void) {
  if (_statsTimer) return
  _statsTimer = setTimeout(() => {
    _statsTimer = null
    api.tools.stats().then(setFn).catch(() => {})
  }, 600)
}

interface CockpitState {
  connected: boolean
  sessions: Record<string, Session>
  messages: Record<string, Message[]>     // sessionId → messages
  toolStats: ToolStats[]
  toolCalls: ToolCallRecord[]
  todos: Record<string, TodoItem[]>        // sessionId → todos
  skills: SkillRecord[]
  metrics: Metrics

  // Actions
  setConnected: (v: boolean) => void
  loadSnapshot: (snap: Snapshot) => void
  upsertSession: (s: Session) => void
  updateSessionStatus: (id: string, status: Session["status"]) => void
  addMessage: (msg: Message) => void
  upsertToolCall: (call: ToolCallRecord) => void
  mergeToolCalls: (calls: ToolCallRecord[]) => void
  finishToolCall: (callId: string, status: ToolCallRecord["status"], durationMs?: number) => void
  setTodos: (sessionId: string, todos: TodoItem[]) => void
  addSkill: (skill: SkillRecord) => void
  setMetrics: (m: Metrics) => void
  handleAgentEvent: (type: string, data: unknown) => void
}

const defaultMetrics: Metrics = {
  totalSessions: 0,
  activeSessions: 0,
  totalMessages: 0,
  totalToolCalls: 0,
  totalTokens: { input: 0, output: 0 },
  totalCost: 0,
}

export const useCockpitStore = create<CockpitState>((set, get) => ({
  connected: false,
  sessions: {},
  messages: {},
  toolStats: [],
  toolCalls: [],
  todos: {},
  skills: [],
  metrics: defaultMetrics,

  setConnected: (v) => set({ connected: v }),

  loadSnapshot: (snap) => {
    const sessions: Record<string, Session> = {}
    for (const s of snap.sessions) sessions[s.id] = s
    const todos: Record<string, TodoItem[]> = {}
    for (const [sid, items] of Object.entries(snap.todos ?? {})) todos[sid] = items
    set({
      sessions,
      toolStats: snap.toolStats ?? [],
      todos,
      skills: snap.skills ?? [],
      metrics: snap.metrics ?? defaultMetrics,
    })
  },

  upsertSession: (s) =>
    set((state) => ({
      sessions: { ...state.sessions, [s.id]: { ...(state.sessions[s.id] ?? {}), ...s } },
    })),

  updateSessionStatus: (id, status) =>
    set((state) => {
      const s = state.sessions[id]
      if (!s) return {}
      return { sessions: { ...state.sessions, [id]: { ...s, status } } }
    }),

  addMessage: (msg) =>
    set((state) => {
      const prev = state.messages[msg.sessionId] ?? []
      const exists = prev.findIndex((m) => m.id === msg.id)
      const next = exists >= 0
        ? prev.map((m, i) => (i === exists ? { ...m, ...msg } : m))
        : [...prev, msg]
      return { messages: { ...state.messages, [msg.sessionId]: next } }
    }),

  upsertToolCall: (call) =>
    set((state) => {
      const exists = state.toolCalls.findIndex((c) => c.callId === call.callId)
      const next = exists >= 0
        ? state.toolCalls.map((c, i) => (i === exists ? call : c))
        : [...state.toolCalls, call]
      return { toolCalls: next }
    }),

  mergeToolCalls: (calls) =>
    set((state) => {
      const map = new Map<string, ToolCallRecord>()
      // Historical calls first, then live calls override (live is more up-to-date)
      for (const c of calls) map.set(c.callId, c)
      for (const c of state.toolCalls) map.set(c.callId, c)
      return { toolCalls: [...map.values()] }
    }),

  finishToolCall: (callId, status, durationMs) =>
    set((state) => ({
      toolCalls: state.toolCalls.map((c) =>
        c.callId === callId ? { ...c, status, durationMs: durationMs ?? c.durationMs } : c
      ),
    })),

  setTodos: (sessionId, todos) =>
    set((state) => ({ todos: { ...state.todos, [sessionId]: todos } })),

  addSkill: (skill) =>
    set((state) => ({ skills: [...state.skills, skill] })),

  setMetrics: (m) => set({ metrics: m }),

  handleAgentEvent: (type, data) => {
    const d = data as Record<string, unknown>
    const state = get()
    switch (type) {
      case "session.created":
      case "session.updated":
      case "session.deleted":
        if (d.session) state.upsertSession(d.session as Session)
        break
      case "session.status":
      case "session.idle":
      case "session.error": {
        const sid = d.sessionId as string
        const st = d.status as Session["status"] ?? (type === "session.idle" ? "idle" : type === "session.error" ? "error" : "busy")
        state.updateSessionStatus(sid, st)
        if (d.session) state.upsertSession(d.session as Session)
        break
      }
      case "message.updated":
        // Full message updates come via REST on demand
        break
      case "todo.updated":
        state.setTodos(d.sessionId as string, d.todos as TodoItem[])
        break
      case "tool.execute.before":
        // Add the tool call immediately so Recent Calls shows it as "running"
        state.upsertToolCall({
          callId: d.callId as string,
          sessionId: d.sessionId as string,
          tool: d.tool as string,
          args: {},
          status: "running",
          startedAt: Date.now(),
        } as ToolCallRecord)
        break
      case "tool.execute.after":
        state.finishToolCall(d.callId as string, d.status as ToolCallRecord["status"], d.durationMs as number | undefined)
        // Refresh aggregated stats from server (debounced 600ms)
        scheduleStatsRefresh((stats) => set({ toolStats: stats }))
        break
    }
  },
}))
