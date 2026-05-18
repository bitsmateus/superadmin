import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { usersApi } from '@/api/users'
import { type ServerConfig, useAuthStore } from '@/store/authStore'
import { useAllTenants } from './useTenants'
import { asText } from '@/lib/utils'
import type { AppUser, CreateUserPayload, UpdateUserPayload } from '@/types'

export const userKeys = {
  all: ['users'] as const,
  list: (serverId: string, apiId: string | undefined) =>
    [...userKeys.all, 'list', serverId, apiId ?? '_'] as const,
  status: (serverId: string, apiId: string, id: string | number) =>
    [...userKeys.all, 'status', serverId, apiId, id] as const,
}

export function useUsers(server: ServerConfig | undefined, apiId?: string) {
  return useQuery({
    queryKey: userKeys.list(server?.id ?? '_', apiId),
    queryFn: () =>
      server && apiId ? usersApi.list(server, { apiId }) : Promise.resolve([]),
    enabled: Boolean(server) && Boolean(apiId),
  })
}

export interface AggregatedUser extends AppUser {
  _tenantId: string | number
  _tenantName: string
  _apiId: string
  _serverId: string
  _serverName: string
}

export function useAllUsersAcrossServers() {
  const tenantsQ = useAllTenants()
  const serversById = useAuthStore((s) =>
    Object.fromEntries(s.servers.map((x) => [x.id, x])),
  )

  // Build list of (server, apiId, tenant) triples we can fetch
  const targets = tenantsQ.data
    .map((t) => {
      const apiId = typeof t.apiId === 'string' ? t.apiId : ''
      const server = serversById[t._serverId]
      return apiId && server
        ? { server, apiId, tenant: t }
        : null
    })
    .filter((x): x is { server: ServerConfig; apiId: string; tenant: typeof tenantsQ.data[number] } => x !== null)

  const queries = useQueries({
    queries: targets.map(({ server, apiId }) => ({
      queryKey: userKeys.list(server.id, apiId),
      queryFn: () => usersApi.list(server, { apiId }),
    })),
  })

  const data: AggregatedUser[] = []
  for (let i = 0; i < targets.length; i++) {
    const { tenant, apiId, server } = targets[i]
    const users = queries[i]?.data ?? []
    for (const u of users) {
      data.push({
        ...u,
        _tenantId: tenant.id,
        _tenantName: asText(tenant.name, '—'),
        _apiId: apiId,
        _serverId: server.id,
        _serverName: server.name,
      })
    }
  }

  const tenantsWithoutApiId = tenantsQ.data.filter(
    (t) => typeof t.apiId !== 'string' || !t.apiId,
  ).length

  return {
    data,
    isLoading: tenantsQ.isLoading || queries.some((q) => q.isLoading),
    isFetching: tenantsQ.isFetching || queries.some((q) => q.isFetching),
    isError: tenantsQ.isError || queries.some((q) => q.isError),
    error:
      tenantsQ.error ?? (queries.find((q) => q.error)?.error as unknown) ?? null,
    refetch: () => {
      tenantsQ.refetch()
      queries.forEach((q) => q.refetch())
    },
    tenantsWithoutApiId,
  }
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      server,
      apiId,
      payload,
    }: {
      server: ServerConfig
      apiId: string
      payload: CreateUserPayload
    }) => usersApi.create(server, apiId, payload),
    onSuccess: (_res, { server, apiId }) => {
      qc.invalidateQueries({ queryKey: userKeys.list(server.id, apiId) })
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      server,
      apiId,
      payload,
    }: {
      server: ServerConfig
      apiId: string
      payload: UpdateUserPayload
    }) => usersApi.update(server, apiId, payload),
    onSuccess: (_res, { server, apiId }) => {
      qc.invalidateQueries({ queryKey: userKeys.list(server.id, apiId) })
    },
  })
}

export function useUserStatus(
  server: ServerConfig | undefined,
  apiId?: string,
  id?: string | number,
) {
  return useQuery({
    queryKey: userKeys.status(
      server?.id ?? '_',
      apiId ?? '_',
      id as string | number,
    ),
    queryFn: () => usersApi.getStatus(server!, apiId!, { id: id! }),
    enabled:
      Boolean(server) &&
      Boolean(apiId) &&
      id !== undefined &&
      id !== null &&
      id !== '',
  })
}
