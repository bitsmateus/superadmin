import { api } from '@/services/api'

/** Busca pontual — sem cache/estado. Sugere qual lead_row do CRM provavelmente é o mesmo prospect
 * desse cliente (por telefone, com fallback pro nome/empresa — ver server/src/lib/leadMatch.ts);
 * leadId: null se não achar exatamente 1 correspondência. É só uma SUGESTÃO — quem está gerando o
 * contrato pode confirmar/trocar o vínculo à mão (ver LeadLinkPanel). */
export function suggestCrmLead(clientId: string): Promise<{ leadId: string | null }> {
  return api.get<{ leadId: string | null }>(`/api/clients/${clientId}/crm-lead`)
}

/** Resumo do contrato desse cliente (id + vínculo já confirmado) — sem passar pela allowlist de
 * quadros (GET /api/contracts filtra por lá e fica vazio pra quem não tem acesso ao Comercial,
 * ex.: Suporte). Usado por CrmLeadTab em vez do useContracts() reativo normal. */
export function fetchClientContract(clientId: string): Promise<{ contractId: string | null; vendaLeadId: string | null }> {
  return api.get<{ contractId: string | null; vendaLeadId: string | null }>(`/api/clients/${clientId}/contract`)
}
