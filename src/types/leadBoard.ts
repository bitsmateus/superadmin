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
  ligacao: string
  responsavel: string
  numero: string
  dorCliente: string
  numeroAtendentes: string
  valorPrevisto: string
  valorFechado: string
  notesCount: number
  position: number
  createdAt: string
  updatedAt: string
}

export type LeadRowField = Exclude<
  keyof LeadRow,
  'id' | 'boardId' | 'position' | 'createdAt' | 'updatedAt' | 'notesCount'
>

/** Anotação/atualização do bloco lateral de um lead (estilo "Updates" do Monday). */
export interface LeadNote {
  id: string
  leadRowId: string
  authorId: string | null
  authorName: string
  content: string
  createdAt: string
}
