import { api } from '@/services/api'
import type {
  ApprovedTemplate,
  MassCampaignContact,
  MassCampaignRecipient,
  MassCampaignSummary,
  VariableMappingEntry,
} from '@/types/massCampaign'

/** Chamada autenticada (lado da equipe) — gera/reaproveita o link fixo do portal do cliente. */
export const massCampaignPortalApi = {
  create: (clientId: string) => api.post<{ token: string }>(`/api/clients/${clientId}/mass-campaign-portal`),
}

/** Chamadas públicas (sem login) — usadas pelo portal que o cliente abre em /laundry/:token. */
export const publicMassCampaignApi = {
  get: (token: string) =>
    api.get<{ clientName: string; campaigns: MassCampaignSummary[] }>(`/api/public/laundry/${token}`),
  templates: (token: string) =>
    api.get<{ numberLabel: string; templates: ApprovedTemplate[] }>(`/api/public/laundry/${token}/templates`),
  importPreview: (token: string, data: string) =>
    api.post<{ header: string[]; sample: Record<string, string>[]; totalRows: number }>(
      `/api/public/laundry/${token}/import-preview`,
      { data },
    ),
  create: (
    token: string,
    body: {
      name: string
      templateName: string
      templateLanguage: string
      delaySeconds: number
      contactIds?: string[]
      mapping: VariableMappingEntry[]
    },
  ) => api.post<{ id: string; total: number }>(`/api/public/laundry/${token}`, body),
  duplicate: (token: string, campaignId: string) =>
    api.post<{ id: string; total: number }>(`/api/public/laundry/${token}/${campaignId}/duplicate`),
  remove: (token: string, campaignId: string) =>
    api.delete(`/api/public/laundry/${token}/${campaignId}`),
  start: (token: string, campaignId: string) =>
    api.post(`/api/public/laundry/${token}/${campaignId}/start`),
  pause: (token: string, campaignId: string) =>
    api.post(`/api/public/laundry/${token}/${campaignId}/pause`),
  report: (token: string, campaignId: string, offset = 0, status?: string) =>
    api.get<{
      campaign: MassCampaignSummary
      counts: { total: string; sent: string; failed: string; queued: string }
      recipients: MassCampaignRecipient[]
    }>(
      `/api/public/laundry/${token}/${campaignId}?offset=${offset}${status ? `&status=${status}` : ''}`,
    ),
}

/** Lista de contatos persistente do cliente — desacoplada de campanha, reaproveitada na criação
 *  de quantas campanhas quiser. */
export const publicMassContactsApi = {
  list: (token: string, offset = 0, q?: string) =>
    api.get<{ total: number; columns: string[]; contacts: MassCampaignContact[] }>(
      `/api/public/laundry/${token}/contacts?offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  import: (token: string, body: { data: string; phoneColumn: string; ddi?: string; ddd?: string }) =>
    api.post<{ created: number; updated: number; skipped: number }>(
      `/api/public/laundry/${token}/contacts/import`,
      body,
    ),
  add: (token: string, body: { phone: string; fields: Record<string, string> }) =>
    api.post<MassCampaignContact>(`/api/public/laundry/${token}/contacts`, body),
  update: (token: string, contactId: string, body: { phone?: string; fields?: Record<string, string> }) =>
    api.patch<MassCampaignContact>(`/api/public/laundry/${token}/contacts/${contactId}`, body),
  remove: (token: string, contactId: string) =>
    api.delete(`/api/public/laundry/${token}/contacts/${contactId}`),
}
