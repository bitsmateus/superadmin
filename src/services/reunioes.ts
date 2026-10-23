import { api } from '@/services/api'

/** Reunião que já passou há 1h ou mais e ainda não tem resultado (ver server/src/routes/reunioes.ts). */
export interface ReuniaoPendente {
  /** O card que a pessoa trabalha: a cópia do CRM do closer, se houver; senão a lead original. */
  card_id: string
  /** A lead original (a cópia aponta pra ela): uma reunião por lead. */
  familia: string
  nome: string
  empresa: string
  telefone: string
  /** CRM da lead original. */
  crm: string
  crm_do_card: string
  /** "YYYY-MM-DDTHH:MM", horário de Brasília (o mesmo do campo Agendamento). */
  agendamento: string
  responsavel: string
  link: string | null
  dor: string
  resumo: string
}

export type ResultadoReuniao = 'compareceu' | 'nao_compareceu' | 'remarcada'

export interface PedidoDeResultado {
  resultado: ResultadoReuniao
  resumo?: string
  proxima_etapa?: string
  motivo?: string
  motivo_outro?: string
  agendamento_novo?: string
}

/** Mesmas listas do servidor (server/src/lib/reuniaoResultado.ts). */
export const ETAPAS_COMPARECEU = ['Proposta enviada', 'Follow up Propostas', 'Vendido', 'Perdido', 'Desqualificado'] as const
export const MOTIVOS_NAO_COMPARECEU = [
  'Lead não entrou na reunião e não respondeu',
  'Lead sumiu / sem retorno',
  'Lead avisou que não podia',
  'Lead pediu pra cancelar',
  'Problema técnico (link, conexão)',
  'Outro',
] as const
export const MINIMO_RESUMO = 20

export const reunioesService = {
  pendentes: () => api.get<ReuniaoPendente[]>('/api/reunioes/pendentes'),
  registrar: (cardId: string, pedido: PedidoDeResultado) =>
    api.post<{ ok: true; resultado: ResultadoReuniao }>(`/api/reunioes/${cardId}/resultado`, pedido),
}

/** "2026-10-27T09:00" -> "27/10/2026 às 09:00". */
export function agendamentoLegivel(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]} às ${m[4]}:${m[5]}` : local || '—'
}
