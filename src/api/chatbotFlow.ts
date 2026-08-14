import { api } from '@/services/api'
import type { FlowSpec } from '@/types/chatbotFlow'

export interface ChatbotFlowState {
  spec: FlowSpec | null
  json: unknown
  warnings: string[]
  generatedAt: string | null
  publishedAt: string | null
}

export interface ChatbotFlowResult {
  spec: FlowSpec
  json: unknown
  warnings: string[]
  errors: string[]
}

export const chatbotFlowApi = {
  get: (clientId: string) => api.get<ChatbotFlowState>(`/api/clients/${clientId}/chatbot-flow`),
  generate: (clientId: string) =>
    api.post<ChatbotFlowResult>(`/api/clients/${clientId}/chatbot-flow/generate`),
  saveSpec: (clientId: string, spec: FlowSpec) =>
    api.put<ChatbotFlowResult>(`/api/clients/${clientId}/chatbot-flow/spec`, { spec }),
  publish: (clientId: string) =>
    api.post<{ ok: boolean }>(`/api/clients/${clientId}/chatbot-flow/publish`),
}
