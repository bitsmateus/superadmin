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
  notesCount: number
  position: number
  createdAt: string
  updatedAt: string
  /** Preenchido quando o lead está na Lixeira (soft delete) — null = ativo. */
  deletedAt: string | null
}

export type LeadRowField = Exclude<
  keyof LeadRow,
  'id' | 'boardId' | 'position' | 'createdAt' | 'updatedAt' | 'notesCount' | 'retornado' | 'deletedAt'
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
