import { api } from '@/services/api'

/** Rotina do dia: checklist do botão "Rotina" (ver server/src/routes/rotina.ts). Horários de Brasília, "HH:MM". */
export type TipoDeBloco = 'tarefa' | 'ligacao' | 'reuniao' | 'crm'
/** futuro/agora (ainda no horário), feito, nao_feito (passou sem marcar), fora (o bloco ainda não existia), folga. */
export type EstadoDoBloco = 'futuro' | 'agora' | 'feito' | 'nao_feito' | 'fora' | 'folga'

export interface BlocoBase {
  id: string
  inicio: string
  fim: string
  titulo: string
  itens: string[]
  tipo: TipoDeBloco
}

export interface BlocoDoDia extends BlocoBase {
  estado: EstadoDoBloco
  /** "YYYY-MM-DDTHH:MM" de Brasília, quando marcou; null se não está feito. */
  feito_em: string | null
}

export type RotinaDeHoje =
  | { tem: false }
  | {
      tem: true
      pagina: string
      dono: string
      somente_leitura: boolean
      data: string
      dia_util: boolean
      folga: boolean
      blocos: BlocoDoDia[]
    }

export interface SemanaDaRotina {
  pagina: string
  dono: string
  hoje: string
  dias: { data: string; folga: boolean }[]
  blocos: (BlocoBase & { dias: { data: string; estado: EstadoDoBloco; feito_em: string | null }[] })[]
}

export const rotinaService = {
  hoje: (pagina: string) => api.get<RotinaDeHoje>(`/api/rotina/hoje?pagina=${encodeURIComponent(pagina)}`),
  marcar: (blocoId: string, feito: boolean) =>
    feito ? api.post<{ ok: true }>(`/api/rotina/blocos/${blocoId}/feito`) : api.delete<{ ok: true }>(`/api/rotina/blocos/${blocoId}/feito`),
  semana: (pagina: string, semana?: string) =>
    api.get<SemanaDaRotina>(`/api/rotina/semana?pagina=${encodeURIComponent(pagina)}${semana ? `&semana=${semana}` : ''}`),
  folga: (pagina: string, data: string, folga: boolean) => api.put<{ ok: true }>('/api/rotina/folga', { pagina, data, folga }),
  salvarBlocos: (pagina: string, blocos: (Omit<BlocoBase, 'id'> & { id?: string })[]) =>
    api.put<{ ok: true; blocos: BlocoBase[] }>('/api/rotina/blocos', { pagina, blocos }),
}

/** Cor de cada tipo, a mesma dos prints da rotina: verde tarefa, azul ligação, laranja reunião, cinza CRM da reunião. */
export const VISUAL_DO_TIPO: Record<TipoDeBloco, { nome: string; barra: string }> = {
  tarefa: { nome: 'Tarefa', barra: 'bg-emerald-500' },
  ligacao: { nome: 'Ligação', barra: 'bg-blue-600' },
  reuniao: { nome: 'Reunião', barra: 'bg-orange-600' },
  crm: { nome: 'CRM da reunião', barra: 'bg-slate-400' },
}
