import * as React from 'react'
import { pageNotesService, type PageNote } from '@/services/pageNotes'

function useSnapshot<T>(pageId: string, getter: () => T): T {
  React.useEffect(() => { void pageNotesService.ensureLoaded(pageId) }, [pageId])
  return React.useSyncExternalStore(pageNotesService.subscribe, getter, getter)
}

export function usePageNotesLoaded(pageId: string): boolean {
  return useSnapshot(pageId, () => pageNotesService.isLoaded(pageId))
}

/** Notas dessa aba, mais recente primeiro. */
export function usePageNotes(pageId: string): PageNote[] {
  const all = useSnapshot(pageId, pageNotesService.getAll)
  return React.useMemo(
    () => all.filter((n) => n.pageId === pageId).sort((a, b) => b.noteDate.localeCompare(a.noteDate)),
    [all, pageId],
  )
}
