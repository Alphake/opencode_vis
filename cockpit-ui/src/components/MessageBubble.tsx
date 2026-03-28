import type { OcMessage } from '../types/opencode'
import ToolCallCard from './ToolCallCard'
import ReasoningBlock from './ReasoningBlock'

interface MessageBubbleProps {
  message: OcMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const { info, parts } = message
  const isUser = info.role === 'user'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {/* Role Label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12,
        }}
      >
        <span
          style={{
            fontWeight: 500,
            color: isUser ? '#8445BC' : '#171717',
          }}
        >
          {isUser ? 'You' : 'Assistant'}
        </span>
        {info.model && (
          <span style={{ color: '#8F8F8F', fontSize: 11 }}>
            {info.model.modelID}
          </span>
        )}
        {info.time && (
          <span style={{ color: '#8F8F8F', fontSize: 11 }}>
            {new Date(info.time.created).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* User Message */}
      {isUser && (
        <div
          style={{
            padding: '10px 14px',
            background: '#FFFFFF',
            borderRadius: 8,
            border: '1px solid #E8E8E8',
            maxWidth: '80%',
            fontSize: 14,
            lineHeight: 1.5,
            color: '#171717',
          }}
        >
          {parts.find(p => p.type === 'text')?.text || ''}
        </div>
      )}

      {/* Assistant Message */}
      {!isUser && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {parts.map((part, i) => {
            if (part.type === 'text') {
              return (
                <div
                  key={part.id || i}
                  style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: '#171717',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {part.text}
                </div>
              )
            }

            if (part.type === 'reasoning') {
              return (
                <ReasoningBlock
                  key={part.id || i}
                  text={part.text}
                  time={part.time}
                />
              )
            }

            if (part.type === 'tool') {
              return (
                <ToolCallCard
                  key={part.id || i}
                  tool={part.tool}
                  callID={part.callID}
                  state={part.state}
                />
              )
            }

            if (part.type === 'step-start') {
              return (
                <div
                  key={part.id || i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 0',
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: '#E8E8E8' }} />
                  <span style={{ fontSize: 11, color: '#8F8F8F' }}>step</span>
                  <div style={{ flex: 1, height: 1, background: '#E8E8E8' }} />
                </div>
              )
            }

            if (part.type === 'image') {
              return (
                <img
                  key={part.id || i}
                  src={`data:${part.source.media_type};base64,${part.source.data}`}
                  alt="attached"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 240,
                    borderRadius: 8,
                  }}
                />
              )
            }

            return null
          })}
        </div>
      )}
    </div>
  )
}
