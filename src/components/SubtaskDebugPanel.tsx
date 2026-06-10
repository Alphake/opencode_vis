import { Fragment, type RefObject, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Tooltip } from 'react-tooltip'
import type { MappedAction, OcMessage } from '../types/opencode'
import type { AssistantSubtask } from '../utils/subtaskGrouping'
import type { ForkFromActionContext, ForkPanelSnapshotBundle } from '../utils/forkPanelSnapshot'
import SubtaskCard from './SubtaskCard'
import ActionTypeColorLegend from './ActionTypeColorLegend'
import {
  type ActionTypePaletteId,
  DEFAULT_ACTION_TYPE_PALETTE_ID,
  getActionTypeTriad,
} from '../styles/actionTypePalettes'
import { buildMappedActionsFromMessages, collectTaskChildDescriptors } from '../utils/actionMapping'
import { actionKey } from '../utils/actionKey'
import { getMessages } from '../services/opencodeApi'
import {
  buildCompactMappedActionTooltipHtml,
  mergeMessagesForActionTooltipLookup,
} from '../utils/actionTooltipMapping'

export type SubtaskTaskTab = {
  id: string
  title: string
  status: 'pending' | 'extracted'
  turnCount: number
}

/** Mirrors `formatDurationMs` in ActionFlowVisualization for summary tooltips */
function formatSummaryTooltipDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return '—'
  const sec = durationMs / 1000
  if (sec < 0.01) return '<0.01s'
  return `${sec.toFixed(2)}s`
}

function firstUserMessageIndex(subtask: AssistantSubtask): number | null {
  const indices = subtask.userMessageIndices ?? []
  if (indices.length === 0) return null
  return Math.min(...indices)
}

interface SubtaskDebugPanelProps {
  messages: OcMessage[]
  visibleSubtasks: Array<{ subtask: AssistantSubtask; sourceIndex: number }>
  linkedSubtaskIndex: number | null
  onSelectSubtask: (index: number) => void
  onForkFromAction?: (action: MappedAction & { row: number }, ctx: ForkFromActionContext) => void
  onAnalyzeFromAction?: (action: MappedAction & { row: number }) => void
  listScrollRef?: RefObject<HTMLDivElement | null>
  sessionDirectory?: string
  /** Saved fork-before snapshot for the forked session (local). */
  forkPanelSnapshotBundle?: ForkPanelSnapshotBundle | null
  /** Links selection from ActionFlow rects. */
  selection?: { subtaskIndex: number; actionKey: string } | null
  /** ActionFlow rect click → action-level selection. */
  onSelectAction?: (subtaskIndex: number, actionKey: string | null) => void
  /** Layout mode toggled by the subtask panel header. */
  flowLayoutMode?: 'timeline' | 'summary'
  taskTabs?: SubtaskTaskTab[]
  activeTaskTabId?: string
  onSelectTaskTab?: (id: string) => void
}

export default function SubtaskDebugPanel({
  messages,
  visibleSubtasks,
  linkedSubtaskIndex,
  onSelectSubtask,
  onForkFromAction,
  onAnalyzeFromAction,
  listScrollRef,
  sessionDirectory,
  forkPanelSnapshotBundle = null,
  selection = null,
  onSelectAction,
  flowLayoutMode = 'timeline',
  taskTabs = [],
  activeTaskTabId,
  onSelectTaskTab,
}: SubtaskDebugPanelProps) {
  const summaryTooltipSafeId = useId().replace(/:/g, '')
  const summaryTooltipId = `subtask-summary-tip-${summaryTooltipSafeId}`
  const [tooltipMounted, setTooltipMounted] = useState(false)
  const [colorBy, setColorBy] = useState<'tokens' | 'type'>('type')
  const [legendExpanded, setLegendExpanded] = useState(false)
  const actionTypePaletteId: ActionTypePaletteId = DEFAULT_ACTION_TYPE_PALETTE_ID
  const [childSessionMessages, setChildSessionMessages] = useState<Record<string, OcMessage[]>>({})
  const summaryViewportRef = useRef<HTMLDivElement | null>(null)
  const [summaryViewportSize, setSummaryViewportSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    setTooltipMounted(true)
  }, [])

  const summarySegments = useMemo(
    () =>
      visibleSubtasks.map(({ subtask, sourceIndex }, rowIndex) => {
        const indices = [...(subtask.userMessageIndices ?? []), ...subtask.assistantMessageIndices].sort(
          (a, b) => a - b,
        )
        const segmentMessages = indices
          .map((i) => messages[i])
          .filter((m): m is OcMessage => m != null)
        const parentActions = buildMappedActionsFromMessages(segmentMessages)
        const childDescriptors = collectTaskChildDescriptors(segmentMessages)
        return {
          sourceIndex,
          rowIndex,
          subtaskId: subtask.subtask_id,
          parentActions,
          childDescriptors,
          segmentMessages,
        }
      }),
    [visibleSubtasks, messages],
  )

  useEffect(() => {
    if (flowLayoutMode !== 'summary') return
    const ids = Array.from(
      new Set(summarySegments.flatMap((seg) => seg.childDescriptors.map((d) => d.childSessionID))),
    )
    if (ids.length === 0) return
    let cancelled = false
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (sid) => {
          try {
            const msgs = await getMessages(sid, `summary child session ${sid.slice(0, 8)}`, sessionDirectory)
            return [sid, msgs] as const
          } catch {
            return [sid, [] as OcMessage[]] as const
          }
        }),
      )
      if (cancelled) return
      setChildSessionMessages((prev) => {
        const next = { ...prev }
        for (const [sid, msgs] of entries) next[sid] = msgs
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [summarySegments, flowLayoutMode, sessionDirectory])

  useEffect(() => {
    if (flowLayoutMode !== 'summary') return
    const el = summaryViewportRef.current
    if (!el) return
    const update = () => {
      setSummaryViewportSize({ width: el.clientWidth, height: el.clientHeight })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [flowLayoutMode])

  const summaryRows = summarySegments.map(
    ({ sourceIndex, rowIndex, subtaskId, parentActions, childDescriptors, segmentMessages }) => {
      const childActions = childDescriptors.flatMap((desc) => {
        const msgs = childSessionMessages[desc.childSessionID] ?? []
        return buildMappedActionsFromMessages(msgs).map((a, i) => ({
          ...a,
          /** Place after parent task for readable ordering within the subtask. */
          sortTime: desc.anchorSortTime + 0.0005 + i * 0.0000001,
        }))
      })
      const actions = [...parentActions, ...childActions].sort((a, b) => a.sortTime - b.sortTime)
      return {
        sourceIndex,
        rowIndex,
        actions,
        subtaskId,
        sequenceSignature: actions.map((a) => a.actionType),
        segmentMessages,
        childDescriptors,
      }
    },
  )
  /**
   * Lexicographic sort by action-type sequence (no section headers).
   * Rows whose timeline starts with UserRequest are placed first so “user turn → …”
   * groups sit at the top; then group by first differing action type, then length / rowIndex.
   */
  const summaryRowsSorted = [...summaryRows].sort((a, b) => {
    const startsUr = (sig: string[]) => sig[0] === 'UserRequest'
    const pri = (sig: string[]) => (startsUr(sig) ? 0 : 1)
    const cmpPri = pri(a.sequenceSignature) - pri(b.sequenceSignature)
    if (cmpPri !== 0) return cmpPri

    const n = Math.min(a.sequenceSignature.length, b.sequenceSignature.length)
    for (let i = 0; i < n; i++) {
      const cmp = a.sequenceSignature[i]!.localeCompare(b.sequenceSignature[i]!, 'en')
      if (cmp !== 0) return cmp
    }
    if (a.sequenceSignature.length !== b.sequenceSignature.length) {
      return a.sequenceSignature.length - b.sequenceSignature.length
    }
    return a.rowIndex - b.rowIndex
  })
  const summaryLayout = useMemo(() => {
    const DEFAULT_BLOCK_W = 28
    const DEFAULT_BLOCK_H = 36
    const rowCount = Math.max(1, summaryRowsSorted.length)
    const maxActionCount = Math.max(1, ...summaryRowsSorted.map((r) => r.actions.length))
    const availableW = Math.max(1, summaryViewportSize.width)
    const availableH = Math.max(1, summaryViewportSize.height)
    const blockWidth = Math.max(2, Math.floor(Math.min(DEFAULT_BLOCK_W, availableW / maxActionCount)))
    const blockHeight = Math.max(2, Math.floor(Math.min(DEFAULT_BLOCK_H, availableH / rowCount)))
    return { blockWidth, blockHeight }
  }, [summaryRowsSorted, summaryViewportSize.width, summaryViewportSize.height])

  const summaryPanel = (
    <>
      <div
        ref={summaryViewportRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          padding: 0,
          border: 'none',
          borderRadius: 0,
          background: 'transparent',
        }}
      >
        {summaryRowsSorted.length === 0 ? (
          <span style={{ color: '#AAA', fontSize: 11 }}>No subtasks</span>
        ) : (
          summaryRowsSorted.map((row) => {
            const tooltipMessages = mergeMessagesForActionTooltipLookup(
              row.segmentMessages,
              row.childDescriptors.flatMap((d) => childSessionMessages[d.childSessionID] ?? []),
            )
            return (
              <div key={`${row.subtaskId}:${row.sourceIndex}:${row.rowIndex}`}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0,
                    margin: 0,
                    height: summaryLayout.blockHeight,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      height: summaryLayout.blockHeight,
                      flex: 1,
                      minWidth: 0,
                      padding: 0,
                    }}
                  >
                    {row.actions.length === 0 ? (
                      <span style={{ color: '#B0B0B0', fontSize: 10 }}>No actions</span>
                    ) : (
                      row.actions.map((action) => {
                        const paletteTriad = getActionTypeTriad(actionTypePaletteId, action.actionType)
                        const tipHtml = buildCompactMappedActionTooltipHtml(
                          action,
                          tooltipMessages,
                          formatSummaryTooltipDuration,
                        )
                        return (
                          <span
                            key={actionKey(action)}
                            data-tooltip-id={summaryTooltipId}
                            data-tooltip-html={tipHtml}
                            data-tooltip-place="top"
                            style={{
                              width: summaryLayout.blockWidth,
                              height: summaryLayout.blockHeight,
                              borderRadius: 0,
                              flexShrink: 0,
                              background:
                                action.actionType === 'UserRequest' ? '#8F8F8F' : paletteTriad.fill,
                              border: 'none',
                            }}
                          />
                        )
                      })
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      {tooltipMounted && (
        <Tooltip
          id={summaryTooltipId}
          anchorSelect={`[data-tooltip-id="${summaryTooltipId}"]`}
          className="action-flow-react-tooltip"
          variant="light"
          positionStrategy="fixed"
          delayShow={150}
          delayHide={220}
          opacity={1}
          clickable
          globalCloseEvents={{ scroll: false, resize: true, escape: true }}
          arrowColor="#f8fafc"
        />
      )}
    </>
  )

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '0 0 8px',
          borderBottom: '1px solid #E8E8E8',
          marginBottom: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div>
          <button
            type="button"
            onClick={() => setLegendExpanded((v) => !v)}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              fontWeight: 600,
              color: '#6A6A6A',
              cursor: 'pointer',
            }}
            aria-expanded={legendExpanded}
          >
            <span style={{ fontSize: 10 }}>{legendExpanded ? '-' : '+'}</span>
            Action type legend
          </button>
          {legendExpanded ? <ActionTypeColorLegend paletteId={actionTypePaletteId} /> : null}
        </div>
        {taskTabs.length > 0 ? (
          <div
            role="tablist"
            aria-label="Task segments"
            style={{
              display: 'flex',
              gap: 6,
              overflowX: 'auto',
              paddingBottom: 2,
            }}
          >
            {taskTabs.map((tab, idx) => {
              const active = tab.id === activeTaskTabId
              const label =
                tab.status === 'pending'
                  ? tab.title
                  : `Task ${idx + 1}${tab.turnCount > 1 ? ` (${tab.turnCount})` : ''}`
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectTaskTab?.(tab.id)}
                  title={`${tab.status === 'pending' ? 'Current task' : 'Extracted task'} · ${tab.turnCount} turn${tab.turnCount === 1 ? '' : 's'}`}
                  style={{
                    flexShrink: 0,
                    border: active ? '1px solid #8A8A8A' : '1px solid #D8D8D8',
                    background: active ? '#F3F3F3' : '#FFFFFF',
                    color: active ? '#262626' : '#707070',
                    borderRadius: 999,
                    padding: '3px 8px',
                    fontSize: 10,
                    fontWeight: active ? 650 : 500,
                    lineHeight: '14px',
                    cursor: onSelectTaskTab ? 'pointer' : 'default',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          width: '100%',
          minWidth: 0,
          position: 'relative',
        }}
      >
        <div
          ref={listScrollRef}
          style={{
            height: '100%',
            width: '100%',
            minWidth: 0,
            overflowY: flowLayoutMode === 'summary' ? 'hidden' : 'auto',
            boxSizing: 'border-box',
            fontSize: 11,
            color: '#333',
            lineHeight: 1.45,
          }}
        >
          {flowLayoutMode === 'summary' ? (
            summaryPanel
          ) : visibleSubtasks.length === 0 ? (
            <span style={{ color: '#AAA', fontSize: 11 }}>No subtasks</span>
          ) : (
            visibleSubtasks.map(({ subtask: st, sourceIndex }, si) => {
              const currentUserIndex = firstUserMessageIndex(st)
              const previous = si > 0 ? visibleSubtasks[si - 1] : null
              const previousUserIndex = previous ? firstUserMessageIndex(previous.subtask) : null
              const startsNewPrompt =
                si > 0 &&
                currentUserIndex !== null &&
                currentUserIndex !== previousUserIndex

              return (
                <Fragment
                  key={`${st.subtask_id}:${sourceIndex}:${st.assistantMessageIndices[0] ?? -1}:${st.assistantMessageIndices[st.assistantMessageIndices.length - 1] ?? -1}:${st.assistantMessageIndices.length}`}
                >
                  {startsNewPrompt ? (
                    <div
                      aria-label={`User prompt ${currentUserIndex + 1}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        margin: '12px 2px 10px',
                        color: '#8A8A8A',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: 0.2,
                      }}
                    >
                      <span style={{ height: 1, flex: 1, background: '#E0E0E0' }} />
                      <span style={{ whiteSpace: 'nowrap' }}>New user prompt</span>
                      <span style={{ height: 1, flex: 1, background: '#E0E0E0' }} />
                    </div>
                  ) : null}
                  <SubtaskCard
                    subtask={st}
                    messages={messages}
                    displayIndex={si}
                    cardIndex={sourceIndex}
                    isLinked={linkedSubtaskIndex === sourceIndex}
                    onSelectSubtask={() => onSelectSubtask(sourceIndex)}
                    onForkFromAction={onForkFromAction}
                    onAnalyzeFromAction={onAnalyzeFromAction}
                    sessionDirectory={sessionDirectory}
                    forkPanelSnapshotBundle={forkPanelSnapshotBundle}
                    selectedActionKey={
                      selection && selection.subtaskIndex === sourceIndex ? selection.actionKey : null
                    }
                    otherSubtaskHasSelection={false}
                    onSelectActionFromFlow={
                      onSelectAction ? (key) => onSelectAction(sourceIndex, key) : undefined
                    }
                    colorBy={colorBy}
                    onColorByChange={setColorBy}
                    actionTypePaletteId={actionTypePaletteId}
                  />
                </Fragment>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
