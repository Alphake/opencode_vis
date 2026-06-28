import { useEffect, useMemo, useState } from 'react'
import type { OcMessage } from '../types/opencode'
import type { MemoryWorkerErrorDiagnosis } from '../services/memoryWorkerApi'
import { isTooltipTranslateEnabledForSession } from '../config/tooltipTranslateSessions'
import {
  collectTooltipTranslatableStrings,
  createTooltipTranslateFn,
  prewarmTooltipTranslations,
  subscribeTooltipTranslateCache,
  type TooltipTranslateFn,
} from '../utils/tooltipTranslate'

export function useTooltipTranslate(
  sessionId: string | undefined,
  messages: OcMessage[],
  extras?: {
    extraMessages?: OcMessage[]
    diagnoses?: MemoryWorkerErrorDiagnosis[]
  },
): { translate: TooltipTranslateFn | undefined; revision: number } {
  const [revision, setRevision] = useState(0)
  const enabled = isTooltipTranslateEnabledForSession(sessionId)

  const stringsKey = useMemo(() => {
    if (!enabled || !sessionId) return ''
    const merged = [...messages, ...(extras?.extraMessages ?? [])]
    return collectTooltipTranslatableStrings(merged, {
      diagnoses: extras?.diagnoses,
    }).join('\u0001')
  }, [enabled, sessionId, messages, extras?.extraMessages, extras?.diagnoses])

  useEffect(() => {
    if (!enabled || !sessionId) return
    return subscribeTooltipTranslateCache(() => setRevision((r) => r + 1))
  }, [enabled, sessionId])

  useEffect(() => {
    if (!enabled || !sessionId || !stringsKey) return
    const merged = [...messages, ...(extras?.extraMessages ?? [])]
    const strings = collectTooltipTranslatableStrings(merged, {
      diagnoses: extras?.diagnoses,
    })
    void prewarmTooltipTranslations(sessionId, strings)
  }, [enabled, sessionId, stringsKey, messages, extras?.extraMessages, extras?.diagnoses])

  const translate = useMemo(() => {
    if (!enabled || !sessionId) return undefined
    void revision
    return createTooltipTranslateFn(sessionId)
  }, [enabled, sessionId, revision])

  return { translate, revision }
}
