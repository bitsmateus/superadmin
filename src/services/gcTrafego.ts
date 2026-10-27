import { api } from '@/services/api'

/**
 * Tráfego (Meta) dos clientes NX Digital — painel da carteira e aba Tráfego do cliente
 * (ver server/src/routes/gcTrafego.ts). Números de gc_meta_*, coletados 4x por dia.
 */

export interface GcTotaisTrafego {
  gasto: number; impressoes: number; alcance: number; cliques: number
  leads: number; conversas: number; compras: number; valorCompras: number
  resultados: number; custoResultado: number | null; ctr: number | null; cpm: number | null; roas: number | null
}

export type GcNivelAlerta = 'critico' | 'atencao' | 'oportunidade'

export interface GcAlertaTrafego {
  id: string; regra: string; nivel: GcNivelAlerta; mensagem: string; created_at: string
  gc_cliente_id?: string; nome_empresa?: string
}

export interface GcContaTrafego {
  id: string; gc_cliente_id: string; ad_account_id: string; nome: string; moeda: string; ativo: boolean
  ultimo_sync_em: string | null; ultimo_erro: string | null; tem_token: boolean; created_at: string
}

export interface GcCampanhaTrafego extends GcTotaisTrafego {
  id: string; nome: string; status: string; objetivo: string; orcamentoDia: number | null
}

export interface GcAnuncioTrafego extends GcTotaisTrafego {
  id: string; nome: string; status: string; formato: string; thumbnail: string; titulo: string; texto: string
  previewUrl: string; conjunto: string; campanha: string; frequencia: number | null
}

export interface GcTrafegoCliente {
  de: string; ate: string; anterior: { de: string; ate: string }
  contas: GcContaTrafego[]
  totais: { atual: GcTotaisTrafego; anterior: GcTotaisTrafego }
  serie: { dia: string; gasto: number; resultados: number }[]
  campanhas: GcCampanhaTrafego[]
  anuncios: GcAnuncioTrafego[]
  alertas: GcAlertaTrafego[]
  benchmark: GcBenchmark | null
  /** Gasto do mês corrente contra a verba prevista no serviço Tráfego Meta (null = não cadastrada). */
  ritmo: { gastoMes: number; previstoMes: number | null }
}

export type GcStatusTrafego = 'ok' | 'atencao' | 'critico' | 'sem_conta'

export interface GcLinhaPainel {
  id: string; nome: string; logoUrl: string | null; prioridade: string; segmento: string; responsavel: string | null
  contas: number; ultimoSync: string | null; status: GcStatusTrafego
  semana: GcTotaisTrafego | null; semanaAnterior: GcTotaisTrafego | null; mes: GcTotaisTrafego | null
  previstoMes: number | null; alertas: number; notaIa: number | null
}

export interface GcAtualizacao {
  id: string; gc_cliente_id: string; tipo: string; titulo: string; descricao: string; created_at: string
  nome_empresa: string; autor_nome: string | null
}

export interface GcPainelTrafego {
  semana: { de: string; ate: string }; semanaAnterior: { de: string; ate: string }; inicioMes: string
  clientes: GcLinhaPainel[]
  alertas: GcAlertaTrafego[]
  atualizacoes: GcAtualizacao[]
}

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v)
  const out = s.toString()
  return out ? `?${out}` : ''
}

export const gcTrafego = {
  painel: () => api.get<GcPainelTrafego>('/api/gc/trafego/painel'),
  marcarVisto: (id: string) => api.post(`/api/gc/trafego/alertas/${id}/visto`),
  doCliente: (id: string, de: string, ate: string) =>
    api.get<GcTrafegoCliente>(`/api/gc/clientes/${id}/trafego${qs({ de, ate })}`),
  vincularConta: (id: string, ad_account_id: string, token?: string) =>
    api.post<GcContaTrafego>(`/api/gc/clientes/${id}/trafego/contas`, { ad_account_id, token: token || undefined }),
  desvincularConta: (contaId: string) => api.delete(`/api/gc/trafego/contas/${contaId}`),
  salvarPrevisto: (id: string, valor: number | null) =>
    api.put<{ previstoMes: number | null }>(`/api/gc/clientes/${id}/trafego/previsto`, { valor }),
  sincronizar: (id: string) =>
    api.post<{ resultados: { conta: string; ok: boolean; linhas: number; erro?: string }[] }>(`/api/gc/clientes/${id}/trafego/sincronizar`),
}

// ── IA, conteúdo e Instagram ─────────────────────────────────────────────────

export interface GcBenchmark { segmento: string; clientes: number; custoResultado: number | null; ctr: number | null; cpm: number | null }

export interface GcAnaliseTrafegoIa {
  nota: number | null; resumo: string; pontos_fortes: string[]; problemas: string[]
  sugestoes: { prioridade: 'alta' | 'media' | 'baixa'; titulo: string; detalhe: string; dado: string }[]
  ideias_criativos: { titulo: string; formato: string; gancho: string; descricao: string }[]
  mensagem_cliente: string
}

export interface GcIdeiasConteudoIa {
  diagnostico: string
  padroes: { padrao: string; evidencia: string }[]
  roteiros_video: { titulo: string; objetivo: string; duracao: string; gancho: string; cenas: string[]; cta: string; legenda: string }[]
  artes: { titulo: string; formato: string; texto_arte: string[]; briefing_visual: string; legenda: string }[]
}

export interface GcAnaliseIa<T> {
  id: string; dia: string; origem: 'manual' | 'auto'; conteudo: T; created_at: string; gerado_por_nome: string | null
}

export interface GcInstagramConta {
  ig_user_id: string; username: string; seguidores: number | null; ultimo_sync_em: string | null; ultimo_erro: string | null; tem_token: boolean
}

export interface GcPostInstagram {
  id: string; tipo: string; produto: string; legenda: string; permalink: string; thumbnail: string; publicadoEm: string | null
  curtidas: number; comentarios: number; alcance: number | null; salvos: number | null; compartilhamentos: number | null
  visualizacoes: number | null; interacoes: number; engajamento: number | null
}

export interface GcMensagemChat { role: 'user' | 'assistant'; content: string }

export const gcIa = {
  ultima: <T,>(id: string, tipo: 'trafego' | 'conteudo') =>
    api.get<{ analise: GcAnaliseIa<T> | null; gerando: boolean; iaConfigurada: boolean }>(`/api/gc/clientes/${id}/ia/${tipo}`),
  gerar: <T,>(id: string, tipo: 'trafego' | 'conteudo', pedido?: string) =>
    api.post<{ analise: GcAnaliseIa<T> }>(`/api/gc/clientes/${id}/ia/${tipo}/gerar`, { pedido: pedido || undefined }),
  chat: (id: string, mensagem: string, historico: GcMensagemChat[]) =>
    api.post<{ resposta: string }>(`/api/gc/clientes/${id}/ia/chat`, { mensagem, historico }),
  instagram: (id: string, dias = 90) =>
    api.get<{ conta: GcInstagramConta | null; posts: GcPostInstagram[] }>(`/api/gc/clientes/${id}/instagram?dias=${dias}`),
  perfisDisponiveis: (token?: string) =>
    api.post<{ perfis: { igUserId: string; username: string; pagina: string }[] }>('/api/gc/instagram/disponiveis', { token: token || undefined }),
  vincularInstagram: (id: string, ig_user_id: string, token?: string) =>
    api.post<{ ok: boolean; username: string }>(`/api/gc/clientes/${id}/instagram`, { ig_user_id, token: token || undefined }),
  desvincularInstagram: (id: string) => api.delete(`/api/gc/clientes/${id}/instagram`),
  sincronizarInstagram: (id: string) =>
    api.post<{ ok: boolean; posts: number; erro?: string }>(`/api/gc/clientes/${id}/instagram/sincronizar`),
}
