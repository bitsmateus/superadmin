import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

export async function publicRoutes(app: FastifyInstance) {
  // POST /api/public/briefing/:token — get briefing data
  app.get<{ Params: { token: string } }>(
    '/api/public/briefing/:token',
    async (req, reply) => {
      const row = await queryOne(
        `SELECT id, name, company, briefing_status, briefing_data, briefing_revision_note
         FROM clients WHERE briefing_token = $1`,
        [req.params.token]
      );
      if (!row) return reply.status(404).send({ message: 'Token inválido' });
      return row;
    }
  );

  // POST /api/public/briefing/:token — submit briefing
  app.post<{ Params: { token: string }; Body: { data: Record<string, unknown> } }>(
    '/api/public/briefing/:token',
    async (req, reply) => {
      const { token } = req.params;
      const { data } = req.body;
      const existing = await queryOne(
        'SELECT id, logs FROM clients WHERE briefing_token = $1',
        [token]
      ) as { id: string; logs: unknown[] } | null;
      if (!existing) return reply.status(404).send({ message: 'Token inválido' });

      const newLog = { id: uuidv4(), action: 'Briefing preenchido pelo cliente', createdAt: new Date().toISOString() };
      const logs = [...(existing.logs as unknown[] ?? []), newLog];

      await query(
        `UPDATE clients SET briefing_data = $1, briefing_status = 'filled', logs = $2 WHERE briefing_token = $3`,
        [JSON.stringify(data), JSON.stringify(logs), token]
      );
      return { ok: true };
    }
  );

  // POST /api/public/support-lookup
  app.post<{ Body: { email: string } }>(
    '/api/public/support-lookup',
    async (req) => {
      const { email } = req.body;
      const client = await queryOne<{ id: string; name: string; company: string }>(
        'SELECT id, name, company FROM clients WHERE lower(email) = lower(trim($1)) LIMIT 1',
        [email]
      );
      if (!client) return [];
      const [{ count }] = await query<{ count: string }>(
        `SELECT count(*)::int as count FROM tickets WHERE client_id = $1 AND status NOT IN ('resolved','closed')`,
        [client.id]
      );
      return [{ client_id: client.id, client_name: client.name, client_company: client.company, open_tickets: parseInt(count) }];
    }
  );

  // POST /api/public/tickets — create public ticket
  app.post<{
    Body: {
      customer_email: string;
      customer_name: string;
      customer_cnpj?: string;
      customer_phone?: string;
      customer_company?: string;
      category_id?: string;
      subject: string;
      description?: string;
      triage_path?: unknown[];
    };
  }>(
    '/api/public/tickets',
    async (req, reply) => {
      const b = req.body;

      if (b.subject.length > 200) return reply.status(400).send({ message: 'Assunto muito longo.' });
      if ((b.description ?? '').length > 5000) return reply.status(400).send({ message: 'Descrição muito longa.' });

      // Try to match client by email
      const matchedClient = await queryOne<{ id: string; company: string }>(
        'SELECT id, company FROM clients WHERE lower(email) = lower(trim($1)) LIMIT 1',
        [b.customer_email]
      );

      // Get category defaults
      let slaHours = 24;
      let priority = 'normal';
      if (b.category_id) {
        const cat = await queryOne<{ default_sla_hours: number; default_priority: string }>(
          'SELECT default_sla_hours, default_priority FROM ticket_categories WHERE id = $1',
          [b.category_id]
        );
        if (cat) { slaHours = cat.default_sla_hours; priority = cat.default_priority; }
      }

      const publicToken = uuidv4();
      const [ticket] = await query<{ id: string; number: number; public_token: string }>(
        `INSERT INTO tickets (
          client_id, category_id,
          customer_name, customer_email, customer_cnpj, customer_phone, customer_company,
          subject, description, triage_path,
          needs_linking, sla_hours, priority, public_token
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, number, public_token`,
        [
          matchedClient?.id ?? null, b.category_id ?? null,
          b.customer_name, b.customer_email.trim(), b.customer_cnpj ?? null,
          b.customer_phone ?? null,
          b.customer_company ?? matchedClient?.company ?? null,
          b.subject, b.description ?? null,
          JSON.stringify(b.triage_path ?? []),
          matchedClient === null, slaHours, priority, publicToken,
        ]
      );

      // Insert initial message
      await query(
        `INSERT INTO ticket_messages (ticket_id, author_type, author_name, content)
         VALUES ($1, 'customer', $2, $3)`,
        [ticket.id, b.customer_name, b.description ?? '(sem descrição)']
      );

      return reply.status(201).send({
        ticket_id: ticket.id,
        ticket_number: ticket.number,
        public_token: ticket.public_token,
      });
    }
  );

  // GET /api/public/tickets/:token
  app.get<{ Params: { token: string } }>(
    '/api/public/tickets/:token',
    async (req, reply) => {
      const ticket = await queryOne(
        `SELECT t.id, t.number, t.subject, t.status, t.priority,
                t.customer_name, t.customer_email, t.customer_company,
                t.opened_at, t.last_message_at, t.category_id
         FROM tickets t WHERE t.public_token = $1`,
        [req.params.token]
      ) as Record<string, unknown> | null;
      if (!ticket) return reply.status(404).send({ message: 'Token inválido' });

      const messages = await query(
        `SELECT id, author_type, author_name, content, created_at
         FROM ticket_messages WHERE ticket_id = $1 AND is_internal = false ORDER BY created_at`,
        [ticket.id as string]
      );
      return { ...ticket, messages };
    }
  );

  // POST /api/public/tickets/:token/messages
  app.post<{
    Params: { token: string };
    Body: { author_name: string; content: string };
  }>(
    '/api/public/tickets/:token/messages',
    async (req, reply) => {
      const { content } = req.body;
      if (content.length > 5000) return reply.status(400).send({ message: 'Mensagem muito longa.' });

      const ticket = await queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM tickets WHERE public_token = $1',
        [req.params.token]
      );
      if (!ticket) return reply.status(404).send({ message: 'Token inválido.' });
      if (['resolved', 'closed'].includes(ticket.status)) {
        return reply.status(400).send({ message: 'Ticket já encerrado.' });
      }

      await query(
        `INSERT INTO ticket_messages (ticket_id, author_type, author_name, content)
         VALUES ($1, 'customer', $2, $3)`,
        [ticket.id, req.body.author_name, content]
      );
      return { ok: true };
    }
  );

  // GET /api/public/nps/:token
  app.get<{ Params: { token: string } }>(
    '/api/public/nps/:token',
    async (req, reply) => {
      const nps = await queryOne<{ id: string; responded_at: string | null }>(
        `SELECT n.id, c.company as client_company, c.name as client_name, n.responded_at
         FROM nps_responses n JOIN clients c ON c.id = n.client_id
         WHERE n.public_token = $1`,
        [req.params.token]
      ) as Record<string, unknown> | null;
      if (!nps) return reply.status(404).send({ message: 'Token inválido' });
      return { ...nps, responded: nps.responded_at !== null };
    }
  );

  // POST /api/public/nps/:token
  app.post<{
    Params: { token: string };
    Body: { score: number; comment?: string };
  }>(
    '/api/public/nps/:token',
    async (req, reply) => {
      const { score, comment } = req.body;
      const classification =
        score >= 9 ? 'promoter' : score >= 7 ? 'neutral' : 'detractor';

      await query(
        `UPDATE nps_responses
         SET score = $1, comment = $2, classification = $3, responded_at = NOW()
         WHERE public_token = $4`,
        [score, comment ?? null, classification, req.params.token]
      );
      return { ok: true };
    }
  );
}
