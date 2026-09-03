export interface TemplateVariable {
  position: number
  example: string
}

export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'COPY_CODE'

export interface TemplateButton {
  type: TemplateButtonType
  text?: string
  urlBase?: string
  dynamic?: boolean
  example?: string
}

/** Um número do WhatsApp oficial (WABA) do tenant, pro cliente escolher onde criar o template. */
export interface WabaNumberOption {
  wabaId: string
  label: string
}

/** Resultado da criação do template em UM número específico. */
export interface RequestTarget {
  wabaId: string
  label: string
  status: 'submitted' | 'failed'
  externalId?: string
  metaStatus?: string
  errorMessage?: string
}

export interface TemplateRequest {
  id: string
  token: string
  status: 'pending' | 'submitted' | 'failed'
  purpose: string | null
  templateName: string | null
  body: string | null
  category: string | null
  targets: RequestTarget[]
  createdAt: string
  submittedAt: string | null
}

/** Dados da página pública (GET /api/public/template-requests/:token). */
export interface TemplateRequestPublicData {
  status: 'pending' | 'submitted' | 'failed'
  purpose: string | null
  templateName: string | null
  targets: RequestTarget[]
  numbers: WabaNumberOption[]
  clientName: string
}
