import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /api/stage-history
  app.get('/api/stage-history', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM stage_history ORDER BY at DESC LIMIT 5000');
  });

  // GET /api/audit-log — admin only
  app.get('/api/audit-log', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
    return query('SELECT * FROM audit_log ORDER BY at DESC LIMIT 500');
  });

  // POST /api/audit-log — any authenticated user
  app.post<{
    Body: {
      entity_type: string;
      entity_id: string;
      action: string;
      summary: string;
      changes?: Record<string, unknown>;
    };
  }>(
    '/api/audit-log',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const { entity_type, entity_id, action, summary, changes } = req.body;

      // Get actor details
      const [actor] = await query<{ email: string; name: string }>(
        'SELECT email, name FROM profiles WHERE id = $1',
        [sub]
      );

      await query(
        `INSERT INTO audit_log (actor_id, actor_email, actor_name, entity_type, entity_id, action, summary, changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sub, actor?.email ?? null, actor?.name ?? null,
          entity_type, entity_id, action, summary,
          changes ? JSON.stringify(changes) : null,
        ]
      );
      return reply.status(201).send({ ok: true });
    }
  );
}
