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

/** Quem a equipe atende primeiro quando o dia não dá pra todos. */
export type GcPrioridade = 'alta' | 'media' | 'baixa'

export const PRIORIDADES: { valor: GcPrioridade; label: string; ajuda: string }[] = [
  { valor: 'alta', label: 'Alta', ajuda: 'conta grande ou momento delicado — olhar todo dia' },
  { valor: 'media', label: 'Média', ajuda: 'acompanhamento normal' },
  { valor: 'baixa', label: 'Baixa', ajuda: 'rodando sozinho, revisar de vez em quando' },
]
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

/** Print ou arquivo colado num registro — mesmo formato dos anexos do CRM. */
export interface GcAnexo {
  id: string
  name: string
  type: string
  size: number
  /** data URL (base64). Fica no banco, como o resto dos anexos do projeto. */
  dataUrl: string
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
  anexos: GcAnexo[]
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
  prioridade: GcPrioridade
  /** Teste/arquivado: aparece nas listas, mas não entra em nenhum total. */
  fora_dos_totais: boolean
  data_inicio: string | null
  observacoes_gerais: string
  created_at: string
  /** Primeira etapa que ainda não foi concluída — null quando a jornada toda acabou. */
  etapa_atual: string | null
  etapas_total: string
  etapas_concluidas: string
  etapas_atrasadas: string
  itens_total: string
  itens_concluidos: string
  itens_atrasados: string
  /** Último registro feito por uma PESSOA (evento do sistema não conta como contato). */
  ultimo_contato: string | null
  /** Primeiro dia do período do último relatório publicado. */
  ultimo_relatorio: string | null
  /** Última vez que o cliente abriu o portal. Null = nunca abriu (ou nunca teve link). */
  ultimo_acesso_portal: string | null
  /** A renovação mais próxima entre os serviços ativos. */
  proxima_renovacao: string | null
  /** Id do MODELO da etapa atual — é o que coloca o card na coluna certa do Kanban. */
  etapa_atual_modelo_id: string | null
  servicos: Pick<
    GcServico,
    'id' | 'tipo' | 'status' | 'investimento_previsto_mensal' | 'data_renovacao'
  >[]
  metas: GcMeta[]
  /** Números do mês de referência e do anterior, pivotados por chave. */
  metricas_mes: Record<string, string>
  metricas_mes_anterior: Record<string, string>
  /** Como o gestor avaliou o resultado DESTE mês. Null = ninguém deu nota ainda. */
  avaliacao: GcAvaliacao | null
  /** Situação do relatório do mês de referência. Null = nem rascunho existe. */
  relatorio_mes: 'rascunho' | 'publicado' | null
}

export interface GcClienteDetalhe {
  cliente: GcClienteLista
  servicos: GcServico[]
  jornada: GcEtapaJornada[]
  estrategias: GcEstrategia[]
  historico: GcRegistroHistorico[]
}

export interface GcModeloEstrategia {
  id: string
  nome: string
  descricao: string
  servico_tipo: string | null
  /** Desativado some dos seletores, mas continua existindo pra quem já recebeu a estratégia. */
  ativo: boolean
  passos: { id: string; titulo: string; ordem: number }[]
}

export interface GcModelos {
  etapas: { id: string; nome: string; ordem: number; itens: { id: string; titulo: string }[] }[]
  estrategias: GcModeloEstrategia[]
}

/**
 * Os avisos de "números não batem" que o servidor devolve (409) quando a tela deixou passar algo —
 * ou null se o erro é outro. É a rede de proteção: a tela confere antes, mas a regra vale no
 * servidor, e quando ele recusa a gente mostra os mesmos avisos em vez de um erro seco.
 */
export function avisosDoErro(err: unknown): string[] | null {
  const e = err as { status?: number; body?: { avisos?: string[] } }
  return e?.status === 409 && Array.isArray(e.body?.avisos) ? e.body!.avisos! : null
}

/** O que mover um cliente de etapa faria — a base da janela de confirmação. */
export interface GcPreviaMover {
  origem?: string
  destino?: string
  sem_mudanca?: boolean
  ok?: boolean
  /** Etapas que ficariam pra trás e seriam concluídas, com quantos itens ainda faltavam. */
  fechar?: { nome: string; itens_abertos: number }[]
  /** Etapas reabertas (voltar no tempo), com quantos itens marcados seriam desmarcados. */
  reabrir?: { nome: string; itens_marcados: number }[]
}

/** Um item de checklist ABERTO, de qualquer cliente que conta nos totais. */
export interface GcPendencia {
  id: string
  titulo: string
  prazo: string | null
  cliente_id: string
  cliente_nome: string
  origem: 'jornada' | 'estrategia'
  origem_nome: string
  /** Em cascata: item, depois etapa/estratégia, depois o cliente. */
  responsavel_id: string | null
  responsavel_nome: string | null
  atrasado: boolean
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
  prioridade: GcPrioridade
  fora_dos_totais: boolean
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

/** A nota que uma pessoa dá pro resultado do mês — o julgamento, não o cálculo. */
export type GcNivelAvaliacao = 'otimo' | 'bom' | 'regular' | 'ruim'

export const NIVEIS_AVALIACAO: { valor: GcNivelAvaliacao; label: string; ajuda: string }[] = [
  { valor: 'otimo', label: 'Ótimo', ajuda: 'resultado acima do combinado' },
  { valor: 'bom', label: 'Bom', ajuda: 'dentro do esperado' },
  { valor: 'regular', label: 'Regular', ajuda: 'entregou, mas abaixo do que dava' },
  { valor: 'ruim', label: 'Ruim', ajuda: 'resultado não veio — precisa de ação' },
]

export interface GcAvaliacao {
  nivel: GcNivelAvaliacao
  comentario: string
  atualizado_em: string | null
  autor_nome: string | null
  periodo_inicio: string
}

/** Horizonte da meta: a mesma métrica tem alvo pro mês, pro semestre e pro ano. */
export type GcHorizonte = 'mes' | '6_meses' | '12_meses'

export const HORIZONTES: { valor: GcHorizonte; label: string; curto: string }[] = [
  { valor: 'mes', label: 'Meta do mês', curto: 'mês' },
  { valor: '6_meses', label: 'Meta de 6 meses', curto: '6 meses' },
  { valor: '12_meses', label: 'Meta de 12 meses', curto: '12 meses' },
]

export interface GcMeta {
  id: string
  gc_cliente_id: string
  chave_metrica: string
  horizonte: GcHorizonte
  /** Ponto de partida: onde o cliente estava quando a meta foi combinada. */
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
    /** Subir é bom? Em CPL/CAC não — é o que define a cor da variação no portal e no PDF. */
    subirEhBom?: boolean
  }[]
  /** O essencial pro cliente, já escolhido aqui: quanto investiu, quanto vendeu, quanto voltou. */
  resumo?: {
    investimento: number | null
    vendas: number | null
    receita: number | null
    retorno: number | null
  }
  metas?: {
    label: string
    unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal'
    base: number
    meta: number
    atual: number | null
    progresso: number | null
    horizonte?: GcHorizonte
    prazo?: string | null
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

export const gestaoClientes = {
  /** `todos` traz também os modelos desativados — a tela de gestão precisa vê-los pra reativar. */
  modelos: (todos = false) => api.get<GcModelos>(`/api/gc/modelos${todos ? '?todos=1' : ''}`),

  criarModeloEstrategia: (dados: {
    nome: string; descricao?: string; servico_tipo?: string | null; passos?: string[]
  }) => api.post<GcModeloEstrategia>('/api/gc/modelos/estrategias', dados),
  atualizarModeloEstrategia: (
    id: string,
    dados: Partial<{ nome: string; descricao: string; servico_tipo: string | null; ativo: boolean }>,
  ) => api.patch<GcModeloEstrategia>(`/api/gc/modelos/estrategias/${id}`, dados),
  criarPassoDeModelo: (id: string, titulo: string) =>
    api.post<{ id: string; titulo: string }>(`/api/gc/modelos/estrategias/${id}/passos`, { titulo }),
  ordenarPassosDeModelo: (id: string, ids: string[]) =>
    api.put(`/api/gc/modelos/estrategias/${id}/passos/ordem`, { ids }),
  renomearPassoDeModelo: (id: string, titulo: string) =>
    api.patch(`/api/gc/modelos/passos/${id}`, { titulo }),
  excluirPassoDeModelo: (id: string) => api.delete(`/api/gc/modelos/passos/${id}`),

  pendencias: () => api.get<GcPendencia[]>('/api/gc/pendencias'),

  /**
   * Leva o cliente pra outra etapa. SEM `confirmar` só descreve o que aconteceria (etapas que seriam
   * concluídas ou reabertas); COM `confirmar` executa. Mover mexe em checklist, então a tela mostra
   * a prévia antes. `etapaModeloId` = 'fim' leva pra jornada concluída.
   */
  moverEtapa: (clienteId: string, etapaModeloId: string, confirmar = false) =>
    api.post<GcPreviaMover>(`/api/gc/clientes/${clienteId}/mover-etapa`, {
      etapa_modelo_id: etapaModeloId,
      confirmar,
    }),

  /** Sem período, o servidor usa o mês de hoje em Brasília. */
  listar: (periodo?: string) =>
    api.get<GcClienteLista[]>(`/api/gc/clientes${periodo ? `?periodo=${encodeURIComponent(periodo)}` : ''}`),
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

  /** A nota do mês. Sem período, o servidor usa o mês de hoje em Brasília. */
  avaliar: (
    clienteId: string,
    dados: { nivel: GcNivelAvaliacao; comentario?: string; periodo?: string },
  ) => api.put<GcAvaliacao>(`/api/gc/clientes/${clienteId}/avaliacao`, dados),
  limparAvaliacao: (clienteId: string, periodo?: string) =>
    api.delete(
      `/api/gc/clientes/${clienteId}/avaliacao${periodo ? `?periodo=${encodeURIComponent(periodo)}` : ''}`,
    ),
  avaliacoes: (clienteId: string) =>
    api.get<(GcAvaliacao & { id: string; periodo_fim: string })[]>(
      `/api/gc/clientes/${clienteId}/avaliacoes`,
    ),

  metricas: (clienteId: string) => api.get<GcMetrica[]>(`/api/gc/clientes/${clienteId}/metricas`),
  /** Grava o mês inteiro de uma vez. Valor vazio apaga o lançamento (branco ≠ zero). */
  salvarMetricas: (dados: {
    gc_cliente_id: string
    periodo_inicio: string
    periodo_fim: string
    valores: Record<string, number | string | null>
    /** A pessoa viu os avisos de números incoerentes e quer salvar mesmo assim. */
    confirmar_avisos?: boolean
  }) => api.put<GcMetrica[]>('/api/gc/metricas', dados),

  /** Mesma forma da lista: a tela de Tráfego mostra o semáforo do mesmo jeito. */
  /** Grava o mês de vários clientes numa transação só (a grade "Lançar mês"). */
  salvarMetricasEmLote: (dados: {
    periodo: string
    linhas: { gc_cliente_id: string; valores: Record<string, number | null> }[]
    confirmar_avisos?: boolean
  }) =>
    api.put<{ clientes: number; gravados: number; apagados: number }>('/api/gc/metricas/lote', dados),

  trafego: (periodo: string) =>
    api.get<GcClienteLista[]>(`/api/gc/trafego?periodo=${encodeURIComponent(periodo)}`),

  metas: (clienteId: string) => api.get<GcMeta[]>(`/api/gc/clientes/${clienteId}/metas`),
  criarMeta: (
    clienteId: string,
    dados: {
      chave_metrica: string; horizonte: GcHorizonte; valor_base?: number
      data_base?: string | null; valor_meta: number; prazo?: string | null
    },
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
  publicarRelatorio: (id: string, snapshot: GcSnapshot, confirmarAvisos = false) =>
    api.post<GcRelatorio>(`/api/gc/relatorios/${id}/publicar`, {
      snapshot,
      confirmar_avisos: confirmarAvisos,
    }),
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
    dados: {
      tipo?: GcTipoHistorico; titulo?: string; descricao: string; fixado?: boolean; anexos?: GcAnexo[]
    },
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
