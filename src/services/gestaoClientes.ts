import { api } from '@/services/api'

/**
 * Módulo "Clientes NX Digital" — conversa com /api/gc/* (ver server/src/routes/gestaoClientes.ts).
 *
 * Os tipos daqui usam os nomes das colunas (snake_case) em vez de camelCase como o resto dos
 * serviços: as rotas devolvem as linhas das tabelas `gc_*` cruas, e inventar uma camada de
 * tradução pra oito entidades só pra trocar maiúsculas renderia muito código sem nada em troca.
 * Fora deste módulo nada lê esses tipos.
 *
 * Também não tem cache global nem SSE: as telas buscam ao abrir e refazem a busca depois de
 * salvar. As tabelas gc_* não têm trigger de realtime, e são poucos clientes.
 */

export type GcStatusCliente = 'ativo' | 'pausado' | 'encerrado'
export type GcStatusEtapa = 'pendente' | 'em_andamento' | 'concluida'
export type GcTipoServico =
  | 'trafego_meta' | 'trafego_google' | 'central_ia' | 'site' | 'automacao' | 'outro'
export type GcTipoHistorico =
  | 'nota' | 'reuniao' | 'ligacao' | 'reclamacao' | 'ajuste' | 'evento_sistema'

export const TIPOS_SERVICO: { valor: GcTipoServico; label: string }[] = [
  { valor: 'trafego_meta', label: 'Tráfego — Meta' },
  { valor: 'trafego_google', label: 'Tráfego — Google' },
  { valor: 'central_ia', label: 'Central de IA' },
  { valor: 'site', label: 'Site' },
  { valor: 'automacao', label: 'Automação' },
  { valor: 'outro', label: 'Outro' },
]

export const TIPOS_HISTORICO: { valor: GcTipoHistorico; label: string }[] = [
  { valor: 'nota', label: 'Nota' },
  { valor: 'reuniao', label: 'Reunião' },
  { valor: 'ligacao', label: 'Ligação' },
  { valor: 'reclamacao', label: 'Reclamação' },
  { valor: 'ajuste', label: 'Ajuste' },
]

export interface GcServico {
  id: string
  gc_cliente_id: string
  tipo: GcTipoServico
  descricao_plano: string
  investimento_previsto_mensal: string | null
  data_inicio: string | null
  data_renovacao: string | null
  status: 'ativo' | 'pausado' | 'cancelado'
}

export interface GcChecklistItem {
  id: string
  titulo: string
  ordem: number
  concluido: boolean
  concluido_em: string | null
  prazo: string | null
  responsavel_id?: string | null
}

export interface GcEtapaJornada {
  id: string
  gc_cliente_id: string
  nome: string
  ordem: number
  status: GcStatusEtapa
  responsavel_id: string | null
  responsavel_nome: string | null
  prazo: string | null
  concluida_em: string | null
  itens: GcChecklistItem[]
}

export interface GcEstrategia {
  id: string
  gc_cliente_id: string
  nome: string
  objetivo: string
  status: 'planejada' | 'em_execucao' | 'concluida' | 'pausada'
  data_inicio: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  itens: GcChecklistItem[]
}

export interface GcRegistroHistorico {
  id: string
  gc_cliente_id: string
  tipo: GcTipoHistorico
  titulo: string
  descricao: string
  autor_id: string | null
  autor_nome: string | null
  fixado: boolean
  created_at: string
}

/** Linha da lista: o cadastro mais o resumo da jornada, pra tela não precisar abrir cada cliente. */
export interface GcClienteLista {
  id: string
  nome_empresa: string
  nome_contato: string
  whatsapp_contato: string
  email_contato: string
  cnpj: string | null
  cidade: string
  segmento: string
  logo_url: string | null
  responsavel_id: string | null
  responsavel_nome: string | null
  status: GcStatusCliente
  data_inicio: string | null
  observacoes_gerais: string
  created_at: string
  /** Primeira etapa que ainda não foi concluída — null quando a jornada toda acabou. */
  etapa_atual: string | null
  etapas_total: string
  etapas_concluidas: string
  itens_total: string
  itens_concluidos: string
  servicos: Pick<GcServico, 'id' | 'tipo' | 'status' | 'investimento_previsto_mensal'>[]
}

export interface GcClienteDetalhe {
  cliente: GcClienteLista
  servicos: GcServico[]
  jornada: GcEtapaJornada[]
  estrategias: GcEstrategia[]
  historico: GcRegistroHistorico[]
}

export interface GcModelos {
  etapas: { id: string; nome: string; ordem: number; itens: { id: string; titulo: string }[] }[]
  estrategias: {
    id: string; nome: string; descricao: string; servico_tipo: string | null
    passos: { id: string; titulo: string }[]
  }[]
}

/** Campos que a tela de cadastro envia — o servidor ignora qualquer outra chave. */
export type GcClienteEntrada = Partial<{
  nome_empresa: string
  nome_contato: string
  whatsapp_contato: string
  email_contato: string
  cnpj: string
  cidade: string
  segmento: string
  logo_url: string
  responsavel_id: string | null
  status: GcStatusCliente
  data_inicio: string | null
  observacoes_gerais: string
}>

export type GcServicoEntrada = Partial<{
  tipo: GcTipoServico
  descricao_plano: string
  investimento_previsto_mensal: number | string | null
  data_inicio: string | null
  data_renovacao: string | null
  status: 'ativo' | 'pausado' | 'cancelado'
}>

/** Um lançamento de métrica — um valor, de uma chave, num período. */
export interface GcMetrica {
  id: string
  gc_cliente_id: string
  gc_servico_id: string | null
  periodo_inicio: string
  periodo_fim: string
  fonte: 'manual' | 'central' | 'meta_ads' | 'google_ads'
  chave: string
  valor: string
}

export interface GcMeta {
  id: string
  gc_cliente_id: string
  chave_metrica: string
  valor_base: string
  data_base: string | null
  valor_meta: string
  prazo: string | null
  status: 'ativa' | 'atingida' | 'expirada'
}

/**
 * A foto de um relatório publicado. É auto-descritiva (cada número traz label e unidade) porque o
 * portal e o PDF leem só ela: relatório publicado não muda, nem que a métrica do mês seja
 * corrigida depois.
 */
export interface GcSnapshot {
  versao: number
  cliente: { nome_empresa: string; segmento?: string; cidade?: string; responsavel_nome?: string | null }
  periodo: { inicio: string; fim: string; rotulo: string }
  numeros: {
    chave: string
    label: string
    unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal'
    valor: number | null
    anterior?: number | null
  }[]
  metas?: {
    label: string
    unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal'
    base: number
    meta: number
    atual: number | null
    progresso: number | null
  }[]
  jornada?: { nome: string; status: string }[]
  estrategias?: { nome: string; status: string; feitos: number; total: number }[]
  comentario_gestor?: string
  proximos_passos?: string
  publicado_em?: string
}

export interface GcRelatorio {
  id: string
  gc_cliente_id: string
  periodo_inicio: string
  periodo_fim: string
  status: 'rascunho' | 'publicado'
  comentario_gestor: string
  proximos_passos: string
  publicado_em: string | null
  publicado_por_nome?: string | null
  snapshot?: GcSnapshot | null
}

export interface GcLinkPublico {
  id: string
  gc_cliente_id: string
  token: string
  ativo: boolean
  expira_em: string | null
  created_at: string
  acessos: string
  ultimo_acesso: string | null
}

/** Linha da tela de Tráfego: o cliente e os números dele no mês, já pivotados por chave. */
export interface GcLinhaTrafego {
  id: string
  nome_empresa: string
  status: GcStatusCliente
  segmento: string
  responsavel_nome: string | null
  metricas: Record<string, string>
  servicos: { tipo: GcTipoServico; status: string; investimento_previsto_mensal: string | null }[]
}

export const gestaoClientes = {
  modelos: () => api.get<GcModelos>('/api/gc/modelos'),

  listar: () => api.get<GcClienteLista[]>('/api/gc/clientes'),
  detalhe: (id: string) => api.get<GcClienteDetalhe>(`/api/gc/clientes/${id}`),
  criar: (dados: GcClienteEntrada) => api.post<GcClienteLista>('/api/gc/clientes', dados),
  atualizar: (id: string, dados: GcClienteEntrada) =>
    api.patch<GcClienteLista>(`/api/gc/clientes/${id}`, dados),
  excluir: (id: string) => api.delete(`/api/gc/clientes/${id}`),

  criarServico: (clienteId: string, dados: GcServicoEntrada) =>
    api.post<GcServico>(`/api/gc/clientes/${clienteId}/servicos`, dados),
  atualizarServico: (id: string, dados: GcServicoEntrada) =>
    api.patch<GcServico>(`/api/gc/servicos/${id}`, dados),
  excluirServico: (id: string) => api.delete(`/api/gc/servicos/${id}`),

  /** Mexer no status da etapa à mão. Concluir fecha os itens que faltavam no checklist dela. */
  atualizarEtapa: (
    id: string,
    dados: Partial<{ status: GcStatusEtapa; responsavel_id: string | null; prazo: string | null }>,
  ) => api.patch<GcEtapaJornada>(`/api/gc/jornada/${id}`, dados),

  criarItem: (dados: {
    gc_cliente_jornada_id?: string
    gc_cliente_estrategia_id?: string
    titulo: string
    prazo?: string | null
    responsavel_id?: string | null
  }) => api.post<GcChecklistItem>('/api/gc/checklist', dados),
  atualizarItem: (
    id: string,
    dados: Partial<{ concluido: boolean; titulo: string; prazo: string | null; responsavel_id: string | null }>,
  ) => api.patch<GcChecklistItem>(`/api/gc/checklist/${id}`, dados),
  excluirItem: (id: string) => api.delete(`/api/gc/checklist/${id}`),

  /** Aplica uma estratégia modelo (os passos dela viram checklist) ou cria uma em branco. */
  criarEstrategia: (
    clienteId: string,
    dados: {
      estrategia_modelo_id?: string
      nome?: string
      objetivo?: string
      responsavel_id?: string | null
      data_inicio?: string | null
    },
  ) => api.post<GcEstrategia>(`/api/gc/clientes/${clienteId}/estrategias`, dados),
  atualizarEstrategia: (
    id: string,
    dados: Partial<{
      nome: string; objetivo: string; status: GcEstrategia['status']
      data_inicio: string | null; responsavel_id: string | null
    }>,
  ) => api.patch<GcEstrategia>(`/api/gc/estrategias/${id}`, dados),
  excluirEstrategia: (id: string) => api.delete(`/api/gc/estrategias/${id}`),

  metricas: (clienteId: string) => api.get<GcMetrica[]>(`/api/gc/clientes/${clienteId}/metricas`),
  /** Grava o mês inteiro de uma vez. Valor vazio apaga o lançamento (branco ≠ zero). */
  salvarMetricas: (dados: {
    gc_cliente_id: string
    periodo_inicio: string
    periodo_fim: string
    valores: Record<string, number | string | null>
  }) => api.put<GcMetrica[]>('/api/gc/metricas', dados),

  trafego: (periodo: string) =>
    api.get<GcLinhaTrafego[]>(`/api/gc/trafego?periodo=${encodeURIComponent(periodo)}`),

  metas: (clienteId: string) => api.get<GcMeta[]>(`/api/gc/clientes/${clienteId}/metas`),
  criarMeta: (
    clienteId: string,
    dados: { chave_metrica: string; valor_base?: number; data_base?: string | null; valor_meta: number; prazo?: string | null },
  ) => api.post<GcMeta>(`/api/gc/clientes/${clienteId}/metas`, dados),
  atualizarMeta: (id: string, dados: Partial<Omit<GcMeta, 'id' | 'gc_cliente_id'>>) =>
    api.patch<GcMeta>(`/api/gc/metas/${id}`, dados),
  excluirMeta: (id: string) => api.delete(`/api/gc/metas/${id}`),

  relatorios: (clienteId: string) => api.get<GcRelatorio[]>(`/api/gc/clientes/${clienteId}/relatorios`),
  relatorio: (id: string) => api.get<GcRelatorio>(`/api/gc/relatorios/${id}`),
  /** Abre ou atualiza o rascunho do período — um relatório por período, por cliente. */
  salvarRelatorio: (
    clienteId: string,
    dados: { periodo_inicio: string; periodo_fim: string; comentario_gestor: string; proximos_passos: string },
  ) => api.post<GcRelatorio>(`/api/gc/clientes/${clienteId}/relatorios`, dados),
  publicarRelatorio: (id: string, snapshot: GcSnapshot) =>
    api.post<GcRelatorio>(`/api/gc/relatorios/${id}/publicar`, { snapshot }),
  despublicarRelatorio: (id: string) => api.post<GcRelatorio>(`/api/gc/relatorios/${id}/despublicar`),
  excluirRelatorio: (id: string) => api.delete(`/api/gc/relatorios/${id}`),
  /** PDF do relatório. Rascunho ainda não tem snapshot gravado, então manda o da tela. */
  pdfDoRelatorio: (id: string, snapshot?: GcSnapshot) =>
    api.postForBlob(`/api/gc/relatorios/${id}/pdf`, { snapshot }),

  linkDoCliente: (clienteId: string) => api.get<GcLinkPublico | null>(`/api/gc/clientes/${clienteId}/link`),
  gerarLink: (clienteId: string) => api.post<GcLinkPublico>(`/api/gc/clientes/${clienteId}/link`),
  revogarLink: (clienteId: string) => api.delete(`/api/gc/clientes/${clienteId}/link`),

  /** Portal do cliente (sem login) — só relatórios publicados. */
  portal: (token: string) =>
    api.get<{
      cliente: { nome_empresa: string; logo_url: string | null; segmento: string }
      relatorios: (Pick<GcRelatorio, 'id' | 'periodo_inicio' | 'periodo_fim' | 'publicado_em'> & {
        snapshot: GcSnapshot
      })[]
    }>(`/api/public/cliente/${encodeURIComponent(token)}`),

  registrar: (
    clienteId: string,
    dados: { tipo?: GcTipoHistorico; titulo?: string; descricao: string; fixado?: boolean },
  ) => api.post<GcRegistroHistorico>(`/api/gc/clientes/${clienteId}/historico`, dados),
  atualizarRegistro: (id: string, dados: Partial<{ titulo: string; descricao: string; fixado: boolean }>) =>
    api.patch<GcRegistroHistorico>(`/api/gc/historico/${id}`, dados),
  excluirRegistro: (id: string) => api.delete(`/api/gc/historico/${id}`),
}

/** Quanto do checklist do cliente está feito, de 0 a 100. Cliente sem item nenhum dá 0. */
export function progressoDoCliente(c: Pick<GcClienteLista, 'itens_total' | 'itens_concluidos'>): number {
  const total = Number(c.itens_total ?? 0)
  if (!total) return 0
  return Math.round((Number(c.itens_concluidos ?? 0) / total) * 100)
}
