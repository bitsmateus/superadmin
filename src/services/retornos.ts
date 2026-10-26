import { api } from '@/services/api'

/** Retorno de proposta vencido do CRM LUIS CLOSER (ver server/src/routes/retornos.ts). */
export interface RetornoPendente {
  card_id: string
  familia: string
  nome: string
  empresa: string
  telefone: string
  /** "YYYY-MM-DDTHH:MM", horário de Brasília (o campo Retornar). */
  retornar: string
  coluna: string
  crm_de_origem: string | null
  valor_mrr: string
  valor_implementacao: string
  origem: string
  resumo: string
  /** Tentativas sem resposta desde o último contato e adiamentos seguidos (saem da Linha do tempo). */
  tentativas: number
  adiamentos: number
}

export interface PedidoDeRetorno {
  resultado: 'retornou' | 'sem_resposta' | 'adiar'
  observacao: string
  desfecho?: 'fechou' | 'negociando' | 'perdeu'
  retornar_novo?: string
  motivo?: string
  motivo_detalhe?: string
  valor_mrr?: string
  valor_implementacao?: string
  origem?: string
  mover_follow_up?: boolean
}

/** Mesmos limites do servidor (server/src/lib/retornoProposta.ts). */
export const MINIMO_OBSERVACAO_RETORNO = 20
export const MINIMO_OBSERVACAO_TENTATIVA = 10
export const MINIMO_MOTIVO_ADIAR = 10
export const MAXIMO_ADIAMENTOS = 2
export const TENTATIVAS_PRA_FOLLOW_UP = 3

export const retornosService = {
  pendentes: () => api.get<RetornoPendente[]>('/api/retornos/pendentes'),
  registrar: (cardId: string, pedido: PedidoDeRetorno) => api.post<{ ok: true }>(`/api/retornos/${cardId}/resultado`, pedido),
}
