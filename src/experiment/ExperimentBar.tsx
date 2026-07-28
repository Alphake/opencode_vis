import { useEffect, useRef, useState } from 'react'
import { saveExperimentReport } from '../services/memoryWorkerApi'
import { sameDirectory } from '../utils/sessionFolders'
import { downloadReportFallback, experimentTelemetry } from './telemetry'
import { useExperimentSnapshot } from './useExperimentSnapshot'
import type { ExperimentReport } from './types'

type Props = {
  /** Current workspace / folder selection (experiment is folder-scoped). */
  directory: string
}

async function persistReport(report: ExperimentReport): Promise<'saved' | 'downloaded'> {
  try {
    await saveExperimentReport({
      directory: report.directory,
      report,
    })
    return 'saved'
  } catch (err) {
    downloadReportFallback(report)
    console.warn('[VibeTrace][experiment] worker write failed, downloaded instead', err)
    return 'downloaded'
  }
}

/** Compact Start/End strip for the bottom of the left session-history column (workspace-level). */
export default function ExperimentBar({ directory }: Props) {
  const snap = useExperimentSnapshot()
  const [participantId, setParticipantId] = useState('P01')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const switchingRef = useRef(false)

  const active = Boolean(snap?.active)
  const boundToCurrentFolder = active && sameDirectory(snap?.directory, directory)

  /** Switching workspace while recording → save previous report, require Start again. */
  useEffect(() => {
    if (!snap?.active) return
    if (sameDirectory(snap.directory, directory)) return
    if (switchingRef.current) return
    switchingRef.current = true
    void (async () => {
      setBusy(true)
      try {
        const report = experimentTelemetry.end('auto-ended: workspace switched')
        if (report) {
          const how = await persistReport(report)
          setHint(how === 'saved' ? 'Saved · Start again' : 'Downloaded · Start again')
          window.setTimeout(() => setHint(null), 3500)
        }
      } finally {
        setBusy(false)
        switchingRef.current = false
      }
    })()
  }, [directory, snap?.active, snap?.directory])

  const handleStart = () => {
    setHint(null)
    try {
      experimentTelemetry.start({ participantId, directory })
    } catch (e) {
      setHint(e instanceof Error ? e.message : String(e))
    }
  }

  const handleEnd = async () => {
    setBusy(true)
    setHint(null)
    try {
      const report = experimentTelemetry.end()
      if (!report) {
        setHint('No active experiment.')
        return
      }
      const how = await persistReport(report)
      setHint(how === 'saved' ? 'Saved' : 'Downloaded')
      window.setTimeout(() => setHint(null), 2500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        margin: '8px 10px 10px',
        padding: '6px 8px',
        border: '1px solid #E8E8E8',
        borderRadius: 8,
        background: '#FAFAFA',
        fontSize: 11,
        color: '#555',
        minHeight: 32,
        boxSizing: 'border-box',
      }}
      title={
        boundToCurrentFolder
          ? `Recording this workspace · ${snap?.directory ?? ''}`
          : directory.trim()
            ? `Experiment for workspace · ${directory}`
            : 'Select a workspace folder first'
      }
    >
      <span style={{ fontWeight: 650, color: '#6A6A6A', flexShrink: 0 }}>Exp</span>

      {boundToCurrentFolder ? (
        <>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: '#DC2626',
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, minWidth: 0, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Rec
          </span>
          <button
            type="button"
            onClick={() => void handleEnd()}
            disabled={busy}
            style={{
              border: '1px solid #DC2626',
              background: '#DC2626',
              color: '#fff',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer',
              flexShrink: 0,
            }}
          >
            {busy ? '…' : 'End'}
          </button>
        </>
      ) : (
        <>
          <input
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            placeholder="P01"
            title="Participant ID"
            aria-label="Participant ID"
            style={{
              width: 44,
              border: '1px solid #D8D8D8',
              borderRadius: 6,
              padding: '2px 5px',
              fontSize: 11,
              background: '#fff',
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1, minWidth: 0 }} />
          <button
            type="button"
            onClick={handleStart}
            disabled={!directory.trim() || busy}
            style={{
              border: '1px solid #111827',
              background: directory.trim() && !busy ? '#111827' : '#E8E8E8',
              color: directory.trim() && !busy ? '#fff' : '#999',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 700,
              cursor: directory.trim() && !busy ? 'pointer' : 'not-allowed',
              flexShrink: 0,
            }}
          >
            Start
          </button>
        </>
      )}

      {hint ? (
        <span
          title={hint}
          style={{
            color: '#888',
            maxWidth: 64,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  )
}
