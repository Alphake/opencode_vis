import type { MemoryWorkerTaskSegment, MemoryWorkerTaskSegmentTab } from '../services/memoryWorkerApi'

export type TaskSegmentStatus = 'pending' | 'extracted'

export type TaskSegmentTab = {
  id: string
  status: TaskSegmentStatus
  fromStartUserMessageId: string
  fromEndAssistantMessageId: string
  toEndAssistantMessageId: string
  turnCount: number
  title?: string
  description?: string
  summary?: string
  taskSwitchRunDir?: string
  pipelineRunDir?: string
}

export function taskSegmentId(status: TaskSegmentStatus, segment: MemoryWorkerTaskSegment): string {
  return segment.taskId || `${status}:${segment.fromEndAssistantMessageId}:${segment.toEndAssistantMessageId}`
}

export function taskSegmentFromWorker(
  status: TaskSegmentStatus,
  segment: MemoryWorkerTaskSegment,
  meta?: Pick<TaskSegmentTab, 'taskSwitchRunDir' | 'pipelineRunDir'>,
): TaskSegmentTab | null {
  if (!segment.fromStartUserMessageId || !segment.toEndAssistantMessageId) return null
  return {
    id: taskSegmentId(status, segment),
    status,
    fromStartUserMessageId: segment.fromStartUserMessageId,
    fromEndAssistantMessageId: segment.fromEndAssistantMessageId,
    toEndAssistantMessageId: segment.toEndAssistantMessageId,
    turnCount: segment.turnCount,
    title: segment.title?.trim() || undefined,
    description: segment.description?.trim() || undefined,
    summary: segment.summary?.trim() || undefined,
    ...meta,
  }
}

export function taskSegmentTabFromWorkerRecord(tab: MemoryWorkerTaskSegmentTab): TaskSegmentTab | null {
  const status = tab.status === 'extracted' ? 'extracted' : 'pending'
  const segment: MemoryWorkerTaskSegment = {
    taskId: tab.taskId,
    fromStartUserMessageId: tab.fromStartUserMessageId,
    fromEndAssistantMessageId: tab.fromEndAssistantMessageId,
    toEndAssistantMessageId: tab.toEndAssistantMessageId,
    turnCount: tab.turnCount,
    title: tab.title,
    description: tab.description,
    summary: tab.summary,
  }
  return taskSegmentFromWorker(status, segment, {
    taskSwitchRunDir: tab.taskSwitchRunDir,
    pipelineRunDir: tab.pipelineRunDir,
  })
}

export function taskSegmentTabsFromWorkerBatch(tabs: MemoryWorkerTaskSegmentTab[]): TaskSegmentTab[] {
  const out: TaskSegmentTab[] = []
  for (const tab of tabs) {
    const converted = taskSegmentTabFromWorkerRecord(tab)
    if (converted) out.push(converted)
  }
  return out
}

export function mergeTaskTabFields(prior: TaskSegmentTab, incoming: TaskSegmentTab): TaskSegmentTab {
  const merged: TaskSegmentTab = { ...prior, ...incoming }
  if (!incoming.title?.trim()) merged.title = prior.title
  if (!incoming.description?.trim()) merged.description = prior.description
  if (!incoming.summary?.trim()) merged.summary = prior.summary
  if (!incoming.taskSwitchRunDir?.trim()) merged.taskSwitchRunDir = prior.taskSwitchRunDir
  if (!incoming.pipelineRunDir?.trim()) merged.pipelineRunDir = prior.pipelineRunDir
  return merged
}

export function mergeTaskSegmentTabs(
  existing: TaskSegmentTab[],
  incoming: TaskSegmentTab[],
  options?: { taskSwitched?: boolean },
): TaskSegmentTab[] {
  const byId = new Map(existing.map((tab) => [tab.id, tab]))
  const taskSwitched = options?.taskSwitched ?? false
  for (const tab of incoming) {
    if (tab.status === 'pending') {
      for (const [id, old] of byId) {
        if (old.status !== 'pending') continue
        if (taskSwitched) {
          byId.set(id, { ...old, status: 'extracted' })
        } else {
          byId.delete(id)
        }
      }
    }
    const prior = byId.get(tab.id)
    byId.set(tab.id, prior ? mergeTaskTabFields(prior, tab) : tab)
  }
  return [...byId.values()]
}

export function cloneTaskSegmentTabs(tabs: TaskSegmentTab[]): TaskSegmentTab[] {
  return tabs.map((tab) => ({ ...tab }))
}
