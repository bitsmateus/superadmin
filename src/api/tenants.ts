import { apiRequest } from './client'
import type { ServerConfig } from '@/store/authStore'
import type {
  CreateApiPayload,
  CreateSessionTenantPayload,
  DeleteApiPayload,
  SessionResponse,
  ShowTenantPayload,
  StoreTenantPayload,
  Tenant,
  TenantListResponse,
  UpdateTenantPayload,
} from '@/types'

function unwrap<T = unknown>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in (data as object)) {
    const inner = (data as { data: unknown }).data
    if (inner !== undefined) return inner as T
  }
  return data as T
}

export const tenantsApi = {
  async list(server: ServerConfig): Promise<Tenant[]> {
    const data = await apiRequest<TenantListResponse | Tenant[]>(server, {
      method: 'GET',
      url: '/tenantApiListTenants',
    })
    if (Array.isArray(data)) return data
    return data.data ?? data.tenants ?? data.items ?? []
  },

  async show(server: ServerConfig, payload: ShowTenantPayload): Promise<Tenant> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantApiShowTenant',
      data: payload,
    })
    return unwrap<Tenant>(data)
  },

  async store(server: ServerConfig, payload: StoreTenantPayload): Promise<Tenant> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantApiStoreTenant',
      data: payload,
    })
    return unwrap<Tenant>(data)
  },

  async update(server: ServerConfig, payload: UpdateTenantPayload): Promise<Tenant> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantApiUpdateTenant',
      data: payload,
    })
    return unwrap<Tenant>(data)
  },

  async createApi(server: ServerConfig, payload: CreateApiPayload): Promise<unknown> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantCreateApi',
      data: payload,
    })
    return unwrap(data)
  },

  async deleteApi(server: ServerConfig, payload: DeleteApiPayload): Promise<unknown> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantDeleteApi',
      data: payload,
    })
    return unwrap(data)
  },

  async createSession(
    server: ServerConfig,
    payload: CreateSessionTenantPayload,
  ): Promise<SessionResponse> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: '/tenantApiCreateSession',
      data: payload,
    })
    return unwrap<SessionResponse>(data)
  },
}
