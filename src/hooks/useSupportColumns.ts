import * as React from 'react'
import { supportColumnsService } from '@/services/supportColumns'
import type { SupportColumn } from '@/types/supportColumn'

/** Colunas do quadro do Suporte, já ordenadas. Garante o carregamento na 1ª chamada. */
export function useSupportColumns(): SupportColumn[] {
  React.useEffect(() => {
    void supportColumnsService.ensureLoaded()
  }, [])
  return React.useSyncExternalStore(
    supportColumnsService.subscribe,
    supportColumnsService.getColumns,
    supportColumnsService.getColumns,
  )
}

/** key da coluna → nome exibido (usado pela lista e pelo modal de tarefa). */
export function useSupportColumnLabels(): Map<string, string> {
  const columns = useSupportColumns()
  return React.useMemo(() => new Map(columns.map((c) => [c.key, c.name])), [columns])
}
