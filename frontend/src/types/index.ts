export type AgentStatus = "idle" | "busy" | "error" | "pending" | "retrying"
export type AgentType = "build" | "general" | "explore" | "plan" | string

export interface SessionError {
  timestamp: number
  name: string
  message: string
}

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
  errorHistory: SessionError[]
  /** 该 session 下工具调用错误数（后端从 messages 补全后统计） */
  toolErrorCount?: number
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
  hierarchy?: Session[]
  toolStats: ToolStats[]
  todos: Record<string, TodoItem[]>
  skills: SkillRecord[]
  metrics: Metrics
}

export interface PartProjectionNode {
  nodeId: string
  sessionId: string
  messageId: string
  agent: string
  role: string
  timestamp: number
  type: string
  status: string
  payload: Record<string, unknown>
  embeddingInput: string
  keywords: string[]
  features: Record<string, unknown>
  embedding?: number[]
  x?: number
  y?: number
}

export interface PartProjectionResponse {
  sessionId: string
  nodes: PartProjectionNode[]
  debug: Record<string, unknown>
  error?: string
}

export interface OverviewProjectionNode {
  nodeId: string
  agent: string
  sessionId: string
  messageId?: string
  sessionCount: number
  messageCount: number
  anchorMessageId?: string
  anchorText: string
  embeddingInput: string
  embedding?: number[]
  x?: number
  y?: number
}

export interface OverviewAgentNode {
  nodeId: string
  agent: string
  status: AgentStatus
  sessionId: string
  sessionCount: number
  x?: number
  y?: number
  embeddingInput: string
  initSource: "todo" | "first_user_message" | "session_title" | "fallback"
}

export interface OverviewMessageNode {
  nodeId: string
  agent: string
  sessionId: string
  messageId: string
  role?: string
  type?: string
  timestamp?: number
  embeddingInput: string
  /** 抽取的一句话，用于算 embedding */
  intentSentence?: string
  /** 一个关键词，在等高线图上按权值阈值展示 */
  keyword?: string
  /** 关键词展示权值，0～1，超过阈值才显示，字号与权值成比例 */
  keywordWeight?: number
  x?: number
  y?: number
}

export interface OverviewAgentEdge {
  sourceAgent: string
  targetAgent: string
  count: number
}

export interface OverviewProjectionResponse {
  directory: string
  /** 兼容旧结构（message 点） */
  nodes?: OverviewProjectionNode[]
  agentNodes?: OverviewAgentNode[]
  messageNodes?: OverviewMessageNode[]
  agentEdges?: OverviewAgentEdge[]
  debug: Record<string, unknown>
  error?: string
}

export interface OverviewIncrementalResponse {
  directory: string
  addedMessageNodes: OverviewMessageNode[]
  debug: Record<string, unknown>
  error?: string
}
