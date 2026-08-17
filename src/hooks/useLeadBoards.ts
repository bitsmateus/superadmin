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
