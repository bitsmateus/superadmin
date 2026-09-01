import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'

export interface CommissionRates {
  sdrPerSaleCents: number
  suportePerDeliveryCents: number
  suportePerVendaAvulsaCents: number
}

export type CommissionRole = 'sdr' | 'suporte'
export type CommissionStatus = 'pendente' | 'pago'

export interface CommissionPayment {
  id: string
  person: string
  role: CommissionRole
  /** 'YYYY-MM' */
  month: string
  status: CommissionStatus
}

type RatesRow = {
  sdr_per_sale_cents: number; suporte_per_delivery_cents: number; suporte_per_venda_avulsa_cents: number
}
type PaymentRow = { id: string; person: string; role: CommissionRole; month: string; status: CommissionStatus }

function rowToRates(r: RatesRow): CommissionRates {
  return {
    sdrPerSaleCents: r.sdr_per_sale_cents,
    suportePerDeliveryCents: r.suporte_per_delivery_cents,
    suportePerVendaAvulsaCents: r.suporte_per_venda_avulsa_cents,
  }
}
function rowToPayment(r: PaymentRow): CommissionPayment {
  return { id: r.id, person: r.person, role: r.role, month: r.month, status: r.status }
}

let rates: CommissionRates = { sdrPerSaleCents: 10000, suportePerDeliveryCents: 0, suportePerVendaAvulsaCents: 0 }
let payments: CommissionPayment[] = []
let loaded = false
let loadingPromise: Promise<void> | null = null

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table) => {
    if (table !== 'commission_rates' && table !== 'commission_payments') return
    void reload()
  })
}

async function reload(): Promise<void> {
  try {
    const [ratesRow, paymentRows] = await Promise.all([
      api.get<RatesRow>('/api/commission-rates'),
      api.get<PaymentRow[]>('/api/commission-payments'),
    ])
    rates = rowToRates(ratesRow)
    payments = paymentRows.map(rowToPayment)
    loaded = true
    notify()
  } catch (err) {
    toast.error('Falha ao carregar comissões: ' + (err as Error).message)
  }
}

export function isCommissionsLoaded(): boolean { return loaded }

export const commissionsService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  getRates(): CommissionRates { return rates },
  getPayments(): CommissionPayment[] { return payments },

  async ensureLoaded(): Promise<void> {
    ensureRealtime()
    if (loaded) return
    if (loadingPromise) return loadingPromise
    loadingPromise = reload().finally(() => { loadingPromise = null })
    return loadingPromise
  },

  async updateRates(patch: Partial<CommissionRates>): Promise<void> {
    try {
      const row = await api.put<RatesRow>('/api/commission-rates', patch)
      rates = rowToRates(row)
      notify()
    } catch (err) {
      toast.error('Falha ao salvar comissão: ' + (err as Error).message)
    }
  },

  async setPaymentStatus(person: string, role: CommissionRole, month: string, status: CommissionStatus): Promise<void> {
    try {
      const row = await api.put<PaymentRow>('/api/commission-payments', { person, role, month, status })
      const full = rowToPayment(row)
      const idx = payments.findIndex((p) => p.person === person && p.role === role && p.month === month)
      if (idx === -1) payments = [...payments, full]
      else { const copy = payments.slice(); copy[idx] = full; payments = copy }
      notify()
    } catch (err) {
      toast.error('Falha ao salvar status: ' + (err as Error).message)
    }
  },
}
