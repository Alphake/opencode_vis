import { useState } from 'react'
import type { OcMessage, OcMessagePart, OcMessageInfo } from '../types/opencode'
import { stripHarnessGuidanceForDisplay } from '../config/harnessGuidance'

interface MessageBubbleProps {
  message: OcMessage
  isLastInTurn: boolean
}

/** 简单 Markdown 渲染（统一字号，无斜体） */
function renderMarkdown(text: string): string {
  if (!text) return ''
  return text
    // 代码块
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:#F5F5F5;padding:8px;border-radius:4px;margin:6px 0;font-family:IBM Plex Mono,monospace;font-size:11px"><code>$2</code></pre>')
    // 行内代码
    .replace(/`([^`]+)`/g, '<code style="background:#F5F5F5;padding:1px 3px;border-radius:2px;font-family:IBM Plex Mono,monospace;font-size:11px">$1</code>')
    // 表格
    .replace(/(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)*)/g, (_match, header, _divider, rows) => {
      const headerCells = header.split('|').filter((c: string) => c.trim())
      const rowLines = rows.trim().split('\n')
      const bodyCells = rowLines.map((row: string) => row.split('|').filter((c: string) => c.trim()))
      let html = '<table style="border-collapse:collapse;margin:8px 0;font-size:11px">'
      html += '<thead><tr>' + headerCells.map((c: string) => `<th style="border:1px solid #E8E8E8;padding:4px 8px;background:#F5F5F5;font-weight:600">${c}</th>`).join('') + '</tr></thead>'
      html += '<tbody>'
      bodyCells.forEach((cells: string[]) => {
        html += '<tr>' + cells.map((c: string) => `<td style="border:1px solid #E8E8E8;padding:4px 8px">${c}</td>`).join('') + '</tr>'
      })
      html += '</tbody></table>'
      return html
    })
    // **bold** -> strong
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // *italic* -> just text (no italic)
    .replace(/\*(.+?)\*/g, '$1')
    // Headers: 统一渲染为粗体文字
    .replace(/^#{1,6} (.+)$/gm, '<strong>$1</strong>')
    // bullet lists
    .replace(/^- (.+)$/gm, '<div style="margin-left:16px">• $1</div>')
    // numbered lists
    .replace(/^\d+\. (.+)$/gm, '<div style="margin-left:16px">$1</div>')
    // 段落
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    // 单换行
    .replace(/\n/g, '<br/>')
}

/** 用户消息：OpenCode 常把正文放在 parts.text，info.content 可能为空 */
function userMessageDisplayText(message: OcMessage): string {
  const c = message.info.content?.trim()
  if (c) return message.info.content!
  const fromParts = message.parts
    .filter((p): p is Extract<OcMessagePart, { type: 'text' }> => p.type === 'text')
    .map(p => p.text || '')
    .join('')
    .trim()
  return fromParts
}

export default function MessageBubble({ message, isLastInTurn }: MessageBubbleProps) {
  const { info, parts } = message
  const isUser = info.role === 'user'

  if (isUser) {
    return <UserMessage message={message} />
  }

  // Assistant message
  return (
    <div style={{ padding: '4px 0' }}>
      {parts.map((part, idx) => (
        <PartView key={idx} part={part} />
      ))}
      {isLastInTurn && <AgentInfo info={info} />}
    </div>
  )
}

function UserMessage({ message }: { message: OcMessage }) {
  const content = stripHarnessGuidanceForDisplay(userMessageDisplayText(message))
  const [showCopy, setShowCopy] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div
      style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0', position: 'relative' }}
      onMouseEnter={() => setShowCopy(true)}
      onMouseLeave={() => setShowCopy(false)}
    >
      <div
        style={{
          maxWidth: '70%',
          padding: '8px 12px',
          background: '#FFFFFF',
          border: '1px solid #E8E8E8',
          borderRadius: '12px',
          fontSize: 12,
          lineHeight: 1.5,
          color: '#333',
          wordBreak: 'break-word',
        }}
      >
        {content || <span style={{ color: '#BBB' }}>（无文本内容）</span>}
      </div>
      {/* Copy button */}
      {showCopy && (
        <button
          onClick={handleCopy}
          style={{
            position: 'absolute',
            bottom: -4,
            right: 8,
            background: '#FFFFFF',
            border: '1px solid #E8E8E8',
            borderRadius: '4px',
            padding: '2px 6px',
            fontSize: 10,
            color: copied ? '#0ABE00' : '#999',
            cursor: 'pointer',
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      )}
    </div>
  )
}

function AgentInfo({ info }: { info: OcMessageInfo }) {
  const modelName = info.model?.modelID || null
  const totalTokens = info.tokens?.total || null

  let duration: string | null = null
  if (info.time?.completed && info.time?.created) {
    const ms = info.time.completed - info.time.created
    if (ms > 0) {
      duration = `${(ms / 1000).toFixed(1)}s`
    }
  }

  if (!modelName && !totalTokens && !duration) return null

  return (
    <div style={{ marginTop: '8px', fontSize: 11, color: '#999', display: 'flex', gap: '12px' }}>
      {modelName && <span>{modelName}</span>}
      {duration && <span>{duration}</span>}
      {totalTokens && <span>{totalTokens} tokens</span>}
    </div>
  )
}

function PartView({ part }: { part: OcMessagePart }) {
  switch (part.type) {
    case 'text':
      return (
        <div
          style={{ fontSize: 12, lineHeight: 1.6, color: '#333' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text || '') }}
        />
      )

    case 'reasoning':
      return (
        <div style={{
          fontSize: 12,
          color: '#999',
          margin: '4px 0',
          padding: '6px 10px',
          background: '#FAFAFA',
          borderRadius: '4px',
          lineHeight: 1.5,
        }}>
          {part.text}
        </div>
      )

    case 'tool': {
      const state = part.state
      const output = state?.output
      const hasOutput = Boolean(output && output.trim().length > 0)
      return (
        <ToolCallView toolName={part.tool} status={state?.status} output={output} hasOutput={hasOutput} />
      )
    }

    case 'text-file':
      return (
        <div style={{
          fontSize: 11,
          background: '#F5F5F5',
          padding: '6px 10px',
          borderRadius: '4px',
          margin: '4px 0',
          fontFamily: 'IBM Plex Mono, monospace',
          whiteSpace: 'pre-wrap',
          color: '#555',
          overflow: 'hidden',
        }}>
          [{part.path}]
        </div>
      )

    case 'image': {
      const url = part.source?.data
        ? `data:${part.source.media_type};base64,${part.source.data}`
        : null
      return (
        <div style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>
          {url ? <img src={url} alt="image" style={{ maxWidth: '150px', borderRadius: '4px' }} /> : '[图片]'}
        </div>
      )
    }

    case 'compaction':
      return (
        <div style={{
          fontSize: 10,
          color: '#C62828',
          margin: '4px 0',
          fontFamily: 'var(--font-family-mono)',
        }}>
          [compaction]
        </div>
      )

    case 'step-start':
    case 'step-end':
    case 'step-finish':
      return null

    default:
      return null
  }
}

function ToolCallView({ toolName, status, output, hasOutput }: {
  toolName: string
  status?: string
  output?: string
  hasOutput: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div style={{ margin: '4px 0', border: '1px solid #E8E8E8', borderRadius: '6px', overflow: 'hidden' }}>
      <div
        onClick={() => hasOutput && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 10px',
          background: '#FAFAFA',
          cursor: hasOutput ? 'pointer' : 'default',
          fontSize: 12,
        }}
      >
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', color: '#333' }}>{toolName}</span>
        {status && (
          <span style={{ fontSize: 10, color: '#999', marginLeft: '8px' }}>{status}</span>
        )}
        {hasOutput && (
          <span style={{ marginLeft: 'auto', color: '#CCC', fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {hasOutput && expanded && (
        <div style={{
          padding: '8px 10px',
          background: '#FFFFFF',
          borderTop: '1px solid #E8E8E8',
          fontSize: 11,
          fontFamily: 'IBM Plex Mono, monospace',
          whiteSpace: 'pre-wrap',
          color: '#555',
          maxHeight: '200px',
          overflowY: 'auto',
          overflowX: 'hidden',
          wordBreak: 'break-all',
        }}>
          {output}
        </div>
      )}
    </div>
  )
}
