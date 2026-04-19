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
import type { ForkFromActionContext, ForkPanelSnapshotBundle } from '../utils/forkPanelSnapshot'
import { mergeMessagesForActionTooltipLookup } from '../utils/actionTooltipMapping'
import ActionFlowVisualization from './ActionFlowVisualization'
import { actionFlowPalette } from '../styles/actionFlowPalette'
import { getMessages } from '../services/opencodeApi'

const fontSans =
  "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif"

/** 子任务卡片最小高度；内容（如分叉可视化）变高时卡片随内容增高 */
const CARD_MIN_HEIGHT = 220
/** Fork 双栏：单行 lane 可视上限；略抬高减少误触纵向滚动（边框不再占内容区后仍留余量） */
const FORK_LANE_VIEWPORT_MAX_PX = 178
const FORK_PANEL_OUTER_MAX_PX = 370
const LONG_RUNNING_MS = 60_000

interface SubtaskCardProps {
  subtask: AssistantSubtask
  messages: OcMessage[]
  displayIndex: number
  /** DOM 定位索引：用于连线/滚动，需与 App 中 linkedSubtaskIndex 使用同一坐标系 */
  cardIndex?: number
  isLinked?: boolean
  onSelectSubtask?: () => void
  onForkFromAction?: (action: MappedAction & { row: number }, ctx: ForkFromActionContext) => void
  onAnalyzeFromAction?: (action: MappedAction & { row: number }) => void
  /** 与 OpenCode 多目录一致，拉取子会话消息时必带 */
  sessionDirectory?: string
  /** Forked session: local read-only snapshot for comparison (not in model context) */
  forkPanelSnapshotBundle?: ForkPanelSnapshotBundle | null
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
  forkPanelSnapshotBundle = null,
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
          const branchOpts = {
            branchChildSessionID: d.childSessionID,
            parentTaskCallID: d.callID,
            anchorSortTime: d.anchorSortTime,
            /** 按 session 固定分配进程带：第 1 个唯一子 session=1，第 2 个=2 ... */
            sessionBandIndex: childSessionBandMap.get(d.childSessionID) ?? 1,
            nowMs: nowTick,
          }
          const actions = buildChildSessionBranchActions(msgs, branchOpts)
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

  const durationDomain = useMemo(() => {
    const vals = flowActions
      .map((a) => a.durationMs)
      .filter((v): v is number => Number.isFinite(v) && v >= 0)
    if (!vals.length) return null
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }, [flowActions])
  const [durationHighlightMinMs, setDurationHighlightMinMs] = useState(0)
  useEffect(() => {
    if (!durationDomain) {
      setDurationHighlightMinMs(0)
      return
    }
    setDurationHighlightMinMs((prev) => {
      if (prev < durationDomain.min || prev > durationDomain.max) return durationDomain.min
      return prev
    })
  }, [durationDomain])
  const durationHighlightStep = useMemo(() => {
    if (!durationDomain) return 1
    return Math.max(1, Math.round((durationDomain.max - durationDomain.min) / 240))
  }, [durationDomain])
  const matchedLongActionCount = useMemo(() => {
    if (!durationDomain) return flowActions.length
    return flowActions.filter(
      (a) => Number.isFinite(a.durationMs) && a.durationMs >= durationHighlightMinMs
    ).length
  }, [flowActions, durationDomain, durationHighlightMinMs])
  /** 仅当用户把阈值高于数据下界时才暗化/蓝环；停在默认下界时与未筛选一致 */
  const durationHighlightForFlow =
    durationDomain != null && durationHighlightMinMs > durationDomain.min
      ? durationHighlightMinMs
      : null

  /** Fork 后：同一滚动面板内上下两栏 — 灰历史快照 / 当前会话（便于对照） */
  const forkStackLanes = useMemo(() => {
    if (!forkPanelSnapshotBundle || forkPanelSnapshotBundle.version !== 2) {
      return null
    }
    const b = forkPanelSnapshotBundle
    if (b.forkOriginSubtaskId !== subtask.subtask_id && b.forkOriginDisplayIndex !== displayIndex) {
      return null
    }
    return {
      historyActions: b.snapshot.flowActions.map((a) => ({ ...a, forkGhost: true })),
      historyTooltips: b.snapshot.tooltipMessages,
    }
  }, [forkPanelSnapshotBundle, subtask.subtask_id, displayIndex])

  /** 与 `flowActions` 中 `partId` 查找一致：父段消息 + 子会话拉取消息 */
  const tooltipLookupMessages = useMemo(
    () => mergeMessagesForActionTooltipLookup(segmentMessages, childBranchMessages),
    [segmentMessages, childBranchMessages],
  )
  const hasActiveRunningAction = useMemo(
    () => flowActions.some((a) => a.status === 'running' || a.status === 'pending'),
    [flowActions],
  )
  const hasLongRunningAction = useMemo(
    () =>
      flowActions.some(
        (a) => (a.status === 'running' || a.status === 'pending') && a.durationMs >= LONG_RUNNING_MS,
      ),
    [flowActions],
  )

  useEffect(() => {
    if (!hasActiveRunningAction) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [hasActiveRunningAction])

  const durationLabel = formatDurationMs(m.durationMs)
  const changesLabel = String(m.mutatedFileCount)
  /** 无进行中 action 时才显示流程终点黄点（避免子任务一开始就出现「收尾」） */
  const showFlowEndNode = !hasActiveRunningAction && flowActions.length > 0

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
          flexWrap: 'nowrap',
          gap: 10,
          width: '100%',
          flexShrink: 0,
          minWidth: 0,
          overflowX: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '14px', color: '#2B2B2B' }}>
            Actions duration
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

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 400, lineHeight: '14px', color: '#2B2B2B' }}>
            Actions color
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

        {durationDomain && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              flexShrink: 1,
              marginLeft: 'auto',
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                lineHeight: '12px',
                color: '#6A6A6A',
                flexShrink: 0,
              }}
            >
              Filter
            </span>
            <input
              className="subtask-card-duration-filter-range"
              type="range"
              min={durationDomain.min}
              max={durationDomain.max}
              step={durationHighlightStep}
              value={durationHighlightMinMs}
              onChange={(e) => setDurationHighlightMinMs(Number(e.target.value))}
              title="Time filter — minimum duration to highlight"
              aria-label="Time filter: minimum duration to highlight"
              style={{
                width: 120,
                minWidth: 64,
                maxWidth: 200,
                flex: '1 1 80px',
                height: 14,
                verticalAlign: 'middle',
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 500,
                lineHeight: '12px',
                color: '#6A6A6A',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {formatDurationMs(durationHighlightMinMs)} · {matchedLongActionCount}/{flowActions.length}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          flex: '0 0 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {forkStackLanes ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              boxSizing: 'border-box',
              overflow: 'auto',
              border: '1px solid #E8E8E8',
              borderRadius: 8,
              background: '#FCFCFC',
              width: '100%',
              maxHeight: FORK_PANEL_OUTER_MAX_PX,
              minHeight: 0,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}
          >
            {/*
              同一 panel 内上下两行：上行灰色历史（独立 SVG 链路），下行当前会话（独立 SVG），互不连线
            */}
            <div
              style={{
                flexShrink: 0,
                background: '#EDEDED',
                padding: '2px 4px',
              }}
            >
              <ActionFlowVisualization
                embedded
                viewportMaxHeight={FORK_LANE_VIEWPORT_MAX_PX}
                actions={forkStackLanes.historyActions}
                durationMode={actionsDurationOn}
                colorMode={colorBy === 'status' ? 'status' : 'tokens'}
                tooltipMessages={forkStackLanes.historyTooltips}
                showFlowEndNode={false}
              />
            </div>
            <div style={{ flexShrink: 0, background: '#FCFCFC', padding: '2px 4px' }}>
              <ActionFlowVisualization
                embedded
                viewportMaxHeight={FORK_LANE_VIEWPORT_MAX_PX}
                actions={flowActions}
                durationMode={actionsDurationOn}
                colorMode={colorBy === 'status' ? 'status' : 'tokens'}
                durationHighlightMinMs={durationHighlightForFlow}
                tooltipMessages={tooltipLookupMessages}
                onForkFromAction={
                  onForkFromAction
                    ? (act) =>
                        onForkFromAction(act, {
                          subtaskId: subtask.subtask_id,
                          subtaskDisplayIndex: displayIndex,
                          assistantMessageIndices: subtask.assistantMessageIndices,
                        })
                    : undefined
                }
                onAnalyzeFromAction={onAnalyzeFromAction}
                showFlowEndNode={showFlowEndNode}
                flowEndSummary={{
                  readFileTotalCount: m.readFilesCount,
                  readFilePaths: m.readFilePaths,
                  globMatchFileCount: m.globMatchFileCount,
                  webSearchCount: m.webSearchCallCount,
                  webSearchQueries: m.webSearchQueries,
                  writeFileCount: m.mutatedFileCount,
                  changedFilePaths: m.mutatedFilePaths,
                }}
              />
            </div>
          </div>
        ) : (
          <ActionFlowVisualization
            actions={flowActions}
            durationMode={actionsDurationOn}
            colorMode={colorBy === 'status' ? 'status' : 'tokens'}
            durationHighlightMinMs={durationHighlightForFlow}
            tooltipMessages={tooltipLookupMessages}
            onForkFromAction={
              onForkFromAction
                ? (act) =>
                    onForkFromAction(act, {
                      subtaskId: subtask.subtask_id,
                      subtaskDisplayIndex: displayIndex,
                      assistantMessageIndices: subtask.assistantMessageIndices,
                    })
                : undefined
            }
            onAnalyzeFromAction={onAnalyzeFromAction}
            showFlowEndNode={showFlowEndNode}
            flowEndSummary={{
              readFileTotalCount: m.readFilesCount,
              readFilePaths: m.readFilePaths,
              globMatchFileCount: m.globMatchFileCount,
              webSearchCount: m.webSearchCallCount,
              webSearchQueries: m.webSearchQueries,
              writeFileCount: m.mutatedFileCount,
              changedFilePaths: m.mutatedFilePaths,
            }}
          />
        )}
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
