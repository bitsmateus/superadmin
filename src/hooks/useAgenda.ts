import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agendaApi, type CalendarEvent, type CreateMeetingInput } from '@/api/agenda'

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

export function useUpdateMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateMeetingInput }) => agendaApi.updateMeeting(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  })
}

/** Mover por arrastar: atualiza a tela na hora e desfaz se o Google recusar. */
export function useRescheduleMeeting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, start, end }: { id: string; start: string; end: string }) =>
      agendaApi.rescheduleMeeting(id, start, end),
    onMutate: async ({ id, start, end }) => {
      await qc.cancelQueries({ queryKey: ['agenda-events'] })
      const anteriores = qc.getQueriesData<{ events: CalendarEvent[] }>({ queryKey: ['agenda-events'] })
      qc.setQueriesData<{ events: CalendarEvent[] }>({ queryKey: ['agenda-events'] }, (old) =>
        old ? { events: old.events.map((e) => (e.id === id ? { ...e, start, end } : e)) } : old,
      )
      return { anteriores }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.anteriores.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['agenda-events'] }),
  })
}
