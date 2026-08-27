import { api } from '@/services/api'

export interface CrmLeadInfo {
  id: string
  nome: string
  empresa: string
  telefone: string
  status: string
  sdr: string
  tipo: string
  dia_contato: string
  dor_cliente: string
  numero_atendentes: string
  valor_mrr: string
  valor_implementacao: string
  created_at: string
}

export interface CrmLeadNote {
  id: string
  author_name: string
  content: string
  created_at: string
}

export interface CrmLeadLookup {
  lead: CrmLeadInfo | null
  notes: CrmLeadNote[]
}

/** Busca pontual — sem cache/estado. Acha (por telefone, ver server/src/lib/briefingHandoff.ts)
 * o card do CRM que provavelmente é o mesmo prospect desse cliente; lead: null se não achar
 * exatamente 1 correspondência. */
export function lookupCrmLead(clientId: string): Promise<CrmLeadLookup> {
  return api.get<CrmLeadLookup>(`/api/clients/${clientId}/crm-lead`)
}
