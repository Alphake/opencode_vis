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
  onRefresh,
  onSendMessage,
}: MessagePanelProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#F8F8F8',
        minWidth: 0, // 防止内容撑开
      }}
    >
      {/* MessagePanel Header */}
      <div
        style={{
          height: 48,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #E8E8E8',
          background: '#FFFFFF',
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: '#171717',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sessionTitle || 'Chat'}
        </span>
      </div>

      {/* Messages (scrollable) */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8F8F8F" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8F8F8F' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '12px', opacity: 0.4 }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p style={{ fontSize: '14px' }}>选择一个 Session 开始对话</p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Todo Panel */}
      {todos.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <TodoPanel todos={todos} />
        </div>
      )}

      {/* Message Input */}
      <div style={{ flexShrink: 0 }}>
        <MessageInput
          onSend={onSendMessage}
          disabled={!sessionId || loading}
          sessionId={sessionId}
        />
      </div>
    </div>
  )
}
