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
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl ${
          isUser
            ? 'bg-accent-dim border border-accent-border px-4 py-3'
            : 'bg-bg-secondary border border-border px-4 py-3'
        }`}
      >
        {/* Role + Meta */}
        <div className={`flex items-center gap-2 mb-2 text-xs ${isUser ? 'text-text-secondary' : 'text-text-muted'}`}>
          <span className={`font-medium ${isUser ? 'text-accent' : 'text-text-secondary'}`}>
            {isUser ? '👤 You' : '🤖 Assistant'}
          </span>
          {info.agent && (
            <span className="px-1.5 py-0.5 rounded bg-bg-tertiary border border-border mono">
              {info.agent}
            </span>
          )}
          {info.model && (
            <span className="mono text-text-muted">
              {info.model.modelID}
            </span>
          )}
          {info.time && (
            <span>
              {new Date(info.time.created).toLocaleTimeString()}
            </span>
          )}
          {info.tokens && (
            <span className="text-text-muted">
              {info.tokens.total} tokens
            </span>
          )}
        </div>

        {/* Parts */}
        <div className="space-y-2">
          {parts.map((part, i) => {
            if (part.type === 'text') {
              return (
                <div key={part.id || i} className="msg-text text-sm text-text-primary whitespace-pre-wrap break-words">
                  {part.text}
                </div>
              )
            }

            if (part.type === 'reasoning') {
              return <ReasoningBlock key={part.id || i} text={part.text} time={part.time} />
            }

            if (part.type === 'tool') {
              return <ToolCallCard key={part.id || i} tool={part.tool} callID={part.callID} state={part.state} />
            }

            if (part.type === 'step-start') {
              return (
                <div key={part.id || i} className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-text-muted">step</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )
            }

            if (part.type === 'text-file') {
              return (
                <div key={part.id || i} className="rounded-lg bg-bg-tertiary border border-border p-3">
                  <div className="text-xs mono text-accent mb-1.5">{part.path}</div>
                  <pre className="text-xs mono text-text-secondary overflow-x-auto max-h-60 overflow-y-auto">
                    {part.content}
                  </pre>
                </div>
              )
            }

            if (part.type === 'image') {
              return (
                <img
                  key={part.id || i}
                  src={`data:${part.source.media_type};base64,${part.source.data}`}
                  alt="attached"
                  className="max-w-full rounded-lg max-h-60"
                />
              )
            }

            return null
          })}
        </div>
      </div>
    </div>
  )
}
