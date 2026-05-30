import { apiRequest } from './client'
import type { ServerConfig } from '@/store/authStore'
import type {
  AppUser,
  CreateUserPayload,
  UpdateUserPayload,
  UserListResponse,
  UserStatusResponse,
} from '@/types'

function unwrap<T = unknown>(data: unknown): T {
  if (data && typeof data === 'object' && 'data' in (data as object)) {
    const inner = (data as { data: unknown }).data
    if (inner !== undefined) return inner as T
  }
  return data as T
}

export interface ListUsersParams {
  apiId: string
  pageNumber?: number
}

export const usersApi = {
  async list(
    server: ServerConfig,
    { apiId, pageNumber = 1 }: ListUsersParams,
  ): Promise<AppUser[]> {
    if (!apiId) return []
    const data = await apiRequest<UserListResponse | AppUser[]>(server, {
      method: 'GET',
      url: `/v2/api/external/${encodeURIComponent(apiId)}/listUsers`,
      params: { pageNumber },
    })
    if (Array.isArray(data)) return data
    return data.data ?? data.users ?? data.items ?? []
  },

  async create(
    server: ServerConfig,
    apiId: string,
    payload: CreateUserPayload,
    apiToken?: string,
  ): Promise<AppUser> {
    const data = await apiRequest(
      server,
      {
        method: 'POST',
        url: `/v2/api/external/${encodeURIComponent(apiId)}/createUser`,
        data: payload,
      },
      apiToken,
    )
    return unwrap<AppUser>(data)
  },

  async update(
    server: ServerConfig,
    apiId: string,
    payload: UpdateUserPayload,
  ): Promise<AppUser> {
    const data = await apiRequest(server, {
      method: 'POST',
      url: `/v2/api/external/${encodeURIComponent(apiId)}/updateUser`,
      data: payload,
    })
    return unwrap<AppUser>(data)
  },

  async getStatus(
    server: ServerConfig,
    apiId: string,
    params: { id?: string | number; email?: string },
  ): Promise<UserStatusResponse> {
    const data = await apiRequest(server, {
      method: 'GET',
      url: `/v2/api/external/${encodeURIComponent(apiId)}/getUserStatus`,
      params,
    })
    return unwrap<UserStatusResponse>(data)
  },
}
