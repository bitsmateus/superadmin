import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { channelsApi, type AlertConfigInput, type NxChannelsResponse } from '@/api/channels'

export function useNxChannels() {
  return useQuery({
    queryKey: ['nx-channels'],
    queryFn: () => channelsApi.list(),
    refetchInterval: 30_000,
  })
}

export function useChannelReport(enabled = true) {
  return useQuery({
    queryKey: ['nx-channels-report'],
    queryFn: () => channelsApi.report(),
    refetchInterval: 30_000,
    enabled,
  })
}

export function useSetChannelAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AlertConfigInput) => channelsApi.setAlertConfig(input),
    // Otimista: muda o "Sim/Não" do canal na hora, sem esperar o refetch lento
    // (que reconcilia todos os tenants).
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ['nx-channels'] })
      const prev = qc.getQueryData<NxChannelsResponse>(['nx-channels'])
      qc.setQueryData<NxChannelsResponse>(['nx-channels'], (old) => {
        if (!old) return old
        return {
          ...old,
          channels: (old.channels ?? []).map((c) =>
            c.channel_key === input.channel_key ? { ...c, alerts_enabled: input.alerts_enabled } : c,
          ),
        }
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['nx-channels'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['nx-channels'] }),
  })
}

export function useAssignChannel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      provider,
      instance_key,
      client_id,
    }: {
      provider: string
      instance_key: string
      client_id: string | null
    }) => channelsApi.assign(provider, instance_key, client_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nx-channels'] }),
  })
}

export function useArchiveOrphans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      items,
      archived,
    }: {
      items: { provider: string; instance_key: string; name?: string | null; number?: string | null }[]
      archived: boolean
    }) => channelsApi.archiveOrphans(items, archived),
    // Otimista: move os avulsos entre "avulsos" e "arquivados" na hora, sem
    // esperar o refetch (que é lento pois reconcilia todos os tenants).
    onMutate: async ({ items, archived }) => {
      await qc.cancelQueries({ queryKey: ['nx-channels'] })
      const prev = qc.getQueryData<NxChannelsResponse>(['nx-channels'])
      const keys = new Set(items.map((i) => `${i.provider}:${i.instance_key}`))
      qc.setQueryData<NxChannelsResponse>(['nx-channels'], (old) => {
        if (!old) return old
        const k = (o: { provider: string; instance_key: string }) => `${o.provider}:${o.instance_key}`
        if (archived) {
          const moved = (old.orphans ?? []).filter((o) => keys.has(k(o)))
          return {
            ...old,
            orphans: (old.orphans ?? []).filter((o) => !keys.has(k(o))),
            archivedOrphans: [...moved, ...(old.archivedOrphans ?? [])],
          }
        }
        const moved = (old.archivedOrphans ?? []).filter((o) => keys.has(k(o)))
        return {
          ...old,
          archivedOrphans: (old.archivedOrphans ?? []).filter((o) => !keys.has(k(o))),
          orphans: [...moved, ...(old.orphans ?? [])],
        }
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['nx-channels'], ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['nx-channels'] }),
  })
}

export function useDeleteInstance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      provider,
      instance_key,
      server,
    }: {
      provider: string
      instance_key: string
      server: string | null
    }) => channelsApi.deleteInstance(provider, instance_key, server),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nx-channels'] }),
  })
}
