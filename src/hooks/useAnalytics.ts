import * as React from 'react'
import { analyticsService, isAnalyticsBooted } from '@/services/analytics'
import type { AuditEntry, StageHistoryEntry } from '@/types/client'

function useSnapshot<T>(getter: () => T): T {
  return React.useSyncExternalStore(
    analyticsService.subscribe,
    getter,
    getter,
  )
}

export function useAnalyticsBooted(): boolean {
  return useSnapshot(isAnalyticsBooted)
}

export function useStageHistory(): StageHistoryEntry[] {
  return useSnapshot(analyticsService.getStageHistory)
}

export function useAuditEntries(): AuditEntry[] {
  return useSnapshot(analyticsService.getAuditEntries)
}
