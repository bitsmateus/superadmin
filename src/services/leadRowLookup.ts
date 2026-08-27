import { api } from '@/services/api'

export interface SupportLeadInfo {
  id: string
  nome: string
  empresa: string
  telefone: string
  tipo: string
  dia_contato: string
  status: string
  sdr: string
  dor_cliente: string
  numero_atendentes: string
  valor_mrr: string
  valor_implementacao: string
  created_at: string
}

export interface SupportLeadNoteAttachment {
  id: string
  name: string
  type: string
  size: number
  dataUrl: string
}

export interface SupportLeadNote {
  id: string
  author_name: string
  content: string
  attachments: SupportLeadNoteAttachment[]
  created_at: string
}

/** Card de leitura de uma lead específica (ver GET /api/lead-rows/:id/support-view) — não passa
 * pela allowlist de quadros (restrictedBoardFilter), então funciona mesmo pra quem (ex.: Suporte)
 * não tem acesso ao Comercial como um todo. Usado como fallback em LeadLinkPanel quando a lead não
 * está no cache reativo normal (useLeadRow) por falta desse acesso mais amplo. */
export function fetchSupportLeadView(leadId: string): Promise<{ lead: SupportLeadInfo; notes: SupportLeadNote[] }> {
  return api.get(`/api/lead-rows/${leadId}/support-view`)
}
