import { useState } from 'react'

interface MessageInputProps {
  onSend: (text: string) => Promise<void>
  disabled?: boolean
  sessionId?: string
}

export default function MessageInput({ onSend, disabled, sessionId }: MessageInputProps) {
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
    <div
      style={{
        padding: '12px 16px',
        background: 'var(--color-bg-base)',
        borderTop: '1px solid var(--color-border-light)',
      }}
    >
      {/* Input Container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '8px',
          background: 'var(--color-bg-white)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
          padding: '8px 12px',
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
          disabled={disabled || sending}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: 'var(--color-text-primary)',
            fontSize: '14px',
            lineHeight: 1.5,
            maxHeight: 120,
            fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: text.trim() && !disabled
              ? 'var(--color-accent)'
              : 'var(--color-gray-100)',
            border: 'none',
            borderRadius: '6px',
            cursor: text.trim() && !disabled ? 'pointer' : 'not-allowed',
            opacity: sending ? 0.7 : 1,
            transition: 'all 0.2s ease',
          }}
        >
          {sending ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              className="animate-spin"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={text.trim() && !disabled ? 'white' : 'var(--color-text-tertiary)'}
              strokeWidth="2"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: '8px',
          fontSize: '12px',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <span>按 Enter 发送 · Shift+Enter 换行</span>
        {sessionId && (
          <span style={{ fontFamily: 'var(--font-family-mono)' }}>
            Session: {sessionId.slice(0, 8)}...
          </span>
        )}
      </div>
    </div>
  )
}
