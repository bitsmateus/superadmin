import { api } from '@/services/api'

/** Monitor de Atendimento — ver server/src/routes/monitorAtendimento.ts e server/src/lib/atendimento/. */

export type Situacao = 'sem_resposta' | 'promessa' | 'cliente_parou' | 'fila' | 'ok'

export const ROTULO_SITUACAO: Record<Situacao, string> = {
  sem_resposta: 'Cliente sem resposta',
  promessa: '"Vou verificar" e sumiu',
  cliente_parou: 'Cliente parou de falar',
  fila: 'Na fila sem dono',
  ok: 'Em dia',
}

export interface ConfigMonitor {
  ativo: boolean
  prazos: { semRespostaMin: number; promessaMin: number; clienteParouHoras: number; filaMin: number; abertoDias: number }
  escalarEm: number
  horario: { inicio: string; fim: string; dias: number[] }
  grupoId: string
  notaNoTicket: boolean
  resumoHora: string
  /** O que vai para o grupo. O resto fica só no painel. */
  avisos: { situacoes: Situacao[]; abertoLongo: boolean; resumo: boolean }
  ia: boolean
  followupMensagem: string
  autoEncerrar: { ativo: boolean; horasDepoisDoAlerta: number; mensagem: string }
  ignorar: string[]
  filas: number[]
  linkTicket: string
  credencial: { apiId: string; token: string; baseUrl: string; tokenSalvo?: boolean }
}

export interface TicketMonitor {
  id: number
  link: string
  status: string
  atendenteId: number | null
  atendente: string | null
  filaId: number | null
  fila: string | null
  grupo: boolean
  contato: string | null
  numero: string | null
  clienteId: string | null
  cliente: string | null
  situacao: Situacao
  situacaoRotulo: string
  desde: string | null
  decorridoMin: number
  prazoMin: number
  nivel: number
  abertoLongo: boolean
  abertoEm: string | null
  ultimaDe: 'cliente' | 'atendente' | null
  ultimaAt: string | null
  textoAtendente: string | null
  textoCliente: string | null
  classeIa: string | null
  primeiraRespostaMin: number | null
  alertaNivel: number
  alertaEm: string | null
  followupEm: string | null
  ignorado: boolean
  erro: string | null
}

export interface LinhaRanking {
  user_id: string | null
  user_name: string
  abertos: number
  em_alerta: number
  alertas: number
  escalados: number
  finalizados: number
  primeira_resposta_media: number | null
}

export interface Contagem {
  total: number
  foraDoPrazo: number
  escalados: number
}

export interface EstadoCiclo {
  em: string | null
  ok: boolean
  erro: string | null
  tickets: number
  lidos: number
  alertas: number
  duracaoMs: number
}

export interface PainelMonitor {
  config: ConfigMonitor
  padrao: ConfigMonitor
  ciclo: EstadoCiclo
  iaDisponivel: boolean
  credencialOk: boolean
  grupoDestino: string
  tickets: TicketMonitor[]
  contagens: Record<Situacao, Contagem>
  abertoLongo: number
  ranking: { hoje: LinhaRanking[]; semana: LinhaRanking[] }
}

export interface EventoMonitor {
  id: number
  ticket_id: number
  tipo: string
  situacao: Situacao | null
  nivel: number | null
  user_name: string | null
  detalhe: string | null
  autor: string | null
  created_at: string
  contato_nome: string | null
  is_group: boolean | null
}

export interface UsuarioNx {
  id: number
  name: string
  email: string | null
  profile: string | null
}

export interface FilaNx {
  id: number
  nome: string
}

const B = '/api/atendimento-monitor'

export const monitorAtendimentoApi = {
  painel: () => api.get<PainelMonitor>(B),
  historico: (dias = 7, ticket?: number) => api.get<EventoMonitor[]>(`${B}/historico?dias=${dias}${ticket ? `&ticket=${ticket}` : ''}`),
  salvarConfig: (cfg: Partial<ConfigMonitor>) => api.put<ConfigMonitor>(`${B}/config`, cfg),
  rodar: () => api.post<EstadoCiclo>(`${B}/rodar`),
  testarGrupo: () => api.post<{ ok: boolean }>(`${B}/teste-grupo`),
  resumo: (enviar = false) => api.post<{ texto: string }>(`${B}/resumo`, { enviar }),
  usuarios: () => api.get<UsuarioNx[]>(`${B}/nx/usuarios`),
  filas: () => api.get<FilaNx[]>(`${B}/nx/filas`),
  finalizar: (id: number, mensagem?: string) => api.post<{ ok: boolean }>(`${B}/tickets/${id}/finalizar`, { mensagem }),
  followup: (id: number, mensagem?: string) => api.post<{ ok: boolean }>(`${B}/tickets/${id}/followup`, { mensagem }),
  transferir: (id: number, dados: { userId?: number | null; queueId?: number | null }) =>
    api.post<{ ok: boolean }>(`${B}/tickets/${id}/transferir`, dados),
  ignorar: (id: number, ignorar = true) => api.post<{ ok: boolean }>(`${B}/tickets/${id}/ignorar`, { ignorar }),
}

/** "8 min", "1h20", "3h", "2 dias" — o mesmo formato das mensagens no grupo. */
export function formatarDuracao(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  if (m < 24 * 60) {
    const h = Math.floor(m / 60)
    const r = m % 60
    return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
  }
  const d = Math.floor(m / (24 * 60))
  const h = Math.floor((m % (24 * 60)) / 60)
  return h ? `${d}d ${h}h` : `${d} ${d === 1 ? 'dia' : 'dias'}`
}
