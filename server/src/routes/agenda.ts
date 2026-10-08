import { FastifyInstance } from 'fastify';
import {
  isGoogleCalendarConfigured,
  listCalendarEvents,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  rescheduleCalendarEvent,
  getFreeSlots,
  SUPPORT_SUBTYPES,
  type MeetingType,
  type SupportSubtype,
} from '../lib/googleCalendar.js';

function notConfigured(reply: { status: (c: number) => { send: (b: unknown) => unknown } }) {
  return reply.status(400).send({
    message: 'Agenda do Google não configurada — faltam as variáveis GOOGLE_SERVICE_ACCOUNT_* no servidor.',
    code: 'not_configured',
  });
}

/**
 * Agenda compartilhada (Comercial + Suporte) sobre uma única conta do Google
 * Calendar — ver server/src/lib/googleCalendar.ts para o setup e o porquê de
 * não usar OAuth interativo aqui.
 */
export async function agendaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/api/agenda/events',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!isGoogleCalendarConfigured()) return notConfigured(reply);
      const from = req.query.from ? new Date(req.query.from) : new Date();
      const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      try {
        const events = await listCalendarEvents(from.toISOString(), to.toISOString());
        return { events };
      } catch (err) {
        return reply.status(502).send({ message: String((err as Error).message ?? err).slice(0, 300) });
      }
    },
  );

  app.get<{ Querystring: { date?: string; duration?: string } }>(
    '/api/agenda/slots',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!isGoogleCalendarConfigured()) return notConfigured(reply);
      const date = (req.query.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.status(400).send({ message: 'date obrigatório (YYYY-MM-DD)' });
      const duration = Number(req.query.duration ?? 60) || 60;
      try {
        const slots = await getFreeSlots(date, duration);
        return { slots };
      } catch (err) {
        return reply.status(502).send({ message: String((err as Error).message ?? err).slice(0, 300) });
      }
    },
  );

  app.post<{
    Body: {
      tipo?: string;
      subtipo?: string | null;
      clienteId?: string | null;
      clienteNome?: string;
      responsavel?: string;
      start?: string;
      end?: string;
      obs?: string;
    };
  }>('/api/agenda/events', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!isGoogleCalendarConfigured()) return notConfigured(reply);
    const { tipo, subtipo, clienteId, clienteNome, responsavel, start, end, obs } = req.body ?? {};
    if (tipo !== 'comercial' && tipo !== 'suporte') {
      return reply.status(400).send({ message: 'tipo precisa ser "comercial" ou "suporte"' });
    }
    if (subtipo && !SUPPORT_SUBTYPES.includes(subtipo as SupportSubtype)) {
      return reply.status(400).send({ message: 'subtipo inválido' });
    }
    if (!clienteNome?.trim() || !responsavel?.trim() || !start || !end) {
      return reply.status(400).send({ message: 'clienteNome, responsavel, start e end são obrigatórios' });
    }
    try {
      const event = await createCalendarEvent({
        tipo: tipo as MeetingType,
        subtipo: (subtipo as SupportSubtype | null | undefined) ?? null,
        clienteId: clienteId ?? null,
        clienteNome: clienteNome.trim(),
        responsavel: responsavel.trim(),
        start,
        end,
        obs,
      });
      return reply.status(201).send({ event });
    } catch (err) {
      return reply.status(502).send({ message: String((err as Error).message ?? err).slice(0, 300) });
    }
  });

  // Edição completa (modal) ou só reagendamento (arrastar): com `reschedule: true` o corpo precisa
  // apenas de start/end e o resto do evento fica intocado.
  app.patch<{
    Params: { id: string };
    Body: {
      reschedule?: boolean;
      tipo?: string;
      subtipo?: string | null;
      clienteId?: string | null;
      clienteNome?: string;
      responsavel?: string;
      start?: string;
      end?: string;
      obs?: string;
    };
  }>('/api/agenda/events/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!isGoogleCalendarConfigured()) return notConfigured(reply);
    const { reschedule, tipo, subtipo, clienteId, clienteNome, responsavel, start, end, obs } = req.body ?? {};
    if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
      return reply.status(400).send({ message: 'start e end são obrigatórios' });
    }
    try {
      if (reschedule) {
        return { event: await rescheduleCalendarEvent(req.params.id, start, end) };
      }
      if (tipo !== 'comercial' && tipo !== 'suporte') {
        return reply.status(400).send({ message: 'tipo precisa ser "comercial" ou "suporte"' });
      }
      if (subtipo && !SUPPORT_SUBTYPES.includes(subtipo as SupportSubtype)) {
        return reply.status(400).send({ message: 'subtipo inválido' });
      }
      if (!clienteNome?.trim() || !responsavel?.trim()) {
        return reply.status(400).send({ message: 'clienteNome e responsavel são obrigatórios' });
      }
      const event = await updateCalendarEvent(req.params.id, {
        tipo: tipo as MeetingType,
        subtipo: (subtipo as SupportSubtype | null | undefined) ?? null,
        clienteId: clienteId ?? null,
        clienteNome: clienteNome.trim(),
        responsavel: responsavel.trim(),
        start,
        end,
        obs,
      });
      return { event };
    } catch (err) {
      return reply.status(502).send({ message: String((err as Error).message ?? err).slice(0, 300) });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/agenda/events/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    if (!isGoogleCalendarConfigured()) return notConfigured(reply);
    try {
      await deleteCalendarEvent(req.params.id);
      return { ok: true };
    } catch (err) {
      return reply.status(502).send({ message: String((err as Error).message ?? err).slice(0, 300) });
    }
  });
}
