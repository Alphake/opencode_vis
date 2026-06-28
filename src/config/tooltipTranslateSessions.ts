/** Session ids whose tooltip *values* are auto-translated to English (labels stay English). */
const DEFAULT_TOOLTIP_TRANSLATE_SESSION_IDS = ['ses_1100d36baffe9pELzCzwrzi89w'] as const

function sessionIdsFromEnv(): Set<string> | null {
  const raw = import.meta.env.VITE_TOOLTIP_TRANSLATE_SESSION_IDS
  if (typeof raw !== 'string' || !raw.trim()) return null
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export function tooltipTranslateSessionIds(): ReadonlySet<string> {
  return sessionIdsFromEnv() ?? new Set(DEFAULT_TOOLTIP_TRANSLATE_SESSION_IDS)
}

export function isTooltipTranslateEnabledForSession(sessionId: string | undefined): boolean {
  if (import.meta.env.VITE_TOOLTIP_TRANSLATE !== '1') return false
  if (!sessionId) return false
  return tooltipTranslateSessionIds().has(sessionId)
}
