import axios from "axios"
import type {
  Session,
  Message,
  ToolStats,
  ToolCallRecord,
  TodoItem,
  SkillRecord,
  Metrics,
  PartProjectionResponse,
  OverviewProjectionResponse,
  OverviewIncrementalResponse,
} from "../types"

const http = axios.create({ baseURL: "/api" })

export const api = {
  overview: {
    projectionInit: (
      directory: string,
      params?: {
        withEmbedding?: boolean
        withPosition?: boolean
        embeddingMode?: "dashscope" | "hf" | "mock"
        embeddingModel?: string
        reductionAlgo?: "mds" | "tsne"
        messageRadius?: number
        clearCache?: boolean
      },
      timeoutMs?: number,
    ) =>
      http
        .get<OverviewProjectionResponse>("/overview/projection/init", {
          params: { directory, ...(params ?? {}) },
          timeout: timeoutMs,
        })
        .then((r) => r.data),
    projectionIncremental: (
      directory: string,
      params?: {
        embeddingMode?: "dashscope" | "hf" | "mock"
        embeddingModel?: string
        messageRadius?: number
      },
      timeoutMs?: number,
    ) =>
      http
        .get<OverviewIncrementalResponse>("/overview/projection/incremental", {
          params: { directory, ...(params ?? {}) },
          timeout: timeoutMs,
        })
        .then((r) => r.data),
  },
  sessions: {
    list: () => http.get<Session[]>("/sessions").then((r) => r.data),
    get: (id: string) => http.get<Session>(`/sessions/${id}`).then((r) => r.data),
    messages: async (id: string) => {
      const url = `/sessions/${id}/messages`
      console.log("[Harness Backend · HTTP] GET 消息列表", url, "（本仓库 Flask 后端，非 OpenCode 直连）")
      const r = await http.get<Message[]>(url)
      console.log("[Harness Backend · HTTP] GET 响应", r.data?.length, "条")
      return r.data
    },
    sendMessage: async (id: string, content: string) => {
      const url = `/sessions/${id}/user-message`
      console.log("[Harness Backend · HTTP] POST 发送用户消息", url, {
        contentLen: content.length,
        预览: content.slice(0, 120),
      })
      const r = await http.post(url, { content })
      console.log("[Harness Backend · HTTP] POST 响应 data:", r.data)
      return r.data
    },
    partsProjection: (
      id: string,
      params?: {
        keywordMode?: "off" | "basic"
        withEmbedding?: boolean
        withPosition?: boolean
        embeddingMode?: "dashscope" | "hf" | "mock"
        embeddingModel?: string
      },
      timeoutMs?: number,
    ) =>
      http
        .get<PartProjectionResponse>(`/sessions/${id}/projection/parts`, {
          params,
          timeout: timeoutMs,
        })
        .then((r) => r.data),
  },
  agents: {
    hierarchy: () => http.get<Session[]>("/agents/hierarchy").then((r) => r.data),
    status: () => http.get("/agents/status").then((r) => r.data),
  },
  tools: {
    stats: () => http.get<ToolStats[]>("/tools/stats").then((r) => r.data),
    calls: (sessionId?: string) =>
      http.get<ToolCallRecord[]>("/tools/calls", { params: sessionId ? { sessionId } : {} }).then((r) => r.data),
  },
  todos: {
    all: () => http.get<Record<string, TodoItem[]>>("/todos").then((r) => r.data),
    session: (id: string) => http.get<TodoItem[]>(`/todos/${id}`).then((r) => r.data),
  },
  skills: {
    list: (sessionId?: string) =>
      http.get<SkillRecord[]>("/skills", { params: sessionId ? { sessionId } : {} }).then((r) => r.data),
  },
  metrics: {
    get: () => http.get<Metrics>("/metrics").then((r) => r.data),
  },
}
