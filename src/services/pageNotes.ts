import { api, onSseEvent } from '@/services/api'

/** Uma nota por dia numa aba marcada is_notas — ver NotasView. */
export interface PageNote {
  id: string
  pageId: string
  noteDate: string
  content: string
  createdAt: string
  updatedAt: string
}

type PageNoteRow = { id: string; page_id: string; note_date: string; content: string; created_at: string; updated_at: string }
function rowToNote(r: PageNoteRow): PageNote {
  return { id: r.id, pageId: r.page_id, noteDate: r.note_date, content: r.content, createdAt: r.created_at, updatedAt: r.updated_at }
}

// Cache reativo simples, carregado por aba sob demanda (mesmo padrão de leadMilestones/contracts) —
// cada aba de notas carrega só as suas próprias notas na primeira vez que é aberta.
let notes: PageNote[] = []
const loadedPages = new Set<string>()
let unsubSse: (() => void) | null = null
const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'page_notes') return
    const row = data as PageNoteRow
    if (type === 'DELETE') {
      notes = notes.filter((n) => n.id !== row.id)
    } else {
      const next = rowToNote(row)
      const idx = notes.findIndex((n) => n.id === next.id)
      notes = idx >= 0 ? notes.map((n, i) => (i === idx ? next : n)) : [...notes, next]
    }
    notify()
  })
}

export const pageNotesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
  // Referência estável entre chamadas (só muda quando os dados de verdade mudam) — o filtro por
  // página e a ordenação ficam no hook (useMemo), não aqui, senão useSyncExternalStore recriaria
  // um array novo a cada render e voltaria a re-renderizar sem parar.
  getAll(): PageNote[] { return notes },
  isLoaded(pageId: string): boolean { return loadedPages.has(pageId) },

  async ensureLoaded(pageId: string): Promise<void> {
    if (loadedPages.has(pageId)) return
    subscribeRealtime()
    const rows = await api.get<PageNoteRow[]>(`/api/page-notes?page=${encodeURIComponent(pageId)}`)
    notes = [...notes.filter((n) => n.pageId !== pageId), ...rows.map(rowToNote)]
    loadedPages.add(pageId)
    notify()
  },

  /** Cria a nota do dia (ou atualiza, se já existir uma pra essa data). */
  async upsert(pageId: string, noteDate: string, content: string): Promise<PageNote> {
    const row = await api.post<PageNoteRow>('/api/page-notes', { pageId, noteDate, content })
    const next = rowToNote(row)
    notes = [...notes.filter((n) => n.id !== next.id), next]
    notify()
    return next
  },

  async updateContent(id: string, content: string): Promise<void> {
    const row = await api.patch<PageNoteRow>(`/api/page-notes/${id}`, { content })
    const next = rowToNote(row)
    notes = notes.map((n) => (n.id === next.id ? next : n))
    notify()
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/api/page-notes/${id}`)
    notes = notes.filter((n) => n.id !== id)
    notify()
  },
}
