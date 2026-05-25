import * as React from 'react'
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { tenantsApi } from '@/api/tenants'
import {
  type ServerConfig,
  getServerById,
  useAuthStore,
} from '@/store/authStore'
import { asText } from '@/lib/utils'
import type {
  CreateApiPayload,
  DeleteApiPayload,
  ShowTenantPayload,
  StoreTenantPayload,
  Tenant,
  UpdateTenantPayload,
} from '@/types'

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (serverId: string) => [...tenantKeys.all, 'list', serverId] as const,
  detail: (serverId: string, id: string | number) =>
    [...tenantKeys.all, 'detail', serverId, id] as const,
}

export interface TaggedTenant extends Tenant {
  _serverId: string
  _serverName: string
}

function tagTenants(server: ServerConfig, list: Tenant[]): TaggedTenant[] {
  return list.map((t) => ({
    ...t,
    _serverId: server.id,
    _serverName: server.name,
  }))
}

export function useAllTenants() {
  const servers = useAuthStore((s) => s.servers.filter((x) => x.enabled))

  const queries = useQueries({
    queries: servers.map((server) => ({
      queryKey: tenantKeys.list(server.id),
      queryFn: async () => tagTenants(server, await tenantsApi.list(server)),
    })),
  })

  // Hash estável dos query states pra evitar arrays/objetos novos a cada render.
  const queriesSig = queries
    .map(
      (q) =>
        `${q.status}:${q.fetchStatus}:${(q.data as TaggedTenant[] | undefined)?.length ?? 0}:${q.dataUpdatedAt}`,
    )
    .join('|')

  const data = React.useMemo<TaggedTenant[]>(
    () => queries.flatMap((q) => q.data ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queriesSig],
  )

  const errorsByServer = React.useMemo(
    () =>
      queries
        .map((q, i) => ({ server: servers[i], error: q.error as unknown }))
        .filter((x) => x.error),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queriesSig, servers],
  )

  const refetch = React.useCallback(
    () => queries.forEach((q) => q.refetch()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queriesSig],
  )

  const isLoading = queries.some((q) => q.isLoading)
  const isFetching = queries.some((q) => q.isFetching)
  const isError = queries.some((q) => q.isError)
  const firstError = errorsByServer[0]?.error ?? null

  return {
    data,
    isLoading,
    isFetching,
    isError,
    error: firstError,
    errorsByServer,
    refetch,
  }
}

export function useTenant(serverId?: string, id?: string | number) {
  const server = useAuthStore((s) =>
    serverId ? s.servers.find((x) => x.id === serverId) : undefined,
  )
  return useQuery({
    queryKey: tenantKeys.detail(serverId ?? '_', id as string | number),
    queryFn: () => tenantsApi.show(server!, { id: id! }),
    enabled:
      Boolean(server) && id !== undefined && id !== null && id !== '',
  })
}

export function useCreateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      server,
      payload,
    }: {
      server: ServerConfig
      payload: StoreTenantPayload
    }) => tenantsApi.store(server, payload),
    onSuccess: (created, { server }) => {
      qc.invalidateQueries({ queryKey: tenantKeys.list(server.id) })
      const t = created as Tenant
      if (t?.id !== undefined) {
        qc.setQueryData(tenantKeys.detail(server.id, t.id), created)
      }
    },
  })
}

export function useUpdateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      server,
      payload,
    }: {
      server: ServerConfig
      payload: UpdateTenantPayload
    }) => tenantsApi.update(server, payload),
    onSuccess: (_updated, { server, payload }) => {
      qc.invalidateQueries({ queryKey: tenantKeys.list(server.id) })
      if (payload.id !== undefined) {
        qc.invalidateQueries({
          queryKey: tenantKeys.detail(server.id, payload.id),
        })
      }
    },
  })
}

export function useDeleteTenantApi() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      server,
      payload,
    }: {
      server: ServerConfig
      payload: DeleteApiPayload
    }) => tenantsApi.deleteApi(server, payload),
    onSuccess: (_res, { server }) => {
      qc.invalidateQueries({ queryKey: tenantKeys.list(server.id) })
    },
  })
}

export function useShowTenant() {
  return useMutation({
    mutationFn: ({
      server,
      payload,
    }: {
      server: ServerConfig
      payload: ShowTenantPayload
    }) => tenantsApi.show(server, payload),
  })
}

export function useCreateTenantApi() {
  return useMutation({
    mutationFn: ({
      server,
      payload,
    }: {
      server: ServerConfig
      payload: CreateApiPayload
    }) => tenantsApi.createApi(server, payload),
  })
}

// Helper used in details: resolve server for a tagged tenant or via stored id.
export function resolveServer(serverId?: string): ServerConfig | undefined {
  return getServerById(serverId)
}

export function formatServerLabel(t: { _serverName?: string }): string {
  return asText(t._serverName, '—')
}
