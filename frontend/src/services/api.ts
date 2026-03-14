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
    messages: (id: string) => http.get<Message[]>(`/sessions/${id}/messages`).then((r) => r.data),
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
