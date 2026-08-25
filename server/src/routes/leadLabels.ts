import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

export async function leadLabelRoutes(app: FastifyInstance) {
  // GET /api/lead-labels?field=status
  app.get<{ Querystring: { field?: string } }>(
    '/api/lead-labels',
    { onRequest: [app.authenticate] },
    async (req) => {
      if (req.query.field) {
        return query(
          'SELECT * FROM lead_labels WHERE field = $1 ORDER BY position, created_at',
          [req.query.field]
        );
      }
      return query('SELECT * FROM lead_labels ORDER BY position, created_at');
    }
  );

  // POST /api/lead-labels
  // "sdr" continua global (page_id sempre null — é a lista de SDRs de verdade, usada pra travar/
  // rotear leads entre abas). As demais etiquetas são por aba: page_id é obrigatório pra elas.
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-labels',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      if (!b.field || !b.name) return reply.status(400).send({ message: 'field e name são obrigatórios' });
      const pageId = b.field === 'sdr' ? null : ((b.page_id as string | undefined) ?? null);
      if (b.field !== 'sdr' && !pageId) return reply.status(400).send({ message: 'page_id é obrigatório' });
      let position = b.position as number | undefined;
      if (position === undefined) {
        const [row] = await query<{ max: number | null }>(
          'SELECT MAX(position) as max FROM lead_labels WHERE field = $1 AND page_id IS NOT DISTINCT FROM $2',
          [b.field, pageId]
        );
        position = (row?.max ?? -1) + 1;
      }
      const [label] = await query(
        `INSERT INTO lead_labels (field, name, color, position, page_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [b.field, b.name, b.color ?? '#9CA3AF', position, pageId]
      );
      return reply.status(201).send(label);
    }
  );

  // PATCH /api/lead-labels/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/lead-labels/:id',
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
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [label] = await query(
        `UPDATE lead_labels SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!label) return reply.status(404).send({ message: 'Etiqueta não encontrada' });
      return label;
    }
  );

  // DELETE /api/lead-labels/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-labels/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      await query('DELETE FROM lead_labels WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
