import { api } from '@/services/api'
import type { FlowSpec } from '@/types/chatbotFlow'

export interface ChatbotFlowState {
  spec: FlowSpec | null
  json: unknown
  warnings: string[]
  generatedAt: string | null
  publishedAt: string | null
  generating?: boolean
  generateError?: string | null
  generateErrors?: string[]
}

export interface ChatbotFlowResult {
  spec: FlowSpec
  json: unknown
  warnings: string[]
  errors: string[]
}

export const chatbotFlowApi = {
  /** Grava nome -> id das filas criadas no tenant (usadas ao gerar o roteiro). */
  saveQueues: (clientId: string, queues: Array<{ name: string; id: string }>) =>
    api.put<{ ok: boolean }>(`/api/clients/${clientId}/tenant-queues`, { queues }),
  get: (clientId: string) => api.get<ChatbotFlowState>(`/api/clients/${clientId}/chatbot-flow`),
  /** Dispara a geração (202) e consulta o estado até terminar — evita 502 do proxy. */
  generate: async (clientId: string): Promise<ChatbotFlowState> => {
    await api.post(`/api/clients/${clientId}/chatbot-flow/generate`)
    const started = Date.now()
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000))
      let st: ChatbotFlowState | null = null
      try {
        st = await api.get<ChatbotFlowState>(`/api/clients/${clientId}/chatbot-flow`)
      } catch {
        /* falha momentânea de rede — tenta de novo */
      }
      if (st && !st.generating) {
        if (st.generateError) {
          const err = new Error(st.generateError) as Error & { body?: { errors?: string[] } }
          err.body = { errors: st.generateErrors ?? [] }
          throw err
        }
        return st
      }
      if (Date.now() - started > 10 * 60_000) throw new Error('A geração demorou demais. Tente de novo.')
    }
  },
  saveSpec: (clientId: string, spec: FlowSpec) =>
    api.put<ChatbotFlowResult>(`/api/clients/${clientId}/chatbot-flow/spec`, { spec }),
  publish: (clientId: string) =>
    api.post<{ ok: boolean }>(`/api/clients/${clientId}/chatbot-flow/publish`),
}
