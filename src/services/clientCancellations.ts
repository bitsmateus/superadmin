import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Um cancelamento de cliente — ver server/src/routes/clientCancellations.ts. */
export interface ClientCancellation {
  id: string
  clientId: string
  /** 'YYYY-MM-DD' — o dia em que o cliente cancelou (não o dia em que foi registrado aqui). */
  canceledAt: string
  motivo: string
  observacao: string
  /** Foto da mensalidade no dia do cancelamento: corrigir o valor do cliente depois não mexe aqui. */
  mrrCents: number
  /** Preenchido quando o cliente voltou — o registro fica, o mês dele não muda. */
  reactivatedAt: string | null
  createdAt: string
  /** Vem do JOIN, pra lista não depender da cache de clientes já ter carregado. */
  clientName: string
  clientCompany: string
  clientPhone: string
}

type Row = {
  id: string; client_id: string; canceled_at: string; motivo: string; observacao: string
  mrr_cents: number; reactivated_at: string | null; created_at: string
  client_name?: string; client_company?: string; client_phone?: string
}

function rowTo(r: Row): ClientCancellation {
  return {
    id: r.id,
    clientId: r.client_id,
    // Vem como timestamp do Postgres; só a parte da data interessa.
    canceledAt: String(r.canceled_at).slice(0, 10),
    motivo: r.motivo ?? '',
    observacao: r.observacao ?? '',
    mrrCents: r.mrr_cents ?? 0,
    reactivatedAt: r.reactivated_at ?? null,
    createdAt: r.created_at,
    clientName: r.client_name ?? '',
    clientCompany: r.client_company ?? '',
    clientPhone: r.client_phone ?? '',
  }
}

let items: ClientCancellation[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'client_cancellations') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const rows = await api.get<Row[]>('/api/client-cancellations')
    items = rows.map(rowTo)
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar cancelamentos: ' + (err as Error).message)
  }
}

export function isCancellationsLoaded(): boolean { return loaded }

export const clientCancellationsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getAll(): ClientCancellation[] { return items },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async cancelar(input: {
    clientId: string; canceledAt: string; motivo: string; observacao: string; mrrCents: number
  }): Promise<void> {
    try {
      await api.post('/api/client-cancellations', input)
      await reload()
    } catch (err) {
      toast.error('Falha ao registrar o cancelamento: ' + (err as Error).message)
    }
  },

  async atualizar(id: string, patch: Partial<Pick<ClientCancellation, 'canceledAt' | 'motivo' | 'observacao' | 'mrrCents'>>): Promise<void> {
    try {
      await api.patch(`/api/client-cancellations/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  },

  /** Cliente voltou: sai de "cancelado" e volta pra ativo, mas o registro fica no mês em que
   * aconteceu (foi um cancelamento de verdade). */
  async reativar(id: string): Promise<void> {
    try {
      await api.post(`/api/client-cancellations/${id}/reativar`)
      await reload()
    } catch (err) {
      toast.error('Falha ao reativar: ' + (err as Error).message)
    }
  },

  /** Registro criado por engano — some do histórico e o cliente volta a ficar ativo. */
  async excluir(id: string): Promise<void> {
    try {
      await api.delete(`/api/client-cancellations/${id}`)
      await reload()
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
    }
  },
}
