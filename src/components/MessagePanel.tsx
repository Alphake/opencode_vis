import type { OcMessage } from '../types/opencode'
import MessageBubble from './MessageBubble'

interface MessagePanelProps {
  messages: OcMessage[]
  loading: boolean
  sessionId: string
  onRefresh: () => void
}

export default function MessagePanel({ messages, loading, sessionId, onRefresh }: MessagePanelProps) {
  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <p className="text-lg mb-1">← 选择一个 Session</p>
          <p className="text-sm">从顶部下拉框选择会话开始查看</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <div className="text-center">
          <p className="text-lg mb-1">此 Session 暂无消息</p>
          <p className="text-sm">该会话还没有任何对话记录</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-bg-secondary/50 text-xs text-text-muted shrink-0">
        <span>
          {messages.length} 条消息
        </span>
        <button
          onClick={onRefresh}
          className="px-2 py-0.5 rounded hover:bg-bg-hover transition-colors"
        >
          ↻ 刷新
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.info.id} message={msg} />
        ))}
      </div>
    </div>
  )
}
