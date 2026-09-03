import { api } from '@/services/api'
import type {
  RequestTarget,
  TemplateButton,
  TemplateRequest,
  TemplateRequestPublicData,
  TemplateVariable,
} from '@/types/templateRequest'

/** Chamadas autenticadas (lado da equipe) — gerar/listar links, verificar status na Meta. */
export const templateRequestsApi = {
  create: (clientId: string) =>
    api.post<{ id: string; token: string; status: string }>(`/api/clients/${clientId}/template-requests`),
  list: (clientId: string) => api.get<TemplateRequest[]>(`/api/clients/${clientId}/template-requests`),
  refreshStatus: (clientId: string, requestId: string, wabaId: string) =>
    api.post<TemplateRequest>(
      `/api/clients/${clientId}/template-requests/${requestId}/refresh-status?wabaId=${encodeURIComponent(wabaId)}`,
    ),
}

/** Chamadas públicas (sem login) — usadas pela página que o cliente abre pelo link. */
export const publicTemplateRequestApi = {
  get: (token: string) => api.get<TemplateRequestPublicData>(`/api/public/template-requests/${token}`),
  submit: (
    token: string,
    body: { purpose: string; body: string; variables: TemplateVariable[]; buttons: TemplateButton[]; wabaIds: string[] },
  ) => api.post<{ ok: boolean; targets: RequestTarget[] }>(`/api/public/template-requests/${token}/submit`, body),
}
