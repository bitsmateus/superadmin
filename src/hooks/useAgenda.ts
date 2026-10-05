import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agendaApi, type CreateMeetingInput } from '@/api/agenda'

export function useAgendaEvents(fromISO: string, toISO: string) {
  return useQuery({
    queryKey: ['agenda-events', fromISO, toISO],
    queryFn: () => agendaApi.listEvents(fromISO, toISO),
  })
}

export function useAgendaSlots(date: string | null, durationMin: number) {
  return useQuery({
    queryKey: ['agenda-slots', date, durationMin],
    queryFn: () => agendaApi.getFreeSlots(date as string, durationMin),
    enabled: Boolean(date),
  })
}

export function useCreateMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMeetingInput) => agendaApi.createMeeting(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  })
}

export function useDeleteMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => agendaApi.deleteMeeting(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  })
}
