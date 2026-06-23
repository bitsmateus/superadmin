import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canaisApi, type ChannelInput, type ServerInput } from '@/api/canais'

export const canaisKeys = {
  all: ['canais'] as const,
  channels: (includeInactive: boolean) => [...canaisKeys.all, 'channels', includeInactive] as const,
  status: () => [...canaisKeys.all, 'status'] as const,
  servers: () => [...canaisKeys.all, 'servers'] as const,
  channelLogs: (id: number) => [...canaisKeys.all, 'logs', id] as const,
  globalLogs: (limit: number) => [...canaisKeys.all, 'globalLogs', limit] as const,
}

// ── Queries ──
export function useChannels(includeInactive = false) {
  return useQuery({
    queryKey: canaisKeys.channels(includeInactive),
    queryFn: () => canaisApi.listChannels(includeInactive),
    refetchInterval: 30_000,
  })
}

export function useChannelsStatus() {
  return useQuery({
    queryKey: canaisKeys.status(),
    queryFn: () => canaisApi.status(),
    refetchInterval: 30_000,
  })
}

export function useChannelLogs(id?: number) {
  return useQuery({
    queryKey: canaisKeys.channelLogs(id ?? 0),
    queryFn: () => canaisApi.channelLogs(id!),
    enabled: typeof id === 'number' && id > 0,
  })
}

export function useGlobalLogs(limit = 100) {
  return useQuery({
    queryKey: canaisKeys.globalLogs(limit),
    queryFn: () => canaisApi.globalLogs(limit),
    refetchInterval: 30_000,
  })
}

export function useServers() {
  return useQuery({
    queryKey: canaisKeys.servers(),
    queryFn: () => canaisApi.listServers(),
  })
}

// ── Mutations ──
function useInvalidateCanais() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: canaisKeys.all })
  }
}

export function useCheckChannel() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (id: number) => canaisApi.checkChannel(id),
    onSuccess: invalidate,
  })
}

export function useToggleAlert() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: ({
      ids,
      alerts_enabled,
      alert_number,
    }: {
      ids: number[]
      alerts_enabled: boolean
      alert_number?: string
    }) => canaisApi.bulkAlerts(ids, alerts_enabled, alert_number),
    onSuccess: invalidate,
  })
}

export function useSendManualAlert() {
  return useMutation({
    mutationFn: ({ id, event }: { id: number; event?: 'disconnected' | 'reconnected' }) =>
      canaisApi.sendAlert(id, event),
  })
}

export function useCreateChannel() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (input: ChannelInput) => canaisApi.createChannel(input),
    onSuccess: invalidate,
  })
}

export function useUpdateChannel() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ChannelInput> }) =>
      canaisApi.updateChannel(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteChannel() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: ({ id, hard }: { id: number; hard?: boolean }) =>
      canaisApi.deleteChannel(id, hard),
    onSuccess: invalidate,
  })
}

export function useImportFromServer() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (serverId: number | 'all') =>
      serverId === 'all' ? canaisApi.importAll() : canaisApi.importFromServer(serverId),
    onSuccess: invalidate,
  })
}

export function useCreateServer() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (input: ServerInput) => canaisApi.createServer(input),
    onSuccess: invalidate,
  })
}

export function useUpdateServer() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ServerInput> }) =>
      canaisApi.updateServer(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteServer() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (id: number) => canaisApi.deleteServer(id),
    onSuccess: invalidate,
  })
}

export function useSyncServer() {
  const invalidate = useInvalidateCanais()
  return useMutation({
    mutationFn: (serverId: number | 'all') =>
      serverId === 'all' ? canaisApi.syncAll() : canaisApi.syncServer(serverId),
    onSuccess: invalidate,
  })
}
