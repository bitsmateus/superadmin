import { api } from '@/services/api'

/** Rotina do dia (barra lateral, ver server/src/routes/rotina.ts). Horários de Brasília, "HH:MM". */
export type TipoDeBloco = 'tarefa' | 'ligacao' | 'reuniao' | 'crm'
export type StatusDaMarcacao = 'feito' | 'parcial' | 'nao_deu'
export type EstadoDoBloco = 'futuro' | 'agora' | 'pendente' | 'sem_resposta' | 'reuniao' | 'folga' | 'fora' | StatusDaMarcacao

export interface Marcacao {
  status: StatusDaMarcacao
  motivo: string
  /** "YYYY-MM-DDTHH:MM" de Brasília. */
  marcado_em: string
  /** Marcou depois do fim do bloco + 30 min. */
  atrasado: boolean
}

export interface ReuniaoDoBloco { card_id: string; pagina: string; nome: string; empresa: string; agendamento: string }

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
  pode_marcar: boolean
  marcacao: Marcacao | null
  reunioes: ReuniaoDoBloco[]
}

export type RotinaDeHoje =
  | { tem: false }
  | {
      tem: true
      pagina: string
      nome_da_pagina: string
      dono: string
      somente_leitura: boolean
      data: string
      agora: string
      folga: boolean
      dia_util: boolean
      blocos: BlocoDoDia[]
    }

export interface SemanaDaRotina {
  pagina: string
  nome_da_pagina: string
  dono: string
  hoje: string
  dias: { data: string; folga: boolean }[]
  blocos: (BlocoBase & {
    dias: { data: string; estado: EstadoDoBloco; marcacao: Marcacao | null; reunioes: ReuniaoDoBloco[] }[]
  })[]
}

export const MINIMO_MOTIVO = 5

export const rotinaService = {
  hoje: (pagina?: string) =>
    api.get<RotinaDeHoje>(`/api/rotina/hoje${pagina ? `?pagina=${encodeURIComponent(pagina)}` : ''}`),
  marcar: (blocoId: string, status: StatusDaMarcacao, motivo = '') =>
    api.post<{ ok: true }>(`/api/rotina/blocos/${blocoId}/marcar`, { status, motivo }),
  semana: (pagina: string, semana?: string) =>
    api.get<SemanaDaRotina>(`/api/rotina/semana?pagina=${encodeURIComponent(pagina)}${semana ? `&semana=${semana}` : ''}`),
  folga: (pagina: string, data: string, folga: boolean) => api.put<{ ok: true }>('/api/rotina/folga', { pagina, data, folga }),
  salvarBlocos: (pagina: string, blocos: (Omit<BlocoBase, 'id'> & { id?: string })[]) =>
    api.put<{ ok: true; blocos: BlocoBase[] }>('/api/rotina/blocos', { pagina, blocos }),
}

/** Cor de cada tipo, a mesma dos prints da rotina: verde tarefa, azul ligação, laranja reunião, cinza CRM da reunião. */
export const VISUAL_DO_TIPO: Record<TipoDeBloco, { nome: string; barra: string; texto: string }> = {
  tarefa: { nome: 'Tarefa', barra: 'bg-emerald-500', texto: 'text-emerald-600 dark:text-emerald-400' },
  ligacao: { nome: 'Ligação', barra: 'bg-blue-600', texto: 'text-blue-600 dark:text-blue-400' },
  reuniao: { nome: 'Reunião', barra: 'bg-orange-600', texto: 'text-orange-600 dark:text-orange-400' },
  crm: { nome: 'CRM da reunião', barra: 'bg-slate-400', texto: 'text-slate-500 dark:text-slate-400' },
}

/** Como cada estado aparece (bolinha da barra e quadradinho da semana). */
export const VISUAL_DO_ESTADO: Record<EstadoDoBloco, { nome: string; bolinha: string; icone: string }> = {
  futuro: { nome: 'Ainda não começou', bolinha: 'border-2 border-line bg-transparent', icone: '' },
  agora: { nome: 'Agora', bolinha: 'bg-accent ring-4 ring-accent/25 animate-pulse', icone: '' },
  pendente: { nome: 'Falta marcar', bolinha: 'bg-warning', icone: '!' },
  sem_resposta: { nome: 'Sem resposta', bolinha: 'bg-foreground/25', icone: '?' },
  reuniao: { nome: 'Teve reunião', bolinha: 'bg-orange-500', icone: '✓' },
  feito: { nome: 'Feito', bolinha: 'bg-success', icone: '✓' },
  parcial: { nome: 'Parcial', bolinha: 'bg-warning/70', icone: '½' },
  nao_deu: { nome: 'Não deu', bolinha: 'bg-danger', icone: '✕' },
  folga: { nome: 'Folga', bolinha: 'bg-foreground/10', icone: '' },
  fora: { nome: 'Antes da rotina começar', bolinha: 'border border-dashed border-foreground/15', icone: '' },
}

/** Os que contam pro "X/Y" e pra aderência: blocos que já terminaram. */
export const ESTADOS_ENCERRADOS: EstadoDoBloco[] = ['pendente', 'sem_resposta', 'reuniao', 'feito', 'parcial', 'nao_deu']
/** Peso de cada um na aderência (parcial vale meio). */
export const PESO_NA_ADERENCIA: Partial<Record<EstadoDoBloco, number>> = { feito: 1, reuniao: 1, parcial: 0.5 }
