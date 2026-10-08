import { api } from '@/services/api'

/** Aba Tráfego — gasto do Meta cruzado com o funil do CRM (ver server/src/routes/trafego.ts). */

export type NivelTrafego = 'campanha' | 'conjunto' | 'anuncio' | 'nicho'
export type FiltroPapel = 'todos' | 'escala' | 'teste'

export interface TotaisTrafego {
  gasto: number; leads: number; agendadas: number; reunioes: number; vendas: number
  cpl: number | null; custoReuniao: number | null; cac: number | null
  mrr: number; implantacao: number; roas: number | null; paybackMeses: number | null
}

export interface PontoSerie { dia: string; gasto: number; leadsMeta: number; leadsCrm: number; reunioes: number }

export interface ResumoTrafego {
  de: string; ate: string
  atual: TotaisTrafego; anterior: TotaisTrafego
  serie: PontoSerie[]
  ultimaSincronizacao: string | null
  primeiroContato: { horasMedia: number | null; comContato: number; total: number }
  configurado: boolean
}

export interface LinhaTrafego {
  id: string; nome: string
  gasto: number; impressoes: number; cliquesLink: number; frequencia: number
  leads: number; agendadas: number; reunioes: number; vendas: number
  cpl: number | null; custoAgendamento: number | null; custoReuniao: number | null; cac: number | null
  mrr: number; implantacao: number; roas: number | null; paybackMeses: number | null
  // metadados (campanha/conjunto/anúncio)
  campaignId?: string | null; adsetId?: string | null
  status?: string; nicho?: string; papel?: string
  orcamentoDia?: number | null
  thumbnail?: string; formato?: string; titulo?: string; previewUrl?: string
  campanhaNome?: string | null; conjuntoNome?: string | null
}

export interface AlertaTrafego {
  id: string; rule: string; level: 'critico' | 'atencao' | 'oportunidade'
  entity_type: string; entity_id: string; message: string; created_at: string; resolved_at?: string
}

export interface LeadDoAnuncio {
  id: string; nome: string; empresa: string; status: string; created_at: string; quadro: string; pagina: string
}

export type CategoriaIa = 'verba' | 'criativo' | 'publico' | 'nicho' | 'copy' | 'operacao'
export interface AcaoMeta { tipo: 'pausar' | 'ativar' | 'orcamento'; nivel: 'campanha' | 'conjunto' | 'anuncio'; id: string; valor?: number }
export interface EstadoMeta { status: string; orcamentoDia: number | null }
export interface PreviaAcao {
  acao: AcaoMeta; nome: string; antes: EstadoMeta; depois: EstadoMeta; titulo: string
  comoFunciona: string[]; avisos: string[]; orcamentoMin: number | null; orcamentoMax: number | null
}
export interface MensagemChat { role: 'user' | 'assistant'; content: string }
export interface SugestaoIa {
  id: string; categoria: CategoriaIa; titulo: string; detalhe: string; dado: string
  status: 'pendente' | 'aceita' | 'ignorada'
  acao?: AcaoMeta
  aplicada?: { em: string; por: string; antes: unknown; depois: unknown; titulo: string; acao: AcaoMeta }
}
export interface NichoRealLinha { mirado: string; real: string; leads: number }

export interface RevisaoIa { dia: string; texto: string; sugestoes: SugestaoIa[]; created_at: string }

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  const out = s.toString()
  return out ? `?${out}` : ''
}

export const trafegoService = {
  resumo: (de: string, ate: string) => api.get<ResumoTrafego>(`/api/trafego/resumo${qs({ de, ate })}`),
  ranking: (nivel: NivelTrafego, de: string, ate: string, papel: FiltroPapel = 'todos') =>
    api.get<{ linhas: LinhaTrafego[] }>(`/api/trafego/ranking${qs({ nivel, de, ate, papel: papel === 'todos' ? undefined : papel })}`),
  serie: (entidade: 'campanha' | 'conjunto' | 'anuncio', id: string, de: string, ate: string) =>
    api.get<{ serie: PontoSerie[] }>(`/api/trafego/serie${qs({ entidade, id, de, ate })}`),
  leads: (chave: 'ad_id' | 'adset_id' | 'campaign_id', id: string) =>
    api.get<{ leads: LeadDoAnuncio[] }>(`/api/trafego/leads${qs({ [chave]: id })}`),
  alertas: () => api.get<{ abertos: AlertaTrafego[]; resolvidos: AlertaTrafego[] }>('/api/trafego/alertas'),
  resolverAlerta: (id: string) => api.post(`/api/trafego/alertas/${id}/resolver`),
  ia: () => api.get<{ revisoes: RevisaoIa[] }>('/api/trafego/ia'),
  nichosReal: (de: string, ate: string) => api.get<{ linhas: NichoRealLinha[] }>(`/api/trafego/nichos-real${qs({ de, ate })}`),
  previaAcao: (acao: AcaoMeta) => api.post<PreviaAcao>('/api/trafego/acoes/previa', { acao }),
  executarAcao: (acao: AcaoMeta, sugestao?: { dia: string; id: string }, reversao = false) =>
    api.post('/api/trafego/acoes/executar', { acao, confirmado: true, sugestao, reversao }),
  conversarSugestao: (dia: string, id: string, mensagem: string, historico: MensagemChat[]) =>
    api.post<{ resposta: string }>(`/api/trafego/ia/${dia}/sugestoes/${id}/chat`, { mensagem, historico }),
  rodarIa: () => api.post<{ iniciado: boolean; rodando: boolean }>('/api/trafego/ia/rodar'),
  statusIa: () => api.get<{ rodando: boolean; erro: string | null; fim: string | null; resultado: { dia: string; sugestoes: number; resumo: string; gravado: boolean } | null }>('/api/trafego/ia/status'),
  marcarSugestao: (dia: string, id: string, status: 'aceita' | 'ignorada' | 'pendente') =>
    api.post(`/api/trafego/ia/${dia}/sugestoes/${id}`, { status }),
  marcarCampanha: (id: string, patch: { nicho?: string; papel?: string }) =>
    api.put(`/api/trafego/campanhas/${id}`, patch),
  sincronizar: () => api.post('/api/trafego/sync'),
}
