/** Experiment telemetry schemas (local user-study metrics). */

/** UI regions whose first user touch (click / scroll / send) we record. */
export type ExperimentRegion = 'chat' | 'trajectory' | 'todo' | 'skill'

/** ISO timestamp of first interaction per region; null if never touched. */
export type FirstInteractionAt = Record<ExperimentRegion, string | null>

export type ExperimentCounters = {
  /** Manual “New session” clicks (excludes mw-internal). */
  manualSessionsCreated: number
  /** User→assistant conversation turns completed (user sends count as proxy). */
  conversationTurns: number
  /** Debounced scroll bursts in the middle chat panel. */
  chatPanelScrolls: number
  /** Debounced scroll bursts in the right trajectory panel. */
  trajectoryPanelScrolls: number
  /** Clicks / selections inside the right trajectory panel (excl. tooltip). */
  trajectoryPanelClicks: number
  /** Todo panel item clicks (used to link/filter right-side panels). */
  todoClicks: number
  /** Action-node tooltips that actually opened (timeline + summary blocks). */
  actionTooltipShows: number
  /** Flow-end yellow “summary” node tooltips that opened. */
  flowEndSummaryTooltipShows: number
  /** Unique trajectory / subtask panels the user opened (clicked). */
  trajectoriesViewed: number
  /** Unique task tabs that existed or were selected during the experiment. */
  taskTabsSeen: number
  /** Successful skill distill operations. */
  skillsDistilled: number
  /** Confirmed forks from an action. */
  forksCompleted: number
  /** Clicks that open a skill detail from the Skill Panel. */
  skillPanelClicks: number
  /** Unique subtask / trace panels generated (observed) during the experiment. */
  subtaskPanelsGenerated: number
  /** Cumulative ms pointer was over the middle chat column. */
  chatPanelFocusMs: number
  /** Cumulative ms pointer was over the right VibeTrace column. */
  trajectoryPanelFocusMs: number
}

export type ExperimentEventName =
  | 'experiment.start'
  | 'experiment.end'
  | 'session.create'
  | 'chat.turn'
  | 'chat.scroll'
  | 'trajectory.scroll'
  | 'trajectory.click'
  | 'todo.click'
  | 'tooltip.action'
  | 'tooltip.flow_end_summary'
  | 'trajectory.view'
  | 'task_tab.seen'
  | 'task_tab.select'
  | 'skill.distill'
  | 'fork.complete'
  | 'skill.panel_click'
  | 'subtask.generated'
  | 'panel.focus'
  | 'region.first'

export type ExperimentEvent = {
  ts: string
  event: ExperimentEventName
  sessionId?: string
  directory?: string
  props?: Record<string, unknown>
}

export type ExperimentReport = {
  schemaVersion: 'experiment.report.v1'
  participantId: string
  experimentId: string
  directory: string
  startedAt: string
  endedAt: string
  durationMs: number
  /** Session ids touched during the experiment (manual + forked; never mw-internal). */
  sessionIds: string[]
  counters: ExperimentCounters
  /**
   * First click/scroll/send timestamp per UI region (ISO), or null if unused.
   * Sort these (or use derived.firstInteractionOrder) to recover discovery order.
   */
  firstInteractionAt: FirstInteractionAt
  /** Derived ratios for convenience. */
  derived: {
    chatFocusRatio: number | null
    trajectoryFocusRatio: number | null
    chatScrollShare: number | null
    trajectoryInteractionShare: number | null
    /** Regions ordered by firstInteractionAt (earliest first); untouched omitted. */
    firstInteractionOrder: ExperimentRegion[]
    /** ms from experiment start to first touch; null if never touched. */
    firstInteractionMs: Record<ExperimentRegion, number | null>
  }
  /** Recent event log (capped). */
  events: ExperimentEvent[]
  notes?: string
}

export type ExperimentSnapshot = {
  active: boolean
  participantId: string
  experimentId: string
  directory: string
  startedAt: string
  sessionIds: string[]
  seenTrajectoryIds: string[]
  seenTaskTabIds: string[]
  seenSubtaskIds: string[]
  counters: ExperimentCounters
  firstInteractionAt: FirstInteractionAt
  events: ExperimentEvent[]
  /** Wall-clock when focus entered a panel (ms). */
  focusStartedAt: number | null
  focusPanel: 'chat' | 'trajectory' | null
}

export const EXPERIMENT_REGIONS: ExperimentRegion[] = ['chat', 'trajectory', 'todo', 'skill']

export function emptyFirstInteractionAt(): FirstInteractionAt {
  return {
    chat: null,
    trajectory: null,
    todo: null,
    skill: null,
  }
}

export function emptyCounters(): ExperimentCounters {
  return {
    manualSessionsCreated: 0,
    conversationTurns: 0,
    chatPanelScrolls: 0,
    trajectoryPanelScrolls: 0,
    trajectoryPanelClicks: 0,
    todoClicks: 0,
    actionTooltipShows: 0,
    flowEndSummaryTooltipShows: 0,
    trajectoriesViewed: 0,
    taskTabsSeen: 0,
    skillsDistilled: 0,
    forksCompleted: 0,
    skillPanelClicks: 0,
    subtaskPanelsGenerated: 0,
    chatPanelFocusMs: 0,
    trajectoryPanelFocusMs: 0,
  }
}
