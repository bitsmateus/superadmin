/**
 * Tipos do quadro de leads (Comercial > Novos Leads, estilo Monday).
 *
 * Convenção: snake_case dentro do banco, camelCase do lado do app.
 * O service mapeia um pro outro.
 */

export interface LeadBoard {
  id: string
  name: string
  color: string
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
  status: string
  retornar: string
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
}

export type LeadRowField = Exclude<
  keyof LeadRow,
  'id' | 'boardId' | 'position' | 'createdAt' | 'updatedAt' | 'notesCount'
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

/** Campos que usam etiqueta colorida selecionável (estilo Monday) em vez de texto livre. */
export type LeadLabelField = 'tipo' | 'diaContato' | 'status'

export interface LeadLabel {
  id: string
  field: LeadLabelField
  name: string
  color: string
  position: number
  createdAt: string
}
