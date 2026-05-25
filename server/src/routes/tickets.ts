import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

export async function ticketRoutes(app: FastifyInstance) {
  // GET /api/tickets
  app.get('/api/tickets', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM tickets ORDER BY opened_at DESC');
  });

  // PATCH /api/tickets/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/tickets/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val !== null && typeof val === 'object' ? JSON.stringify(val) : val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [updated] = await query(
        `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!updated) return reply.status(404).send({ message: 'Ticket não encontrado' });
      return updated;
    }
  );

  // GET /api/tickets/:id/messages
  app.get<{ Params: { id: string }; Querystring: { public_only?: string } }>(
    '/api/tickets/:id/messages',
    { onRequest: [app.authenticate] },
    async (req) => {
      const publicOnly = req.query.public_only === 'true';
      const sql = publicOnly
        ? 'SELECT * FROM ticket_messages WHERE ticket_id = $1 AND is_internal = false ORDER BY created_at'
        : 'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at';
      return query(sql, [req.params.id]);
    }
  );

  // POST /api/tickets/:id/messages
  app.post<{
    Params: { id: string };
    Body: {
      author_type: string;
      author_id?: string;
      author_name?: string;
      content: string;
      is_internal?: boolean;
      attachments?: unknown[];
    };
  }>(
    '/api/tickets/:id/messages',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { id } = req.params;
      const { author_type, author_id, author_name, content, is_internal, attachments } = req.body;
      const [msg] = await query(
        `INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, content, is_internal, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [id, author_type, author_id ?? null, author_name ?? null, content, is_internal ?? false, JSON.stringify(attachments ?? [])]
      );
      return reply.status(201).send(msg);
    }
  );

  // GET /api/ticket-categories
  app.get('/api/ticket-categories', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM ticket_categories ORDER BY position');
  });

  // POST /api/ticket-categories
  app.post<{ Body: Record<string, unknown> }>(
    '/api/ticket-categories',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (!['admin', 'supervisor'].includes(role)) return reply.status(403).send({ message: 'Acesso negado' });
      const b = req.body;
      const [cat] = await query(
        `INSERT INTO ticket_categories (name, description, icon, color, position, active, default_sla_hours, default_priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.name, b.description ?? null, b.icon ?? 'HelpCircle', b.color ?? 'info',
         b.position ?? 0, b.active ?? true, b.default_sla_hours ?? 24, b.default_priority ?? 'normal']
      );
      return reply.status(201).send(cat);
    }
  );

  // PATCH /api/ticket-categories/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/ticket-categories/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (!['admin', 'supervisor'].includes(role)) return reply.status(403).send({ message: 'Acesso negado' });
      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      params.push(req.params.id);
      const [cat] = await query(
        `UPDATE ticket_categories SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!cat) return reply.status(404).send({ message: 'Categoria não encontrada' });
      return cat;
    }
  );

  // GET /api/triage-steps
  app.get<{ Querystring: { category_id?: string } }>(
    '/api/triage-steps',
    { onRequest: [app.authenticate] },
    async (req) => {
      if (req.query.category_id) {
        return query('SELECT * FROM ticket_triage_steps WHERE category_id = $1', [req.query.category_id]);
      }
      return query('SELECT * FROM ticket_triage_steps');
    }
  );

  // POST /api/triage-steps
  app.post<{ Body: Record<string, unknown> }>(
    '/api/triage-steps',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      const [step] = await query(
        `INSERT INTO ticket_triage_steps (category_id, parent_id, question, options, position)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.category_id, b.parent_id ?? null, b.question, JSON.stringify(b.options ?? []), b.position ?? 0]
      );
      return reply.status(201).send(step);
    }
  );

  // PATCH /api/triage-steps/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/triage-steps/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      const [step] = await query(
        `UPDATE ticket_triage_steps SET question = $1, options = $2, parent_id = $3
         WHERE id = $4 RETURNING *`,
        [b.question, JSON.stringify(b.options ?? []), b.parent_id ?? null, req.params.id]
      );
      if (!step) return reply.status(404).send({ message: 'Passo não encontrado' });
      return step;
    }
  );

  // DELETE /api/triage-steps/:id
  app.delete<{ Params: { id: string } }>(
    '/api/triage-steps/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM ticket_triage_steps WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/kb-articles
  app.get('/api/kb-articles', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM kb_articles');
  });

  // POST /api/kb-articles
  app.post<{ Body: Record<string, unknown> }>(
    '/api/kb-articles',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (!['admin', 'supervisor'].includes(role)) return reply.status(403).send({ message: 'Acesso negado' });
      const b = req.body;
      const [art] = await query(
        `INSERT INTO kb_articles (slug, title, summary, body_markdown, video_url, category_id, tags, published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [b.slug, b.title, b.summary ?? null, b.body_markdown ?? null, b.video_url ?? null,
         b.category_id ?? null, JSON.stringify(b.tags ?? []), b.published ?? true]
      );
      return reply.status(201).send(art);
    }
  );

  // PATCH /api/kb-articles/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/kb-articles/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const patch = req.body;
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val !== null && typeof val === 'object' ? JSON.stringify(val) : val);
      }
      params.push(req.params.id);
      const [art] = await query(
        `UPDATE kb_articles SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!art) return reply.status(404).send({ message: 'Artigo não encontrado' });
      return art;
    }
  );

  // GET /api/message-templates
  app.get('/api/message-templates', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM message_templates');
  });

  // POST /api/message-templates
  app.post<{ Body: Record<string, unknown> }>(
    '/api/message-templates',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const b = req.body;
      const [tmpl] = await query(
        `INSERT INTO message_templates (name, content, scope, category, shortcut, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [b.name, b.content, b.scope ?? 'all', b.category ?? null, b.shortcut ?? null, sub]
      );
      return reply.status(201).send(tmpl);
    }
  );

  // PATCH /api/message-templates/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/message-templates/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const patch = req.body;
      const sets: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      params.push(req.params.id);
      const [tmpl] = await query(
        `UPDATE message_templates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!tmpl) return reply.status(404).send({ message: 'Template não encontrado' });
      return tmpl;
    }
  );

  // DELETE /api/message-templates/:id
  app.delete<{ Params: { id: string } }>(
    '/api/message-templates/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM message_templates WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/reminders
  app.get('/api/reminders', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    if (role === 'admin') return query('SELECT * FROM reminders ORDER BY due_at');
    return query('SELECT * FROM reminders WHERE user_id = $1 ORDER BY due_at', [sub]);
  });

  // POST /api/reminders
  app.post<{ Body: Record<string, unknown> }>(
    '/api/reminders',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const b = req.body;
      const [rem] = await query(
        `INSERT INTO reminders (user_id, client_id, title, notes, due_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [sub, b.client_id ?? null, b.title, b.notes ?? null, b.due_at]
      );
      return reply.status(201).send(rem);
    }
  );

  // PATCH /api/reminders/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/reminders/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      params.push(req.params.id);
      const [rem] = await query(
        `UPDATE reminders SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!rem) return reply.status(404).send({ message: 'Lembrete não encontrado' });
      return rem;
    }
  );

  // DELETE /api/reminders/:id
  app.delete<{ Params: { id: string } }>(
    '/api/reminders/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM reminders WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/nps
  app.get('/api/nps', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM nps_responses ORDER BY created_at DESC');
  });

  // PATCH /api/nps/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/nps/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      params.push(req.params.id);
      const [nps] = await query(
        `UPDATE nps_responses SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!nps) return reply.status(404).send({ message: 'NPS não encontrado' });
      return nps;
    }
  );

  // DELETE /api/nps/:id
  app.delete<{ Params: { id: string } }>(
    '/api/nps/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM nps_responses WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
