import axios from 'axios'

// Lista de canais reconciliada (NX × provedor real), servida pelo próprio
// superadmin (/api/channels). Same-origin, autenticada pelo JWT do painel.
const BACKEND_URL = import.meta.env.VITE_API_URL ?? ''

const http = axios.create({ baseURL: `${BACKEND_URL}/api` })
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export type NxChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown'

export interface NxChannel {
  channel_key: string
  source: 'nx' | 'provider'
  client_id: string | null
  client_name: string
  client_company: string | null
  server_id: string | null
  nx_channel_id: number | string
  name: string
  type: string
  number: string | null
  token_api: string | null
  waba_id: string | null
  is_active: boolean
  nx_status: NxChannelStatus
  real_status: NxChannelStatus | null
  divergent: boolean
  effective_status: NxChannelStatus
  alerts_enabled: boolean
  alert_number: string | null
}

export interface OrphanInstance {
  provider: 'uazapi' | 'evolution'
  instance_key: string
  name: string
  number: string | null
  status: NxChannelStatus
  server: string | null
}

export interface NxChannelsSummary {
  total: number
  connected: number
  disconnected: number
  connecting: number
  unknown: number
  divergent: number
  orphans: number
}

export interface UnlinkedTenant {
  client_id: string
  name: string
  company: string | null
  tenant_id: string | null
  tenant_api_id: string | null
  server_id: string | null
}

export interface NxChannelsResponse {
  channels: NxChannel[]
  orphans: OrphanInstance[]
  summary: NxChannelsSummary
  errors: { client: string; error: string | null }[]
  providerErrors: string[]
  unlinkedTenants: UnlinkedTenant[]
  updated_at: string
}

export interface AlertConfigInput {
  channel_key: string
  alerts_enabled: boolean
  alert_number?: string
}

export const channelsApi = {
  async list(): Promise<NxChannelsResponse> {
    const { data } = await http.get<NxChannelsResponse>('/channels')
    return data
  },
  async setAlertConfig(input: AlertConfigInput): Promise<void> {
    await http.post('/channels/alert-config', input)
  },
  async sendAlertTest(number: string): Promise<void> {
    await http.post('/channels/alert-test', { number })
  },
  async assign(provider: string, instance_key: string, client_id: string | null): Promise<void> {
    await http.post('/channels/assign', { provider, instance_key, client_id })
  },
}
