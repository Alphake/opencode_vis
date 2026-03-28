// ===== OpenCode API Types =====

export interface OcSession {
  id: string
  slug: string
  projectID: string
  directory: string
  title: string
  version: string
  summary: {
    additions: number
    deletions: number
    files: number
  }
  time: {
    created: number
    updated: number
  }
  parentID?: string
  permission?: Array<{
    permission: string
    pattern: string
    action: string
  }>
}

export interface OcTodo {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'high' | 'medium' | 'low'
}

export type PartType = 'text' | 'reasoning' | 'tool' | 'step-start' | 'text-file' | 'image' | 'step-end' | 'snapshot'

export interface OcMessageInfo {
  role: 'user' | 'assistant'
  content?: string  // user message 的文本内容
  time: {
    created: number
    completed?: number
  }
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  mode?: string
  tokens?: {
    total: number
    input: number
    output: number
    reasoning: number
    cache?: { read: number; write: number }
  }
  cost?: number
  finish?: string
  id: string
  sessionID: string
  parentID?: string
}

export type TextPart = {
  type: 'text'
  text: string
  id: string
  sessionID: string
  messageID: string
}

export type ReasoningPart = {
  type: 'reasoning'
  text: string
  metadata?: Record<string, unknown>
  time?: { start: number; end: number }
  id: string
  sessionID: string
  messageID: string
}

export type ToolPart = {
  type: 'tool'
  callID: string
  tool: string
  state: {
    status: 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    output?: string
  }
  id: string
  sessionID: string
  messageID: string
}

export type StepStartPart = {
  type: 'step-start'
  id: string
  sessionID: string
  messageID: string
}

export type TextFilePart = {
  type: 'text-file'
  path: string
  content: string
  id: string
  sessionID: string
  messageID: string
}

export type ImagePart = {
  type: 'image'
  source: {
    type: string
    media_type: string
    data: string
  }
  id: string
  sessionID: string
  messageID: string
}

export type OcMessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepStartPart
  | TextFilePart
  | ImagePart

export interface OcMessage {
  info: OcMessageInfo
  parts: OcMessagePart[]
}

// ===== D3 Event types =====
export interface FlowEvent {
  type: 'thinking' | 'tool' | 'file-write' | 'bash' | 'error' | 'text' | 'step'
  label: string
  timestamp: number
  duration?: number
  toolName?: string
}
