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
