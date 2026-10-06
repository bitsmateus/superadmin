import { api } from '@/services/api'

export type MeetingType = 'comercial' | 'suporte'

export interface CalendarEvent {
  id: string
  tipo: MeetingType | null
  title: string
  clienteNome: string | null
  clienteId: string | null
  responsavel: string | null
  start: string
  end: string
  meetLink: string | null
  htmlLink: string | null
}

export interface FreeSlot {
  start: string
  end: string
}

export interface CreateMeetingInput {
  tipo: MeetingType
  clienteId?: string | null
  clienteNome: string
  responsavel: string
  start: string
  end: string
  obs?: string
}

export const agendaApi = {
  listEvents: (fromISO: string, toISO: string) =>
    api.get<{ events: CalendarEvent[] }>(`/api/agenda/events?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`),
  getFreeSlots: (date: string, durationMin: number) =>
    api.get<{ slots: FreeSlot[] }>(`/api/agenda/slots?date=${date}&duration=${durationMin}`),
  createMeeting: (input: CreateMeetingInput) => api.post<{ event: CalendarEvent }>('/api/agenda/events', input),
  deleteMeeting: (id: string) => api.delete(`/api/agenda/events/${encodeURIComponent(id)}`),
}
