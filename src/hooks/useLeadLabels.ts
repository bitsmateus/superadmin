import * as React from 'react'
import { leadLabelsService } from '@/services/leadLabels'
import type { LeadLabel, LeadLabelField } from '@/types/leadBoard'

/** Etiquetas de um campo (diaContato | status), ordenadas por posição. */
export function useLeadLabels(field: LeadLabelField): LeadLabel[] {
  const all = React.useSyncExternalStore(
    leadLabelsService.subscribe,
    leadLabelsService.getAllLabels,
    leadLabelsService.getAllLabels,
  )
  return React.useMemo(
    () => all.filter((l) => l.field === field).sort((a, b) => a.position - b.position),
    [all, field],
  )
}
