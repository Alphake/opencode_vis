import type { OcMessage, OcTodo } from '../types/opencode'
import MessageBubble from './MessageBubble'
import TodoPanel from './TodoPanel'
import MessageInput from './MessageInput'

interface MessagePanelProps {
  messages: OcMessage[]
  todos: OcTodo[]
  loading: boolean
  sessionId: string
  sessionTitle?: string
  onRefresh: () => void
  onSendMessage: (text: string) => Promise<void>
}

export default function MessagePanel({
  messages,
  todos,
  loading,
  sessionId,
  sessionTitle,
  onSendMessage,
}: MessagePanelProps) {
  // 获取当前 agent 和模型信息（从最后一条 assistant message）
  const lastAssistantMsg = [...messages].reverse().find(m => m.info.role === 'assistant')
  const agentName = lastAssistantMsg?.info.agent || null
  const modelName = lastAssistantMsg?.info.model?.modelID || null

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#FFFFFF',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #E8E8E8',
          background: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: '#171717' }}>
          {sessionTitle || '未命名 Session'}
        </span>
      </div>

      {/* Messages (scrollable) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px', color: '#888', fontSize: 12 }}>
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 12 }}>
            选择一个 Session 开始对话
          </div>
        ) : (
          messages.map((msg, idx) => (
            <MessageBubble
              key={msg.info.id || `msg-${idx}`}
              message={msg}
              isLastInTurn={isLastMessageInTurn(messages, idx)}
            />
          ))
        )}
      </div>

      {/* Todo Panel (紧贴消息区域) */}
      {todos.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <TodoPanel todos={todos} />
        </div>
      )}

      {/* Message Input (直接贴着 todo 或消息) */}
      <div style={{ flexShrink: 0 }}>
        <MessageInput
          onSend={onSendMessage}
          disabled={!sessionId || loading}
          sessionId={sessionId}
          agentName={agentName}
          modelName={modelName}
        />
      </div>
    </div>
  )
}

function isLastMessageInTurn(messages: OcMessage[], idx: number): boolean {
  const current = messages[idx]
  if (current.info.role === 'user') {
    return false
  }
  const next = messages[idx + 1]
  return !next || next.info.role === 'user'
}
