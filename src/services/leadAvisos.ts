import { api } from '@/services/api'

/** Aviso da Luiza pro CRM ARTHUR (ver server/src/routes/leadAvisos.ts). */
export interface AvisoDaLuiza {
  id: string
  tipo: 'novo' | 'qualificado' | 'reuniao_agendada'
  coluna: string
  created_at: string
  card_id: string
  nome: string
  empresa: string
  origem: string
  /** "YYYY-MM-DDTHH:MM" (Brasília), quando tem. */
  agendamento: string
  /** O X de quem está logado conclui o aviso pra todo mundo (é o dono do CRM ARTHUR); senão, esconde só pra ele. */
  fecha_pra_todos: boolean
}

export const leadAvisosService = {
  naoLidos: () => api.get<AvisoDaLuiza[]>('/api/lead-avisos'),
  /** Sem ids, marca todos os não lidos. */
  marcarLidos: (ids?: string[]) => api.post<{ ok: true }>('/api/lead-avisos/lidos', ids ? { ids } : {}),
}
