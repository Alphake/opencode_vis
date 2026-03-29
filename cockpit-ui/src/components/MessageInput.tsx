import { useState } from 'react'

interface MessageInputProps {
  onSend: (text: string) => Promise<void>
  disabled?: boolean
  sessionId?: string
  agentName?: string | null
  modelName?: string | null
}

export default function MessageInput({ onSend, disabled, agentName, modelName }: MessageInputProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!text.trim() || sending || disabled) return
    setSending(true)
    try {
      await onSend(text.trim())
      setText('')
    } catch (err) {
      console.error('[MessageInput] Send failed:', err)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ padding: '10px 16px' }}>
      {/* Agent info below input */}
      {(agentName || modelName) && (
        <div style={{
          marginBottom: '6px',
          fontSize: 11,
          color: '#999',
          display: 'flex',
          gap: '12px',
        }}>
          {agentName && <span>{agentName}</span>}
          {modelName && <span>{modelName}</span>}
        </div>
      )}
      {/* Input Container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          background: '#FFFFFF',
          border: '1px solid #E8E8E8',
          borderRadius: '8px',
          padding: '8px 12px',
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息..."
          disabled={disabled || sending}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: '#333',
            fontSize: 12,
            lineHeight: 1.5,
            maxHeight: 120,
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          style={{
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: text.trim() && !disabled ? '#8B5CF6' : '#F5F5F5',
            border: 'none',
            borderRadius: '6px',
            cursor: text.trim() && !disabled ? 'pointer' : 'not-allowed',
            opacity: sending ? 0.7 : 1,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={text.trim() && !disabled ? 'white' : '#CCC'} strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
