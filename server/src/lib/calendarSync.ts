import {
  isGoogleCalendarConfigured,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  type MeetingType,
} from './googleCalendar.js';

/** "YYYY-MM-DDTHH:mm" (datetime-local, sem timezone — formato do AgendamentoField/DeliveryTab no
 * frontend) -> ISO. Brasil não tem mais horário de verão desde 2019, deslocamento fixo é seguro
 * (mesma conta do AgendaPage no frontend). */
export function localDateTimeToISO(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface SyncMeetingInput {
  /** Id do evento já criado numa sincronização anterior, ou null se nunca agendou. */
  calendarEventId: string | null;
  /** Data/hora agendada (ISO) — null/vazio cancela (apaga) o evento existente. */
  scheduledAtISO: string | null;
  durationMin?: number;
  tipo: MeetingType;
  clienteId?: string | null;
  clienteNome: string;
  responsavel: string;
  obs?: string;
}

/**
 * Cria, reagenda ou cancela o evento no Google Calendar conforme a reunião muda — chamado sempre
 * que Briefing, Entrega (Reunião de treinamento) ou o Agendamento do Comercial são salvos. Devolve
 * o calendar_event_id pra persistir na linha (reminders/clients/lead_rows): reagendar de novo
 * reusa esse id (PATCH) em vez de criar um evento duplicado a cada salvamento.
 *
 * Nunca lança: Google fora do ar, ainda não configurado, ou o evento ter sido apagado manualmente
 * no Google não pode derrubar o save principal da tela que chamou isto.
 */
export async function syncScheduledMeeting(input: SyncMeetingInput): Promise<string | null> {
  if (!isGoogleCalendarConfigured()) return input.calendarEventId;
  try {
    if (!input.scheduledAtISO) {
      if (input.calendarEventId) await deleteCalendarEvent(input.calendarEventId).catch(() => {});
      return null;
    }
    const start = input.scheduledAtISO;
    const end = new Date(new Date(start).getTime() + (input.durationMin ?? 60) * 60_000).toISOString();
    const payload = {
      tipo: input.tipo,
      clienteId: input.clienteId ?? null,
      clienteNome: input.clienteNome,
      responsavel: input.responsavel,
      start,
      end,
      obs: input.obs,
    };
    if (input.calendarEventId) {
      try {
        const updated = await updateCalendarEvent(input.calendarEventId, payload);
        return updated.id;
      } catch (err) {
        // Evento pode ter sido apagado manualmente no Google (ou id ficou velho) — cria de novo.
        console.warn('[calendarSync] evento existente não pôde ser atualizado, criando novo:', err);
      }
    }
    const created = await createCalendarEvent(payload);
    return created.id;
  } catch (err) {
    console.error('[calendarSync] falha ao sincronizar reunião com o Google Calendar:', err);
    return input.calendarEventId;
  }
}
