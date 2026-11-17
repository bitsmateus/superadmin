import { FastifyInstance } from 'fastify';
import { query, ehNomeDeColuna } from '../db.js';

/** Campo da etiqueta -> coluna de lead_rows que guarda o nome dela (lista fixa: nada vem do cliente direto pro SQL). */
const COLUNA_DO_CAMPO: Record<string, string> = {
  tipo: 'tipo', dia_contato: 'dia_contato', status: 'status', sdr: 'sdr', ligacao: 'ligacao',
  etiqueta: 'etiqueta', followup: 'followup', disparo: 'disparo',
};

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
      const nome = String(b.name).trim();
      const [label] = await query(
        `INSERT INTO lead_labels (field, name, color, position, page_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [b.field, nome, b.color ?? '#9CA3AF', position, pageId]
      );
      if (label) return reply.status(201).send(label);
      // Já existia uma igual (clique duplo, duas telas ao mesmo tempo): devolve a que está lá, sem criar outra.
      const [existente] = await query(
        'SELECT * FROM lead_labels WHERE field = $1 AND page_id IS NOT DISTINCT FROM $2 AND name = $3',
        [b.field, pageId, nome]
      );
      return reply.status(200).send(existente);
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
        if (!ehNomeDeColuna(key)) continue;
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      const [antes] = await query<{ field: string; name: string; page_id: string | null }>(
        'SELECT field, name, page_id FROM lead_labels WHERE id = $1', [req.params.id]
      );
      if (!antes) return reply.status(404).send({ message: 'Etiqueta não encontrada' });
      if (typeof patch.name === 'string') {
        patch.name = patch.name.trim();
        if (!patch.name) return reply.status(400).send({ message: 'O nome da etiqueta não pode ficar vazio' });
      }
      params.push(req.params.id);
      let label: { name: string } | undefined;
      try {
        [label] = await query<{ name: string }>(`UPDATE lead_labels SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      } catch (err) {
        if ((err as { code?: string }).code === '23505') return reply.status(409).send({ message: 'Já existe uma etiqueta com esse nome nessa aba.' });
        throw err;
      }
      if (!label) return reply.status(404).send({ message: 'Etiqueta não encontrada' });
      // Renomeou: as leads que usavam o nome antigo passam pro novo (senão ficariam com um nome sem etiqueta, sem cor).
      const coluna = COLUNA_DO_CAMPO[antes.field];
      if (coluna && typeof patch.name === 'string' && patch.name !== antes.name) {
        if (antes.field === 'sdr' || !antes.page_id) {
          await query(`UPDATE lead_rows SET ${coluna} = $1 WHERE ${coluna} = $2`, [patch.name, antes.name]);
        } else {
          await query(
            `UPDATE lead_rows SET ${coluna} = $1 WHERE ${coluna} = $2 AND board_id IN (SELECT id FROM lead_boards WHERE page = $3)`,
            [patch.name, antes.name, antes.page_id]
          );
        }
      }
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
