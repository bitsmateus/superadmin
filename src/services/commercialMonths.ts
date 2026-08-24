import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Um mês do Painel do Mês (Dashboard Comercial) — só os campos manuais. O resto do painel é
 * calculado ao vivo, no front, em cima de lead_rows/lead_boards já carregados. */
export interface CommercialMonth {
  /** 'YYYY-MM' */
  id: string
  investimentoTrafego: string
  leadsGerados: number
  permanenciaMedia: number
  createdAt: string
}

type Row = {
  id: string; investimento_trafego: string; leads_gerados: number; permanencia_media: string; created_at: string
}
function rowToMonth(r: Row): CommercialMonth {
  return {
    id: r.id,
    investimentoTrafego: r.investimento_trafego,
    leadsGerados: r.leads_gerados,
    permanenciaMedia: Number(r.permanencia_media),
    createdAt: r.created_at,
  }
}

let months: CommercialMonth[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'commercial_months') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const rows = await api.get<Row[]>('/api/commercial-months')
    months = rows.map(rowToMonth).sort((a, b) => b.id.localeCompare(a.id))
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar o Painel do Mês: ' + (err as Error).message)
  }
}

export function isCommercialMonthsLoaded(): boolean { return loaded }

export const commercialMonthsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getAll(): CommercialMonth[] { return months },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async create(id: string): Promise<CommercialMonth> {
    const row = await api.post<Row>('/api/commercial-months', { id })
    await reload()
    return rowToMonth(row)
  },

  async update(id: string, patch: { investimentoTrafego?: string; leadsGerados?: number; permanenciaMedia?: number }): Promise<void> {
    try {
      await api.patch(`/api/commercial-months/${id}`, patch)
      await reload()
    } catch (err) {
      toast.error('Falha ao salvar o Painel do Mês: ' + (err as Error).message)
    }
  },
}
