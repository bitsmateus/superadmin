import { api, onSseEvent } from '@/services/api'

/** Item do menu Suporte (Tarefas, Pipeline, Clientes...). `sourceKey` é o id do item original:
 * pro item de origem, é ele mesmo; numa cópia ("Duplicar"), aponta pra qual TELA ela deve abrir.
 * O item de origem mora na rota fixa dele (/pipeline, /tickets…); a cópia abre em /visao/<id>,
 * rota só dela, com `viewConfig` — os filtros/modo de exibição escolhidos ao duplicar. É isso que
 * faz a cópia ser uma visão diferente da mesma tela, e não um atalho repetido. */
export interface SupportPage {
  id: string
  name: string
  sourceKey: string
  position: number
  archivedAt: string | null
  /** Vazio pro item de origem (usa o padrão da tela) e pra cópia que não configurou nada. */
  viewConfig: Record<string, string>
}

type PageRow = {
  id: string; name: string; source_key: string; position: number
  archived_at: string | null; view_config: Record<string, string> | null; created_at: string
}
function rowToPage(r: PageRow): SupportPage {
  return {
    id: r.id,
    name: r.name,
    sourceKey: r.source_key,
    position: r.position,
    archivedAt: r.archived_at,
    viewConfig: r.view_config ?? {},
  }
}

/** true = entrada criada por "Duplicar" (tem rota /visao/<id> e visão própria). */
export function isSupportCopy(page: SupportPage): boolean {
  return page.id !== page.sourceKey
}

/**
 * O que a cópia leva ao ser criada:
 *  - 'full'      → etapas próprias + os clientes de hoje já distribuídos nelas
 *  - 'structure' → etapas próprias, sem nenhum cliente
 *  - 'view'      → sem etapas; é a mesma tela do original com um recorte de filtros
 */
export type SupportDuplicateMode = 'full' | 'structure' | 'view'

/** Etapa ("quadro") de uma cópia. Só cópia tem — o original usa as etapas fixas do código. */
export interface SupportPageStage {
  id: string
  key: string
  name: string
  color: string
  position: number
  isDone: boolean
}

type StageRow = {
  id: string; key: string; name: string; color: string
  position: number; is_done: boolean; created_at: string
}
function rowToStage(r: StageRow): SupportPageStage {
  return { id: r.id, key: r.key, name: r.name, color: r.color, position: r.position, isDone: r.is_done }
}

/**
 * Cliente dentro de uma cópia: os campos do cadastro (compartilhado com o Pipeline original) mais
 * `page_stage_key`, a etapa dele NESTA cópia. Mover aqui não altera `stage`, que segue alimentando
 * funil, Dashboard e relatórios.
 */
export interface SupportPageClient {
  id: string
  name: string
  email: string
  company: string | null
  responsavel: string | null
  stage: string
  page_stage_key: string
  page_position: number
  [key: string]: unknown
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
  async duplicate(
    id: string,
    name: string,
    mode: SupportDuplicateMode,
    viewConfig?: Record<string, string>,
  ): Promise<SupportPage> {
    const row = await api.post<PageRow>(`/api/support-pages/${id}/duplicate`, { name, mode, viewConfig })
    await reloadPages()
    return rowToPage(row)
  },

  /** Renomear — só o nome muda; o id (que é a URL da cópia) fica igual pra não quebrar links. */
  async rename(id: string, name: string): Promise<SupportPage> {
    const row = await api.patch<PageRow>(`/api/support-pages/${id}`, { name })
    await reloadPages()
    return rowToPage(row)
  },

  /** Etapas próprias da cópia. Lista vazia = ela não é um quadro, é só um recorte de filtros. */
  async getStages(id: string): Promise<SupportPageStage[]> {
    const rows = await api.get<StageRow[]>(`/api/support-pages/${id}/stages`)
    return rows.map(rowToStage)
  },

  /** Clientes que aparecem na cópia, com a etapa local dela. */
  async getClients(id: string): Promise<SupportPageClient[]> {
    return api.get<SupportPageClient[]>(`/api/support-pages/${id}/clients`)
  },

  /** Põe o cliente na cópia ou move de etapa DENTRO dela — não mexe em clients.stage. */
  async setClientStage(id: string, clientId: string, stageKey: string, position = 0): Promise<void> {
    await api.put(`/api/support-pages/${id}/clients/${clientId}`, { stageKey, position })
  },

  /** Tira o cliente da cópia. O cadastro dele continua existindo. */
  async removeClient(id: string, clientId: string): Promise<void> {
    await api.delete(`/api/support-pages/${id}/clients/${clientId}`)
  },

  /** Ajusta a visão salva de uma cópia já criada (admin-only; o back recusa no item de origem). */
  async saveView(id: string, viewConfig: Record<string, string>): Promise<SupportPage> {
    const row = await api.patch<PageRow>(`/api/support-pages/${id}/view`, { viewConfig })
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
