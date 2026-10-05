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
