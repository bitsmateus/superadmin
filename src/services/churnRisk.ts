import { api } from '@/services/api'
import type { PipelineStage } from '@/types/client'

/** Ver server/src/routes/churnRisk.ts — cada campo aqui é um sinal já computado no servidor
 *  (pulso de satisfação, pagamento Asaas/Recorrai, canais via NX Monitor, tickets, e manual —
 *  registrado à mão pelo time, sem depender de nenhum sinal automático). */
export interface ChurnRiskSignals {
  pulse: boolean
  payment: boolean
  channels: boolean
  tickets: boolean
  manual: boolean
}

export type ChurnSeverity = 'atencao' | 'alto' | 'critico'

export const CHURN_SEVERITY_LABEL: Record<ChurnSeverity, string> = {
  atencao: 'Atenção',
  alto: 'Alto risco',
  critico: 'Crítico',
}

export interface ChurnManualFlag {
  id: string
  severity: ChurnSeverity
  reason: string
  createdBy: string | null
  createdAt: string
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
  manualFlag: ChurnManualFlag | null
}

export interface ChurnRiskItem {
  client_id: string
  name: string
  company: string | null
  stage: PipelineStage
  responsavel: string | null
  responsavelEntrega: string | null
  hasSignal: boolean
  /** Só canal desconectado, nenhum outro sinal — a tela agrupa isso numa seção minimizada à parte. */
  onlySignalIsChannels: boolean
  severity: ChurnSeverity | null
  signals: ChurnRiskSignals
  details: ChurnRiskDetails
}

export interface ChurnRiskReport {
  totalAtivos: number
  totalComSinal: number
  bySignal: { pulse: number; payment: number; channels: number; tickets: number; manual: number }
  bySeverity: Record<ChurnSeverity, number>
  manualHistory: { mes: string; novos: number }[]
  manualAtivos: number
  manualResolvidos: number
}

export const churnRiskService = {
  list: () => api.get<ChurnRiskItem[]>('/api/churn-risk'),
  report: () => api.get<ChurnRiskReport>('/api/churn-risk/report'),
  flag: (clientId: string, input: { severity: ChurnSeverity; reason: string; createdBy?: string }) =>
    api.post(`/api/churn-risk/${clientId}/flag`, input),
  resolve: (clientId: string) => api.post(`/api/churn-risk/${clientId}/resolve`),
}
