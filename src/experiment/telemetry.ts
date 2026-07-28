import { STORAGE_KEYS } from '../config/storageKeys'
import {
  emptyCounters,
  emptyFirstInteractionAt,
  EXPERIMENT_REGIONS,
  type ExperimentCounters,
  type ExperimentEvent,
  type ExperimentEventName,
  type ExperimentRegion,
  type ExperimentReport,
  type ExperimentSnapshot,
  type FirstInteractionAt,
} from './types'

const LS_KEY = STORAGE_KEYS.experimentActive
const MAX_EVENTS = 2000

type Listener = (snap: ExperimentSnapshot | null) => void

function nowIso(): string {
  return new Date().toISOString()
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

function loadSnapshot(): ExperimentSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ExperimentSnapshot
    if (!parsed?.active || !parsed.experimentId) return null
    return {
      ...parsed,
      counters: { ...emptyCounters(), ...parsed.counters },
      firstInteractionAt: {
        ...emptyFirstInteractionAt(),
        ...(parsed.firstInteractionAt || {}),
      },
      sessionIds: Array.isArray(parsed.sessionIds) ? parsed.sessionIds : [],
      seenTrajectoryIds: Array.isArray(parsed.seenTrajectoryIds) ? parsed.seenTrajectoryIds : [],
      seenTaskTabIds: Array.isArray(parsed.seenTaskTabIds) ? parsed.seenTaskTabIds : [],
      seenSubtaskIds: Array.isArray(parsed.seenSubtaskIds) ? parsed.seenSubtaskIds : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      focusStartedAt: null,
      focusPanel: null,
    }
  } catch {
    return null
  }
}

function persist(snap: ExperimentSnapshot | null) {
  try {
    if (!snap) {
      localStorage.removeItem(LS_KEY)
      return
    }
    const toStore: ExperimentSnapshot = {
      ...snap,
      focusStartedAt: null,
      focusPanel: null,
    }
    localStorage.setItem(LS_KEY, JSON.stringify(toStore))
  } catch {
    /* ignore quota */
  }
}

function buildFirstInteractionDerived(
  startedAt: string,
  first: FirstInteractionAt,
): {
  firstInteractionOrder: ExperimentRegion[]
  firstInteractionMs: Record<ExperimentRegion, number | null>
} {
  const startedMs = Date.parse(startedAt)
  const firstInteractionMs = {} as Record<ExperimentRegion, number | null>
  const timed: { region: ExperimentRegion; ms: number }[] = []
  for (const region of EXPERIMENT_REGIONS) {
    const at = first[region]
    if (!at) {
      firstInteractionMs[region] = null
      continue
    }
    const t = Date.parse(at)
    const ms =
      Number.isFinite(startedMs) && Number.isFinite(t) ? Math.max(0, t - startedMs) : null
    firstInteractionMs[region] = ms
    if (ms != null) timed.push({ region, ms })
  }
  timed.sort((a, b) => a.ms - b.ms)
  return {
    firstInteractionOrder: timed.map((x) => x.region),
    firstInteractionMs,
  }
}

function buildDerived(
  c: ExperimentCounters,
  startedAt: string,
  first: FirstInteractionAt,
) {
  const focusTotal = c.chatPanelFocusMs + c.trajectoryPanelFocusMs
  const scrollTotal = c.chatPanelScrolls + c.trajectoryPanelScrolls
  const rightOps =
    c.trajectoryPanelClicks +
    c.actionTooltipShows +
    c.flowEndSummaryTooltipShows +
    c.todoClicks +
    c.skillPanelClicks
  const leftOps = c.chatPanelScrolls + c.conversationTurns
  const interactionTotal = leftOps + rightOps
  const firstDerived = buildFirstInteractionDerived(startedAt, first)
  return {
    chatFocusRatio: focusTotal > 0 ? c.chatPanelFocusMs / focusTotal : null,
    trajectoryFocusRatio: focusTotal > 0 ? c.trajectoryPanelFocusMs / focusTotal : null,
    chatScrollShare: scrollTotal > 0 ? c.chatPanelScrolls / scrollTotal : null,
    trajectoryInteractionShare: interactionTotal > 0 ? rightOps / interactionTotal : null,
    ...firstDerived,
  }
}

class ExperimentTelemetry {
  private snap: ExperimentSnapshot | null = loadSnapshot()
  private listeners = new Set<Listener>()
  private scrollTimers: Record<string, number | null> = { chat: null, trajectory: null }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snap)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    persist(this.snap)
    for (const fn of this.listeners) fn(this.snap)
  }

  getSnapshot(): ExperimentSnapshot | null {
    return this.snap
  }

  isActive(): boolean {
    return Boolean(this.snap?.active)
  }

  start(opts: { participantId: string; directory: string }): ExperimentSnapshot {
    const participantId = opts.participantId.trim() || 'P00'
    const directory = opts.directory.trim()
    if (!directory) {
      throw new Error('Select a workspace folder before starting the experiment.')
    }
    this.flushFocus()
    this.snap = {
      active: true,
      participantId,
      experimentId: newId('exp'),
      directory,
      startedAt: nowIso(),
      sessionIds: [],
      seenTrajectoryIds: [],
      seenTaskTabIds: [],
      seenSubtaskIds: [],
      counters: emptyCounters(),
      firstInteractionAt: emptyFirstInteractionAt(),
      events: [],
      focusStartedAt: null,
      focusPanel: null,
    }
    this.track('experiment.start', undefined, { participantId, directory })
    this.emit()
    return this.snap
  }

  /** Build final report and clear active state. Caller writes the file. */
  end(notes?: string): ExperimentReport | null {
    if (!this.snap?.active) return null
    this.flushFocus()
    const endedAt = nowIso()
    const startedMs = Date.parse(this.snap.startedAt)
    const endedMs = Date.parse(endedAt)
    this.track('experiment.end', undefined, { notes: notes || undefined })
    const report: ExperimentReport = {
      schemaVersion: 'experiment.report.v1',
      participantId: this.snap.participantId,
      experimentId: this.snap.experimentId,
      directory: this.snap.directory,
      startedAt: this.snap.startedAt,
      endedAt,
      durationMs: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0,
      sessionIds: [...this.snap.sessionIds],
      counters: { ...this.snap.counters },
      firstInteractionAt: { ...this.snap.firstInteractionAt },
      derived: buildDerived(this.snap.counters, this.snap.startedAt, this.snap.firstInteractionAt),
      events: [...this.snap.events],
      notes: notes?.trim() || undefined,
    }
    this.snap = null
    this.emit()
    return report
  }

  track(event: ExperimentEventName, sessionId?: string, props?: Record<string, unknown>) {
    if (!this.snap?.active) return
    const entry: ExperimentEvent = {
      ts: nowIso(),
      event,
      sessionId: sessionId || undefined,
      directory: this.snap.directory,
      props: props && Object.keys(props).length ? props : undefined,
    }
    this.snap.events.push(entry)
    if (this.snap.events.length > MAX_EVENTS) {
      this.snap.events.splice(0, this.snap.events.length - MAX_EVENTS)
    }
    this.emit()
  }

  private bump(key: keyof ExperimentCounters, by = 1) {
    if (!this.snap?.active) return
    this.snap.counters[key] = (this.snap.counters[key] || 0) + by
  }

  /** Record first click/scroll/send for a UI region (idempotent). */
  private markFirst(region: ExperimentRegion, via: string) {
    if (!this.snap?.active) return
    if (this.snap.firstInteractionAt[region]) return
    const at = nowIso()
    this.snap.firstInteractionAt[region] = at
    this.track('region.first', undefined, { region, via })
  }

  private noteSession(sessionId: string | undefined) {
    if (!this.snap?.active || !sessionId) return
    if (!this.snap.sessionIds.includes(sessionId)) {
      this.snap.sessionIds.push(sessionId)
    }
  }

  /** Manual New Session button. */
  onManualSessionCreate(sessionId: string) {
    if (!this.isActive()) return
    this.bump('manualSessionsCreated')
    this.noteSession(sessionId)
    this.track('session.create', sessionId)
  }

  /** User sent a message (counts as one conversation turn start). */
  onConversationTurn(sessionId: string) {
    if (!this.isActive()) return
    this.bump('conversationTurns')
    this.noteSession(sessionId)
    this.markFirst('chat', 'chat.turn')
    this.track('chat.turn', sessionId)
  }

  /** Debounced scroll burst. */
  onScroll(panel: 'chat' | 'trajectory', sessionId?: string) {
    if (!this.isActive()) return
    const key = panel
    if (this.scrollTimers[key]) return
    this.scrollTimers[key] = window.setTimeout(() => {
      this.scrollTimers[key] = null
    }, 400)
    if (panel === 'chat') {
      this.bump('chatPanelScrolls')
      this.markFirst('chat', 'chat.scroll')
      this.track('chat.scroll', sessionId)
    } else {
      this.bump('trajectoryPanelScrolls')
      this.markFirst('trajectory', 'trajectory.scroll')
      this.track('trajectory.scroll', sessionId)
    }
  }

  onTodoClick(sessionId?: string, todoId?: string) {
    if (!this.isActive()) return
    this.bump('todoClicks')
    this.markFirst('todo', 'todo.click')
    this.track('todo.click', sessionId, todoId ? { todoId } : undefined)
  }

  onTrajectoryClick(sessionId?: string, props?: Record<string, unknown>) {
    if (!this.isActive()) return
    this.bump('trajectoryPanelClicks')
    this.markFirst('trajectory', 'trajectory.click')
    this.track('trajectory.click', sessionId, props)
  }

  /** User selected a subtask card (trajectory view). */
  onTrajectoryView(subtaskId: string, sessionId?: string) {
    if (!this.isActive() || !subtaskId) return
    if (this.snap!.seenTrajectoryIds.includes(subtaskId)) {
      this.onTrajectoryClick(sessionId, { subtaskId, revisit: true })
      return
    }
    this.snap!.seenTrajectoryIds.push(subtaskId)
    this.snap!.counters.trajectoriesViewed = this.snap!.seenTrajectoryIds.length
    this.markFirst('trajectory', 'trajectory.view')
    this.track('trajectory.view', sessionId, { subtaskId })
    this.onTrajectoryClick(sessionId, { subtaskId, firstView: true })
  }

  onActionTooltipShow(sessionId?: string, source?: string) {
    if (!this.isActive()) return
    this.bump('actionTooltipShows')
    this.markFirst('trajectory', 'tooltip.action')
    this.track('tooltip.action', sessionId, source ? { source } : undefined)
  }

  onFlowEndSummaryTooltipShow(sessionId?: string) {
    if (!this.isActive()) return
    this.bump('flowEndSummaryTooltipShows')
    this.markFirst('trajectory', 'tooltip.flow_end_summary')
    this.track('tooltip.flow_end_summary', sessionId)
  }

  onTaskTabSeen(taskTabId: string, sessionId?: string) {
    if (!this.isActive() || !taskTabId) return
    if (this.snap!.seenTaskTabIds.includes(taskTabId)) return
    this.snap!.seenTaskTabIds.push(taskTabId)
    this.snap!.counters.taskTabsSeen = this.snap!.seenTaskTabIds.length
    this.track('task_tab.seen', sessionId, { taskTabId })
  }

  onTaskTabSelect(taskTabId: string, sessionId?: string) {
    if (!this.isActive()) return
    this.onTaskTabSeen(taskTabId, sessionId)
    this.bump('trajectoryPanelClicks')
    this.markFirst('trajectory', 'task_tab.select')
    this.track('task_tab.select', sessionId, { taskTabId })
  }

  onSkillDistill(sessionId?: string, skillName?: string) {
    if (!this.isActive()) return
    this.bump('skillsDistilled')
    this.markFirst('skill', 'skill.distill')
    this.track('skill.distill', sessionId, skillName ? { skillName } : undefined)
  }

  onForkComplete(sessionId?: string, forkedSessionId?: string) {
    if (!this.isActive()) return
    this.bump('forksCompleted')
    if (forkedSessionId) this.noteSession(forkedSessionId)
    this.track('fork.complete', sessionId, forkedSessionId ? { forkedSessionId } : undefined)
  }

  onSkillPanelClick(sessionId?: string, skillKey?: string) {
    if (!this.isActive()) return
    this.bump('skillPanelClicks')
    this.markFirst('skill', 'skill.panel_click')
    this.track('skill.panel_click', sessionId, skillKey ? { skillKey } : undefined)
  }

  /** Observe generated subtask / trace panels (unique ids). */
  onSubtasksObserved(subtaskIds: string[], sessionId?: string) {
    if (!this.isActive()) return
    let added = 0
    for (const id of subtaskIds) {
      if (!id || this.snap!.seenSubtaskIds.includes(id)) continue
      this.snap!.seenSubtaskIds.push(id)
      added += 1
    }
    if (added === 0) return
    this.snap!.counters.subtaskPanelsGenerated = this.snap!.seenSubtaskIds.length
    this.track('subtask.generated', sessionId, { added, total: this.snap!.seenSubtaskIds.length })
  }

  enterPanelFocus(panel: 'chat' | 'trajectory') {
    if (!this.isActive()) return
    this.flushFocus()
    this.snap!.focusPanel = panel
    this.snap!.focusStartedAt = Date.now()
  }

  leavePanelFocus(panel: 'chat' | 'trajectory') {
    if (!this.isActive()) return
    if (this.snap!.focusPanel === panel) this.flushFocus()
  }

  private flushFocus() {
    if (!this.snap?.active || !this.snap.focusPanel || !this.snap.focusStartedAt) {
      if (this.snap) {
        this.snap.focusPanel = null
        this.snap.focusStartedAt = null
      }
      return
    }
    const ms = Math.max(0, Date.now() - this.snap.focusStartedAt)
    if (this.snap.focusPanel === 'chat') this.bump('chatPanelFocusMs', ms)
    else this.bump('trajectoryPanelFocusMs', ms)
    this.track('panel.focus', undefined, { panel: this.snap.focusPanel, ms })
    this.snap.focusPanel = null
    this.snap.focusStartedAt = null
  }
}

export const experimentTelemetry = new ExperimentTelemetry()

export function downloadReportFallback(report: ExperimentReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safePid = report.participantId.replace(/[^\w.-]+/g, '_')
  a.href = url
  a.download = `vibetrace-experiment-${safePid}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
