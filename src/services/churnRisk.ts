import { api } from '@/services/api'
import type { PipelineStage } from '@/types/client'

/** Ver server/src/routes/churnRisk.ts — cada campo aqui é um sinal já computado no servidor
 *  (pulso de satisfação, pagamento Asaas, canais via NX Monitor, tickets). */
export interface ChurnRiskSignals {
  pulse: boolean
  payment: boolean
  channels: boolean
  tickets: boolean
}

export interface ChurnRiskDetails {
  pulseStatus: 'aguardando' | 'respondido' | 'sem_resposta' | null
  pulseResponse: 'sim' | 'nao' | null
  pulseSentAt: string | null
  paymentStatus: string | null
  /** De qual fonte veio o paymentStatus acima — Asaas ou Recorrai, nunca as duas pro mesmo cliente. */
  paymentSource: 'asaas' | 'recorrai' | null
  channelsDisconnected: number
  channelsTotal: number
  ticketsReopened: number
  ticketsOverdue: number
}

export interface ChurnRiskItem {
  client_id: string
  name: string
  company: string | null
  stage: PipelineStage
  responsavel: string | null
  responsavelEntrega: string | null
  signals: ChurnRiskSignals
  details: ChurnRiskDetails
}

export const churnRiskService = {
  list: () => api.get<ChurnRiskItem[]>('/api/churn-risk'),
}
