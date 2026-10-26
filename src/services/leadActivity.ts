import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

/** Quando o "Dia de contato" de um lead foi alterado pela última vez (ou criado, se nunca
 * mudou) — usado pra sinalizar quem está parado há mais de 24h sem o SDR mexer. */
export interface LeadActivity {
  id: string
  boardId: string
  diaContatoUpdatedAt: string
  /** Último movimento da lead (Linha do tempo ou Atualização, do card ou da original) — "Propostas paradas" do closer. */
  ultimaAtividade: string
}

type Row = { id: string; board_id: string; dia_contato_updated_at: string; ultima_atividade: string }

let activity: LeadActivity[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
let refetchTimer: ReturnType<typeof setTimeout> | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if ((table !== 'lead_events' && table !== 'lead_notes') || type !== 'INSERT') return
    // "Dia de contato" atualiza na hora; o resto (só mexe em "Propostas paradas") espera juntar as edições seguidas.
    const rapido = table === 'lead_events' && (data as { type?: string }).type === 'dia_contato'
    if (refetchTimer) clearTimeout(refetchTimer)
    refetchTimer = setTimeout(() => { void leadActivityService.reload() }, rapido ? 400 : 3000)
  })
}

export const leadActivityService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getAll(): LeadActivity[] { return activity },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = leadActivityService.reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async reload(): Promise<void> {
    try {
      const rows = await api.get<Row[]>('/api/lead-activity')
      activity = rows.map((r) => ({
        id: r.id, boardId: r.board_id, diaContatoUpdatedAt: r.dia_contato_updated_at, ultimaAtividade: r.ultima_atividade,
      }))
      loaded = true
      notify()
    } catch (err) {
      toast.error('Falha ao carregar atividade dos leads: ' + (err as Error).message)
    }
  },
}
