export type AgentStatus = "idle" | "busy" | "error"
export type AgentType = "build" | "general" | "explore" | "plan" | string

export interface Session {
  id: string
  agent: AgentType
  parentId?: string
  status: AgentStatus
  modelId?: string
  providerId?: string
  systemPrompt?: string
  title: string
  directory: string
  createdAt: number
  updatedAt: number
  tokens: { input: number; output: number; cacheRead: number }
  cost: number
  children: string[]
}

export interface MessagePart {
  type: "text" | "tool" | "reasoning" | "step-finish" | "compaction" | "step-start"
  content?: string
  toolName?: string
  callId?: string
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolInput?: unknown
  toolOutput?: string
  tokenInput?: number
  tokenOutput?: number
  cost?: number
}

export interface Message {
  id: string
  sessionId: string
  role: "user" | "assistant"
  agent?: string
  timestamp: number
  parts: MessagePart[]
  tokens: { input: number; output: number }
  cost: number
  isCompaction: boolean
}

export interface ToolCallRecord {
  callId: string
  sessionId: string
  tool: string
  args: Record<string, unknown>
  startedAt: number
  endedAt?: number
  durationMs?: number
  status: "running" | "completed" | "error"
  title: string
  outputSnippet: string
  isMcp: boolean
  isSkill: boolean
}

export interface ToolStats {
  toolName: string
  totalCalls: number
  successCount: number
  errorCount: number
  avgDurationMs: number
  successRate: number
  recentCalls: ToolCallRecord[]
}

export interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: "high" | "medium" | "low"
}

export interface SkillRecord {
  name: string
  description: string
  sessionId: string
  loadedAt: number
  source: string
}

export interface Metrics {
  totalSessions: number
  activeSessions: number
  totalMessages: number
  totalToolCalls: number
  totalTokens: { input: number; output: number }
  totalCost: number
}

export interface Snapshot {
  sessions: Session[]
  hierarchy: Session[]
  toolStats: ToolStats[]
  todos: Record<string, TodoItem[]>
  skills: SkillRecord[]
  metrics: Metrics
}
