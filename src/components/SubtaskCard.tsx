import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MappedAction, OcMessage } from '../types/opencode'
import type { AssistantSubtask } from '../utils/subtaskGrouping'
import { buildSubtaskCardMetrics, formatDurationMs, formatSubtaskCostDisplay } from '../utils/subtaskMetrics'
import {
  applyParallelLayoutFromCalls,
  buildChildSessionBandMap,
  buildChildSessionBranchActions,
  buildMappedActionsFromMessages,
  collectTaskChildDescriptors,
  detectParallelCallMapping,
  extractChildSessionIdFromToolPart,
  isSubagentToolName,
} from '../utils/actionMapping'
import { mergeMessagesForActionTooltipLookup } from '../utils/actionTooltipMapping'
import ActionFlowVisualization from './ActionFlowVisualization'
import { actionFlowPalette } from '../styles/actionFlowPalette'
import { getMessages } from '../services/opencodeApi'

const fontSans =
  "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif"

/** 子任务卡片最小高度；内容（如分叉可视化）变高时卡片随内容增高 */
const CARD_MIN_HEIGHT = 220
const LONG_RUNNING_MS = 60_000

interface SubtaskCardProps {
  subtask: AssistantSubtask
  messages: OcMessage[]
  displayIndex: number
  /** DOM 定位索引：用于连线/滚动，需与 App 中 linkedSubtaskIndex 使用同一坐标系 */
  cardIndex?: number
  isLinked?: boolean
  onSelectSubtask?: () => void
  onForkFromAction?: (action: MappedAction & { row: number }) => void
  onAnalyzeFromAction?: (action: MappedAction & { row: number }) => void
  /** 与 OpenCode 多目录一致，拉取子会话消息时必带 */
  sessionDirectory?: string
}

type ColorByMode = 'status' | 'tokens'

function MetricBox({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '3px 4px',
        minWidth: 0,
        flex: '1 1 0',
        minHeight: 44,
        border: '1px solid #DBDBDB',
        borderRadius: 10,
        background: '#FCFCFC',
      }}
    >
      <div
        className={alert ? 'subtask-time-alert' : undefined}
        style={{
          fontFamily: fontSans,
          fontWeight: 600,
          fontSize: 9,
          lineHeight: '12px',
          textAlign: 'center',
          color: '#5C5C5C',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fontSans,
          fontWeight: 600,
          fontSize: 13,
          lineHeight: '16px',
          textAlign: 'center',
          color: '#2B2B2B',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  )
}

export default function SubtaskCard({
  subtask,
  messages,
  displayIndex,
  cardIndex,
  isLinked = false,
  onSelectSubtask,
  onForkFromAction,
  onAnalyzeFromAction,
  sessionDirectory,
}: SubtaskCardProps) {
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [actionsDurationOn, setActionsDurationOn] = useState(false)
  const [colorBy, setColorBy] = useState<ColorByMode>('status')
  const [childBranchActions, setChildBranchActions] = useState<(MappedAction & { row: number })[]>([])
  /** task 子会话原文，用于 Changes 合并统计 write/edit 路径 */
  const [childBranchMessages, setChildBranchMessages] = useState<OcMessage[]>([])

  const m = useMemo(
    () =>
      buildSubtaskCardMetrics(subtask, messages, displayIndex, {
        nowMs: nowTick,
        additionalMessages: childBranchMessages,
      }),
    [subtask, messages, displayIndex, nowTick, childBranchMessages],
  )

  /** 本子任务段内的 assistant 消息（顺序与全局 timeline 一致） */
  const segmentMessages = useMemo((): OcMessage[] => {
    return subtask.assistantMessageIndices
      .map(i => messages[i])
      .filter((msg): msg is OcMessage => msg != null)
  }, [subtask.assistantMessageIndices, messages])

  const parentFlowActions = useMemo(
    () => buildMappedActionsFromMessages(segmentMessages, { nowMs: nowTick }),
    [segmentMessages, nowTick]
  )

  const taskDescriptors = useMemo(
    () => collectTaskChildDescriptors(segmentMessages),
    [segmentMessages]
  )
  const parallelByCallId = useMemo(
    () => detectParallelCallMapping(segmentMessages, nowTick),
    [segmentMessages, nowTick]
  )
  /** 并行子会话共享同一 band；非并行仍按唯一 childSessionID 递增。 */
  const childSessionBandMap = useMemo(
    () => buildChildSessionBandMap(taskDescriptors, parallelByCallId),
    [taskDescriptors, parallelByCallId]
  )

  const hasRunningTaskWithChild = useMemo(() => {
    return segmentMessages.some((msg) => {
      if (msg.info.role !== 'assistant') return false
      return msg.parts.some((p) => {
        if (p.type !== 'tool' || !isSubagentToolName(p.tool)) return false
        if (p.state?.status !== 'running') return false
        return Boolean(extractChildSessionIdFromToolPart(p))
      })
    })
  }, [segmentMessages])

  const loadChildBranches = useCallback(async () => {
    if (taskDescriptors.length === 0) {
      setChildBranchActions([])
      setChildBranchMessages([])
      return
    }
    const results = await Promise.all(
      taskDescriptors.map(async (d) => {
        try {
          const msgs = await getMessages(
            d.childSessionID,
            `子会话 branch · ${d.callID.slice(0, 12)}`,
            sessionDirectory,
          )
          const actions = buildChildSessionBranchActions(msgs, {
            branchChildSessionID: d.childSessionID,
            parentTaskCallID: d.callID,
            anchorSortTime: d.anchorSortTime,
            /** 按 session 固定分配进程带：第 1 个唯一子 session=1，第 2 个=2 ... */
            sessionBandIndex: childSessionBandMap.get(d.childSessionID) ?? 1,
            nowMs: nowTick,
          })
          return { msgs, actions }
        } catch {
          return {
            msgs: [] as OcMessage[],
            actions: [] as (MappedAction & { row: number })[],
          }
        }
      }),
    )
    setChildBranchActions(results.flatMap((r) => r.actions))
    setChildBranchMessages(results.flatMap((r) => r.msgs))
  }, [taskDescriptors, sessionDirectory, childSessionBandMap, nowTick])

  useEffect(() => {
    void loadChildBranches()
  }, [loadChildBranches])

  useEffect(() => {
    if (!hasRunningTaskWithChild) return
    const id = window.setInterval(() => {
      void loadChildBranches()
    }, 3200)
    return () => window.clearInterval(id)
  }, [hasRunningTaskWithChild, loadChildBranches])

  const flowActions = useMemo(() => {
    const merged = [...parentFlowActions, ...childBranchActions].sort((a, b) => a.sortTime - b.sortTime)
    return applyParallelLayoutFromCalls(merged, parallelByCallId)
  }, [parentFlowActions, childBranchActions, parallelByCallId])

  /** 与 `flowActions` 中 `partId` 查找一致：父段消息 + 子会话拉取消息 */
  const tooltipLookupMessages = useMemo(
    () => mergeMessagesForActionTooltipLookup(segmentMessages, childBranchMessages),
    [segmentMessages, childBranchMessages]
  )
  const hasActiveRunningAction = useMemo(
    () => flowActions.some((a) => a.status === 'running' || a.status === 'pending'),
    [flowActions],
  )
  const hasLongRunningAction = useMemo(
    () => flowActions.some((a) => (a.status === 'running' || a.status === 'pending') && a.durationMs >= LONG_RUNNING_MS),
    [flowActions],
  )

  useEffect(() => {
    if (!hasActiveRunningAction) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasActiveRunningAction])

  const durationLabel = formatDurationMs(m.durationMs)
  const changesLabel = String(m.mutatedFileCount)

  return (
    <div
      data-subtask-card-index={cardIndex ?? displayIndex}
      onClick={() => onSelectSubtask?.()}
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        minHeight: CARD_MIN_HEIGHT,
        height: 'auto',
        flexShrink: 0,
        padding: '12px 14px',
        gap: 4,
        width: '100%',
        background: '#FCFCFC',
        borderRadius: 14,
        marginBottom: 8,
        fontFamily: fontSans,
        overflow: 'visible',
        cursor: onSelectSubtask ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
        border: hasLongRunningAction
          ? (isLinked ? '2px solid #FF6B6B' : '1px solid #FF6B6B')
          : (isLinked ? `2px solid ${actionFlowPalette.green.stroke}` : '1px solid #DBDBDB'),
        boxShadow: isLinked
          ? `0 0 0 3px rgba(145, 163, 123, 0.22)`
          : 'none',
      }}
    >
      <h3
        style={{
          margin: 0,
          fontWeight: 600,
          fontSize: 13,
          lineHeight: '18px',
          color: '#2B2B2B',
          flexShrink: 0,
        }}
      >
        {m.title}
      </h3>

      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          width: '100%',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '14px', color: '#2B2B2B' }}>
            Actions&apos; duration
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={actionsDurationOn}
            onClick={() => setActionsDurationOn(v => !v)}
            style={{
              width: 26,
              height: 13,
              borderRadius: 80,
              background: actionsDurationOn ? '#2B2B2B' : '#8A8A8A',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: actionsDurationOn ? 'flex-end' : 'flex-start',
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: '#FFFFFF',
                display: 'block',
                flexShrink: 0,
              }}
            />
          </button>
        </div>

        <div
          style={{
            width: 1,
            height: 14,
            background: '#DBDBDB',
            flexShrink: 0,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '14px', color: '#2B2B2B' }}>
            Actions&apos; color
          </span>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={() => setColorBy('status')}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: fontSans,
                fontSize: 11,
                lineHeight: '16px',
                color: '#2B2B2B',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  boxSizing: 'border-box',
                  background: colorBy === 'status' ? '#C6C6C6' : 'transparent',
                  border: colorBy === 'status' ? '1px solid #8A8A8A' : '1px solid #C6C6C6',
                }}
              />
              status
            </button>
            <button
              type="button"
              onClick={() => setColorBy('tokens')}
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: fontSans,
                fontSize: 11,
                lineHeight: '16px',
                color: colorBy === 'tokens' ? '#2B2B2B' : '#C6C6C6',
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  boxSizing: 'border-box',
                  background: colorBy === 'tokens' ? '#C6C6C6' : 'transparent',
                  border: colorBy === 'tokens' ? '1px solid #8A8A8A' : '1px solid #C6C6C6',
                }}
              />
              tokens
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: '0 0 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ActionFlowVisualization
          actions={flowActions}
          durationMode={actionsDurationOn}
          colorMode={colorBy === 'status' ? 'status' : 'tokens'}
          tooltipMessages={tooltipLookupMessages}
          onForkFromAction={onForkFromAction}
          onAnalyzeFromAction={onAnalyzeFromAction}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'nowrap',
          alignItems: 'stretch',
          gap: 6,
          width: '100%',
          flexShrink: 0,
        }}
      >
        <MetricBox label="Agent Msg" value={String(m.llmCallCount)} />
        <MetricBox label="Changes" value={changesLabel} />
        <MetricBox label="Time" value={durationLabel} alert={hasLongRunningAction} />
        <MetricBox label="Total Tokens" value={String(m.tokensSegmentSum)} />
        <MetricBox label="Cost" value={formatSubtaskCostDisplay(m)} />
      </div>
    </div>
  )
}
