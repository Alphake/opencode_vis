import type { CSSProperties } from 'react'
import type { OcPendingPermissionRequest, OcPermissionReply } from '../types/opencode'

interface PermissionPromptPanelProps {
  request: OcPendingPermissionRequest
  disabled?: boolean
  submitting?: boolean
  onReply: (reply: OcPermissionReply, message?: string) => Promise<void>
}

/**
 * Renders OpenCode permission asks from SSE `permission.asked`.
 * Submits via POST `/permission/{requestID}/reply` with once | always | reject.
 */
export default function PermissionPromptPanel({
  request,
  disabled,
  submitting,
  onReply,
}: PermissionPromptPanelProps) {
  const busy = Boolean(disabled || submitting)

  const patternsPreview =
    request.patterns.length > 0 ? request.patterns.slice(0, 6).join('\n') : '(no patterns)'

  const alwaysHint =
    request.always && request.always.length > 0
      ? request.always.slice(0, 4).join(', ')
      : null

  return (
    <div
      style={{
        borderTop: '1px solid #E8E8E8',
        background: 'linear-gradient(180deg, #F7F0FF 0%, #FFFFFF 100%)',
        padding: '12px 16px',
        flexShrink: 0,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#4A2D7C', marginBottom: 6 }}>
        The agent needs permission
      </div>
      <div
        style={{
          border: '1px solid #E8E8E8',
          borderRadius: 8,
          padding: '10px 12px',
          background: '#FFFFFF',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 11, color: '#8445BC', marginBottom: 4 }}>
          {request.permission || 'permission'}
        </div>
        <pre
          style={{
            margin: 0,
            fontSize: 11,
            color: '#333',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        >
          {patternsPreview}
        </pre>
        {request.patterns.length > 6 ? (
          <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
            +{request.patterns.length - 6} more
          </div>
        ) : null}
        {alwaysHint ? (
          <div style={{ fontSize: 10, color: '#888', marginTop: 8 }}>
            “Always” would also allow: {alwaysHint}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReply('reject')}
          style={btnStyle(busy, 'ghost')}
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReply('once')}
          style={btnStyle(busy, 'secondary')}
        >
          {submitting ? 'Sending…' : 'Allow once'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onReply('always')}
          style={btnStyle(busy, 'primary')}
        >
          Always allow
        </button>
      </div>
    </div>
  )
}

function btnStyle(
  busy: boolean,
  variant: 'primary' | 'secondary' | 'ghost',
): CSSProperties {
  const base: CSSProperties = {
    fontSize: 11,
    padding: '6px 12px',
    borderRadius: 6,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.7 : 1,
  }
  if (variant === 'primary') {
    return {
      ...base,
      border: 'none',
      background: busy ? '#C4B5D8' : '#8445BC',
      color: '#FFF',
    }
  }
  if (variant === 'secondary') {
    return {
      ...base,
      border: '1px solid #C9A8E8',
      background: '#F7F0FF',
      color: '#4A2D7C',
    }
  }
  return {
    ...base,
    border: '1px solid #E0E0E0',
    background: '#FFF',
    color: '#666',
  }
}
