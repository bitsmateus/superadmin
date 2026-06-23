import axios from 'axios'

// Chama same-origin /api/canais/* (proxy do Fastify → NX Monitor). O JWT do
// painel autentica; a API key do NX Monitor fica só no servidor.
const BACKEND_URL = import.meta.env.VITE_API_URL ?? ''

const http = axios.create({ baseURL: `${BACKEND_URL}/api/canais` })
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown'
export type ChannelType = 'uazapi' | 'evolution' | 'waba' | 'baileys'

export interface Channel {
  id: number
  nx_channel_id: string | null
  external_id: string | null
  server_id: number | null
  server_name: string | null
  name: string
  number: string | null
  type: ChannelType | string
  session_name: string | null
  client_name: string | null
  client_number: string | null
  alert_number: string | null
  alerts_enabled: 0 | 1
  active: 0 | 1
  created_at: string
  status: ChannelStatus
  source_nx: string | null
  source_external: string | null
  last_seen: string | null
  disconnected_at: string | null
  status_updated_at: string | null
}

export interface StatusSummary {
  total: number
  connected: number
  disconnected: number
  connecting: number
  unknown: number
  updated_at: string | null
}

export interface ChannelLog {
  id: number
  channel_id: number
  event: string
  source: string | null
  notified_at: string
  channel_name?: string
  client_name?: string | null
  type?: string
}

export interface MonitorServer {
  id: number
  name: string
  type: 'uazapi' | 'evolution' | 'baileys' | string
  url: string
  has_token: boolean
  active: 0 | 1
  channel_count: number
}

export interface ChannelInput {
  name: string
  type: ChannelType
  number?: string
  session_name?: string
  server_id?: number
  external_id?: string
  client_name?: string
  client_number?: string
  alert_number?: string
  alerts_enabled?: boolean
}

export interface CheckResult {
  status: ChannelStatus
  source?: string
  nx?: unknown
  external?: unknown
  previous?: ChannelStatus
}

export interface ImportResult {
  created: number
  skipped: number
  total: number
}

export interface SyncResult {
  removed?: number
  checked?: number
  total?: number
}

export interface ServerInput {
  name: string
  type: 'uazapi' | 'evolution' | 'baileys'
  url: string
  token?: string
}

function unwrap<T>(data: unknown, key?: string): T {
  if (key && data && typeof data === 'object' && key in (data as object)) {
    return (data as Record<string, unknown>)[key] as T
  }
  return data as T
}

export const canaisApi = {
  // ── Canais ──
  async listChannels(includeInactive = false): Promise<Channel[]> {
    const { data } = await http.get('/channels', {
      params: includeInactive ? { all: 1 } : undefined,
    })
    if (Array.isArray(data)) return data
    return unwrap<Channel[]>(data, 'channels') ?? []
  },
  async createChannel(input: ChannelInput): Promise<Channel> {
    const { data } = await http.post('/channels', input)
    return unwrap<Channel>(data, 'channel')
  },
  async updateChannel(id: number, patch: Partial<ChannelInput>): Promise<Channel> {
    const { data } = await http.put(`/channels/${id}`, patch)
    return unwrap<Channel>(data, 'channel')
  },
  async deleteChannel(id: number, hard = false): Promise<void> {
    await http.delete(`/channels/${id}`, { params: hard ? { hard: 1 } : undefined })
  },
  async deleteInstance(id: number): Promise<void> {
    await http.delete(`/channels/${id}/instance`)
  },
  async bulkAlerts(ids: number[], alerts_enabled: boolean, alert_number?: string): Promise<void> {
    await http.post('/channels/bulk-alerts', { ids, alerts_enabled, alert_number })
  },
  async channelLogs(id: number): Promise<ChannelLog[]> {
    const { data } = await http.get(`/channels/${id}/logs`)
    if (Array.isArray(data)) return data
    return unwrap<ChannelLog[]>(data, 'logs') ?? []
  },
  async checkChannel(id: number): Promise<CheckResult> {
    const { data } = await http.post(`/channels/${id}/check`)
    return data as CheckResult
  },
  async sendAlert(id: number, event?: 'disconnected' | 'reconnected'): Promise<void> {
    await http.post(`/channels/${id}/alert`, event ? { event } : {})
  },

  // ── Resumo / logs ──
  async status(): Promise<StatusSummary> {
    const { data } = await http.get('/status')
    return data as StatusSummary
  },
  async globalLogs(limit = 100): Promise<ChannelLog[]> {
    const { data } = await http.get('/logs', { params: { limit } })
    if (Array.isArray(data)) return data
    return unwrap<ChannelLog[]>(data, 'logs') ?? []
  },

  // ── Servidores ──
  async listServers(): Promise<MonitorServer[]> {
    const { data } = await http.get('/servers')
    if (Array.isArray(data)) return data
    return unwrap<MonitorServer[]>(data, 'servers') ?? []
  },
  async createServer(input: ServerInput): Promise<MonitorServer> {
    const { data } = await http.post('/servers', input)
    return unwrap<MonitorServer>(data, 'server')
  },
  async updateServer(id: number, patch: Partial<ServerInput>): Promise<MonitorServer> {
    const { data } = await http.put(`/servers/${id}`, patch)
    return unwrap<MonitorServer>(data, 'server')
  },
  async deleteServer(id: number): Promise<void> {
    await http.delete(`/servers/${id}`)
  },
  async importFromServer(serverId: number): Promise<ImportResult> {
    const { data } = await http.post(`/servers/${serverId}/import`)
    return data as ImportResult
  },
  async importAll(): Promise<ImportResult> {
    const { data } = await http.post('/servers/import-all')
    return data as ImportResult
  },
  async syncServer(id: number): Promise<SyncResult> {
    const { data } = await http.post(`/servers/${id}/sync`)
    return data as SyncResult
  },
  async syncAll(): Promise<SyncResult> {
    const { data } = await http.post('/servers/sync-all')
    return data as SyncResult
  },
}
