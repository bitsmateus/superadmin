import * as React from 'react'
import { leadBoardsService, isLeadBoardsBooted } from '@/services/leadBoards'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

function useSnapshot<T>(getter: () => T): T {
  return React.useSyncExternalStore(
    leadBoardsService.subscribe,
    getter,
    getter,
  )
}

export function useLeadBoardsBooted(): boolean {
  return useSnapshot(isLeadBoardsBooted)
}

export function useLeadBoards(): LeadBoard[] {
  return useSnapshot(leadBoardsService.getBoards)
}

export function useLeadRows(boardId: string): LeadRow[] {
  const all = useSnapshot(leadBoardsService.getRows)
  return React.useMemo(
    () => all.filter((r) => r.boardId === boardId).sort((a, b) => a.position - b.position),
    [all, boardId],
  )
}

export function useLeadRow(rowId: string | null): LeadRow | undefined {
  const all = useSnapshot(leadBoardsService.getRows)
  return React.useMemo(() => (rowId ? all.find((r) => r.id === rowId) : undefined), [all, rowId])
}

/** Todas as linhas, de todos os quadros — usado pela barra de seleção em massa. */
export function useAllLeadRows(): LeadRow[] {
  return useSnapshot(leadBoardsService.getRows)
}
