import { api } from '@/services/api'

export type MeetingType = 'comercial' | 'suporte'
/** Subtipo das reuniões de suporte (só pra equipe — métrica de atendimento). */
export type SupportSubtype = 'entrega' | 'alinhamento' | 'ia' | 'retencao'

export const SUPPORT_SUBTYPES: { value: SupportSubtype; label: string }[] = [
  { value: 'entrega', label: 'Entrega' },
  { value: 'alinhamento', label: 'Alinhamento' },
  { value: 'ia', label: 'IA' },
  { value: 'retencao', label: 'Retenção' },
]

export interface CalendarEvent {
  id: string
  tipo: MeetingType | null
  subtipo: SupportSubtype | null
  title: string
  clienteNome: string | null
  clienteId: string | null
  responsavel: string | null
  obs: string | null
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
  subtipo?: SupportSubtype | null
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
  updateMeeting: (id: string, input: CreateMeetingInput) =>
    api.patch<{ event: CalendarEvent }>(`/api/agenda/events/${encodeURIComponent(id)}`, input),
  /** Arrastar na agenda: muda só o horário. */
  rescheduleMeeting: (id: string, start: string, end: string) =>
    api.patch<{ event: CalendarEvent }>(`/api/agenda/events/${encodeURIComponent(id)}`, { reschedule: true, start, end }),
  deleteMeeting: (id: string) => api.delete(`/api/agenda/events/${encodeURIComponent(id)}`),
}
