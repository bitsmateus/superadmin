import * as React from 'react'
import { leadLabelsService } from '@/services/leadLabels'
import type { LeadLabel, LeadLabelField } from '@/types/leadBoard'

/** Etiquetas de um campo (tipo/diaContato/status/ligacao), ordenadas por posição — por aba
 * (`pageId`), exceto "sdr", que é global (ver leadPages.ts) e ignora o pageId passado. */
export function useLeadLabels(field: LeadLabelField, pageId?: string | null): LeadLabel[] {
  const all = React.useSyncExternalStore(
    leadLabelsService.subscribe,
    leadLabelsService.getAllLabels,
    leadLabelsService.getAllLabels,
  )
  return React.useMemo(
    () => all
      .filter((l) => l.field === field && (field === 'sdr' || l.pageId === pageId))
      .sort((a, b) => a.position - b.position),
    [all, field, pageId],
  )
}
