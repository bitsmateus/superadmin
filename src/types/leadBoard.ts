/**
 * Tipos do quadro de leads (Comercial > Novos Leads, estilo Monday).
 *
 * Convenção: snake_case dentro do banco, camelCase do lado do app.
 * O service mapeia um pro outro.
 */

/** Aba do Comercial onde o quadro aparece — id de uma lead_page (gerenciável por admin). */
export type LeadBoardPage = string

/** Aba do Comercial (Novos Leads, CRM NX Luis, CRM NX Arthur, e as que um admin criar/duplicar
 * depois). Admin pode duplicar (só a estrutura de quadros, sem leads) e arquivar/restaurar. */
export interface LeadPage {
  id: string
  name: string
  position: number
  archivedAt: string | null
}

export interface LeadBoard {
  id: string
  name: string
  color: string
  page: LeadBoardPage
  position: number
  createdAt: string
  /** Quadro que recebe as oportunidades quando um lead vira "Vendido". Só um no sistema. */
  isVendas: boolean
}

export interface LeadRow {
  id: string
  boardId: string
  nome: string
  tipo: string
  empresa: string
  telefone: string
  diaContato: string
  ligacao: string
  status: string
  /** Dia em que o SDR agendou a reunião com o lead. */
  agendamento: string
  retornar: string
  retornado: boolean
  responsavel: string
  sdr: string
  numero: string
  dorCliente: string
  numeroAtendentes: string
  valorMrr: string
  valorImplementacao: string
  /** Data de fechamento da venda (yyyy-mm-dd). Só preenchida em oportunidades. */
  fechamento: string
  /** Lead que gerou esta oportunidade. null = venda lançada à mão pelo botão "Registrar venda". */
  vendaOrigemId: string | null
  /** Venda desfeita (o lead saiu de "Vendido"). Fica no quadro, mas fora dos totais. */
  vendaRevertida: boolean
  notesCount: number
  position: number
  createdAt: string
  updatedAt: string
  /** Preenchido quando o lead está na Lixeira (soft delete) — null = ativo. */
  deletedAt: string | null
  /** Motivo informado ao excluir uma venda (aba Vendas) — null pra lead comum. */
  deleteReason: string | null
}

/**
 * Campos de texto do lead — os que viram coluna editável na tabela do quadro.
 *
 * Fora da lista ficam os que não são string ou não se editam ali: id/boardId/position/datas,
 * `retornado` (booleano) e os de controle da venda (`vendaOrigemId`, `vendaRevertida`), que o
 * sistema preenche sozinho quando o lead vira "Vendido". `fechamento` fica DENTRO porque é uma
 * data que o time ajusta à mão na aba Vendas.
 */
export type LeadRowField = Exclude<
  keyof LeadRow,
  | 'id' | 'boardId' | 'position' | 'createdAt' | 'updatedAt' | 'notesCount' | 'retornado'
  | 'deletedAt' | 'deleteReason' | 'vendaOrigemId' | 'vendaRevertida'
>

/** Arquivo anexado a uma atualização (imagem/PDF), guardado como data URL. */
export interface LeadNoteAttachment {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
}

/** Anotação/atualização do bloco lateral de um lead (estilo "Updates" do Monday). */
export interface LeadNote {
  id: string
  leadRowId: string
  authorId: string | null
  authorName: string
  content: string
  attachments: LeadNoteAttachment[]
  createdAt: string
}

/** Tipo de evento gravado automaticamente na linha do tempo do lead. */
export type LeadEventType = 'created' | 'status' | 'dia_contato' | 'sdr' | 'board' | 'retornado'

/** Entrada da linha do tempo automática — gravada pelo backend a cada mudança relevante. */
export interface LeadEvent {
  id: string
  leadRowId: string
  type: LeadEventType
  fromValue: string | null
  toValue: string | null
  actorName: string
  createdAt: string
}

/** Campos que usam etiqueta colorida selecionável (estilo Monday) em vez de texto livre. */
export type LeadLabelField = 'tipo' | 'diaContato' | 'status' | 'sdr' | 'ligacao'

export interface LeadLabel {
  id: string
  field: LeadLabelField
  name: string
  color: string
  position: number
  createdAt: string
}
