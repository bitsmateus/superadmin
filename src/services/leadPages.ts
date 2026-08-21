import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { LeadPage } from '@/types/leadBoard'

type PageRow = { id: string; name: string; position: number; archived_at: string | null; created_at: string }
function rowToPage(r: PageRow): LeadPage {
  return { id: r.id, name: r.name, position: r.position, archivedAt: r.archived_at }
}

// ---------- Cache das abas ativas (mesmo padrão reativo de leadBoardsService) ----------

let pages: LeadPage[] = []
let booted = false
let bootingPromise: Promise<void> | null = null
let unsubSse: (() => void) | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

export function isLeadPagesBooted(): boolean { return booted }

export async function bootLeadPages(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const fresh = await api.get<PageRow[]>('/api/lead-pages')
      pages = fresh.map(rowToPage).sort((a, b) => a.position - b.position)
      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      console.error('[leadPages] boot crash', err)
    }
  })()
  return bootingPromise
}

export async function teardownLeadPages(): Promise<void> {
  unsubSse?.(); unsubSse = null
  pages = []
  booted = false; bootingPromise = null
  notify()
}

async function reloadPages() {
  try {
    const fresh = await api.get<PageRow[]>('/api/lead-pages')
    pages = fresh.map(rowToPage).sort((a, b) => a.position - b.position)
    notify()
  } catch { /* silent — próxima mudança real corrige o cache */ }
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type) => {
    if (table !== 'lead_pages') return
    // Payload pequeno — mais simples recarregar a lista inteira (poucas abas existem) do que
    // reconciliar arquivada/restaurada/reordenada linha a linha.
    void reloadPages()
    if (type === 'DELETE') { /* nunca acontece de verdade — é sempre soft delete (archived_at) */ }
  })
}

export const leadPagesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
  getAll(): LeadPage[] { return pages },

  async create(name: string): Promise<LeadPage> {
    const row = await api.post<PageRow>('/api/lead-pages', { name })
    await reloadPages()
    return rowToPage(row)
  },

  async rename(id: string, name: string): Promise<void> {
    try {
      await api.patch(`/api/lead-pages/${id}`, { name })
      await reloadPages()
    } catch (err) {
      toast.error('Falha ao renomear a aba: ' + (err as Error).message)
    }
  },

  async duplicate(id: string): Promise<LeadPage> {
    const row = await api.post<PageRow>(`/api/lead-pages/${id}/duplicate`, {})
    await reloadPages()
    return rowToPage(row)
  },

  async archive(id: string): Promise<void> {
    await api.post(`/api/lead-pages/${id}/archive`, {})
    await reloadPages()
  },

  async restore(id: string): Promise<void> {
    await api.post(`/api/lead-pages/${id}/restore`, {})
    await reloadPages()
  },

  /** Abas arquivadas — não fica em cache, é sob demanda (admin-only). */
  async getArchived(): Promise<LeadPage[]> {
    const rows = await api.get<PageRow[]>('/api/lead-pages?archived=1')
    return rows.map(rowToPage).sort((a, b) => a.position - b.position)
  },
}
