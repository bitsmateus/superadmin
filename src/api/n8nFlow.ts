import { api } from '@/services/api'

export interface N8nChannel {
  serverId: string
  serverName: string
  sessionType: string
  apiId: string
  numbers: string[]
}

export interface N8nFlowData {
  agentName: string
  prompt: string
  warnings: string[]
  json: unknown
  generatedAt: string
  webhookPath: string
}

export interface N8nFlowState {
  generating: boolean
  generateError: string | null
  channel: N8nChannel | null
  flow: N8nFlowData | null
}

const base = (clientId: string) => `/api/clients/${clientId}/n8n-flow`

export const n8nFlowApi = {
  get: (clientId: string) => api.get<N8nFlowState>(base(clientId)),
  savePrompt: (clientId: string, prompt: string) => api.put<{ ok: boolean }>(`${base(clientId)}/prompt`, { prompt }),
  /** Dispara a geração (202) e consulta até terminar — evita 502 do proxy. */
  generate: async (clientId: string, notes?: string): Promise<N8nFlowState> => {
    await api.post(`${base(clientId)}/generate`, { notes })
    const started = Date.now()
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000))
      let st: N8nFlowState | null = null
      try {
        st = await api.get<N8nFlowState>(base(clientId))
      } catch {
        /* falha momentânea de rede — tenta de novo */
      }
      if (st && !st.generating) {
        if (st.generateError) throw new Error(st.generateError)
        return st
      }
      if (Date.now() - started > 10 * 60_000) throw new Error('A geração demorou demais. Tente de novo.')
    }
  },
}
