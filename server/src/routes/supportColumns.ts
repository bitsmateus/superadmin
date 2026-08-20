import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/** Campos que o PATCH aceita — `key` fica de fora de propósito: ela é o valor
 *  gravado em reminders.status, então mudá-la órfãnaria as tarefas existentes. */
const PATCHABLE = new Set(['name', 'color', 'position', 'is_done']);

/** Gera uma key estável a partir do nome (sem acento, minúscula, com _). */
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base || 'coluna';
}

export async function supportColumnRoutes(app: FastifyInstance) {
  // GET /api/support-columns
  app.get('/api/support-columns', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM support_columns ORDER BY position, created_at');
  });

  // POST /api/support-columns
  app.post<{ Body: Record<string, unknown> }>(
    '/api/support-columns',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const name = String(req.body.name ?? '').trim();
      if (!name) return reply.status(400).send({ message: 'name é obrigatório' });

      // Key única: slug do nome, com sufixo numérico se já existir.
      const base = slugify(name);
      const taken = await query<{ key: string }>(
        'SELECT key FROM support_columns WHERE key = $1 OR key LIKE $2',
        [base, `${base}\\_%`]
      );
      let key = base;
      for (let i = 2; taken.some((r) => r.key === key); i++) key = `${base}_${i}`;

      const [maxRow] = await query<{ max: number | null }>(
        'SELECT MAX(position) as max FROM support_columns'
      );
      const position = (req.body.position as number | undefined) ?? (maxRow?.max ?? 0) + 1;

      const [col] = await query(
        `INSERT INTO support_columns (key, name, color, position, is_done)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [key, name, req.body.color ?? '#9CA3AF', position, Boolean(req.body.is_done)]
      );
      return reply.status(201).send(col);
    }
  );

  // PATCH /api/support-columns/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/support-columns/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(req.body)) {
        if (!PATCHABLE.has(key)) continue;
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [col] = await query(
        `UPDATE support_columns SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!col) return reply.status(404).send({ message: 'Coluna não encontrada' });
      return col;
    }
  );

  // DELETE /api/support-columns/:id
  // As tarefas que estavam nela não podem sumir: vão para a primeira coluna
  // restante (a mais à esquerda). A última coluna não pode ser apagada.
  app.delete<{ Params: { id: string } }>(
    '/api/support-columns/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const [col] = await query<{ id: string; key: string }>(
        'SELECT id, key FROM support_columns WHERE id = $1',
        [req.params.id]
      );
      if (!col) return reply.status(404).send({ message: 'Coluna não encontrada' });

      const [fallback] = await query<{ key: string; is_done: boolean }>(
        'SELECT key, is_done FROM support_columns WHERE id <> $1 ORDER BY position, created_at LIMIT 1',
        [req.params.id]
      );
      if (!fallback) {
        return reply.status(400).send({ message: 'O quadro precisa de pelo menos uma coluna' });
      }

      // Reabre as tarefas se o destino não for uma coluna de conclusão.
      await query(
        fallback.is_done
          ? 'UPDATE reminders SET status = $1 WHERE status = $2'
          : 'UPDATE reminders SET status = $1, completed_at = NULL WHERE status = $2',
        [fallback.key, col.key]
      );
      await query('DELETE FROM support_columns WHERE id = $1', [req.params.id]);
      return reply.send({ movedTo: fallback.key });
    }
  );
}
