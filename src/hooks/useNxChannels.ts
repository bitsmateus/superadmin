import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { channelsApi, type AlertConfigInput } from '@/api/channels'

export function useNxChannels() {
  return useQuery({
    queryKey: ['nx-channels'],
    queryFn: () => channelsApi.list(),
    refetchInterval: 30_000,
  })
}

export function useSetChannelAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: AlertConfigInput) => channelsApi.setAlertConfig(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nx-channels'] }),
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
