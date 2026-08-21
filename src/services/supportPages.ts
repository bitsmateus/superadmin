import { api, onSseEvent } from '@/services/api'

/** Item do menu Suporte (Tarefas, Pipeline, Clientes...) — a URL é sempre a mesma, só a
 * visibilidade no menu (arquivado ou não) é gerenciável por um admin. `sourceKey` é o id do item
 * original: pro item de origem, é ele mesmo; numa cópia ("Duplicar"), aponta pra qual rota/tela
 * ela deve abrir — duas entradas podem apontar pra mesma tela com nomes diferentes. */
export interface SupportPage {
  id: string
  name: string
  sourceKey: string
  position: number
  archivedAt: string | null
}

type PageRow = {
  id: string; name: string; source_key: string; position: number
  archived_at: string | null; created_at: string
}
function rowToPage(r: PageRow): SupportPage {
  return { id: r.id, name: r.name, sourceKey: r.source_key, position: r.position, archivedAt: r.archived_at }
}

let pages: SupportPage[] = []
let booted = false
let bootingPromise: Promise<void> | null = null
let unsubSse: (() => void) | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

export function isSupportPagesBooted(): boolean { return booted }

export async function bootSupportPages(): Promise<void> {
  if (bootingPromise) return bootingPromise
  bootingPromise = (async () => {
    try {
      const fresh = await api.get<PageRow[]>('/api/support-pages')
      pages = fresh.map(rowToPage).sort((a, b) => a.position - b.position)
      subscribeRealtime()
      booted = true
      notify()
    } catch (err) {
      console.error('[supportPages] boot crash', err)
    }
  })()
  return bootingPromise
}

export async function teardownSupportPages(): Promise<void> {
  unsubSse?.(); unsubSse = null
  pages = []
  booted = false; bootingPromise = null
  notify()
}

async function reloadPages() {
  try {
    const fresh = await api.get<PageRow[]>('/api/support-pages')
    pages = fresh.map(rowToPage).sort((a, b) => a.position - b.position)
    notify()
  } catch { /* silente — próxima mudança real corrige o cache */ }
}

function subscribeRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'support_pages') return
    void reloadPages()
  })
}

export const supportPagesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
  getAll(): SupportPage[] { return pages },

  /** name vazio/omitido = "<nome de origem> (cópia)". */
  async duplicate(id: string, name?: string): Promise<SupportPage> {
    const row = await api.post<PageRow>(`/api/support-pages/${id}/duplicate`, { name })
    await reloadPages()
    return rowToPage(row)
  },

  async archive(id: string): Promise<void> {
    await api.post(`/api/support-pages/${id}/archive`, {})
    await reloadPages()
  },

  async restore(id: string): Promise<void> {
    await api.post(`/api/support-pages/${id}/restore`, {})
    await reloadPages()
  },

  /** Itens arquivados — não fica em cache, é sob demanda (admin-only). */
  async getArchived(): Promise<SupportPage[]> {
    const rows = await api.get<PageRow[]>('/api/support-pages?archived=1')
    return rows.map(rowToPage).sort((a, b) => a.position - b.position)
  },
}
