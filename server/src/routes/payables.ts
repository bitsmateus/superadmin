import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Contas a Pagar (Financeiro) — board estilo Monday: lista contínua de grupos criados à mão
 * (ex.: "Abril 2026", "Folha de pagamento"), cada um com seus itens. Sem conceito de mês
 * selecionado — diferente da Gestão Interna, aqui é tudo visível de uma vez, na ordem que a
 * pessoa organizar. `boleto_data` (PDF em base64) é pesado — omitido do GET de lista, igual o
 * padrão já usado em contracts.ts/clients.ts, com uma rota própria pra buscar um item completo.
 */
export async function payablesRoutes(app: FastifyInstance) {
  // ---------- Grupos ----------

  app.get('/api/payables-groups', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM payables_groups ORDER BY position, created_at');
  });

  app.post<{ Body: { name?: string; color?: string } }>(
    '/api/payables-groups',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { name, color } = req.body;
      if (!name?.trim()) return reply.status(400).send({ message: 'name é obrigatório' });
      const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM payables_groups');
      const [group] = await query(
        `INSERT INTO payables_groups (name, color, position) VALUES ($1,$2,$3) RETURNING *`,
        [name.trim(), color ?? '#4F8EF7', (max ?? -1) + 1]
      );
      return reply.status(201).send(group);
    }
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; color?: string; position?: number } }>(
    '/api/payables-groups/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.name !== undefined) { sets.push(`name = $${i++}`); params.push(req.body.name.trim()); }
      if (req.body.color !== undefined) { sets.push(`color = $${i++}`); params.push(req.body.color); }
      if (req.body.position !== undefined) { sets.push(`position = $${i++}`); params.push(req.body.position); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);
      params.push(req.params.id);
      const [group] = await query(`UPDATE payables_groups SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!group) return reply.status(404).send({ message: 'Grupo não encontrado' });
      return group;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/payables-groups/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const existing = await queryOne('SELECT id FROM payables_groups WHERE id = $1', [req.params.id]);
      if (!existing) return reply.status(404).send({ message: 'Grupo não encontrado' });
      await query('DELETE FROM payables_groups WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // ---------- Itens ----------

  app.get('/api/payables-entries', { onRequest: [app.authenticate] }, async () => {
    const rows = await query('SELECT * FROM payables_entries ORDER BY position, created_at');
    for (const r of rows as Record<string, unknown>[]) delete r.boleto_data;
    return rows;
  });

  app.get<{ Params: { id: string } }>(
    '/api/payables-entries/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const row = await queryOne('SELECT * FROM payables_entries WHERE id = $1', [req.params.id]);
      if (!row) return reply.status(404).send({ message: 'Item não encontrado' });
      return row;
    }
  );

  app.post<{ Body: {
    groupId?: string; elemento?: string; previstoCents?: number; comissaoCents?: number | null
    realCents?: number | null; status?: string; data?: string | null
    boletoData?: string | null; boletoFilename?: string | null; notas?: string
  } }>(
    '/api/payables-entries',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const {
        groupId, elemento, previstoCents, comissaoCents, realCents, status, data, boletoData, boletoFilename, notas,
      } = req.body;
      if (!groupId || !elemento?.trim()) {
        return reply.status(400).send({ message: 'groupId e elemento são obrigatórios' });
      }
      const [{ max }] = await query<{ max: number | null }>(
        'SELECT MAX(position) as max FROM payables_entries WHERE group_id = $1',
        [groupId]
      );
      const [entry] = await query(
        `INSERT INTO payables_entries
          (group_id, elemento, previsto_cents, comissao_cents, real_cents, status, data, boleto_data, boleto_filename, notas, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          groupId, elemento.trim(), previstoCents ?? 0, comissaoCents ?? null, realCents ?? null,
          status ?? 'a_pagar', data ?? null, boletoData ?? null, boletoFilename ?? null, notas?.trim() ?? '',
          (max ?? -1) + 1,
        ]
      );
      return reply.status(201).send(entry);
    }
  );

  app.patch<{ Params: { id: string }; Body: {
    groupId?: string; elemento?: string; previstoCents?: number; comissaoCents?: number | null
    realCents?: number | null; status?: string; data?: string | null
    boletoData?: string | null; boletoFilename?: string | null; notas?: string; position?: number
  } }>(
    '/api/payables-entries/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      const b = req.body;
      if (b.groupId !== undefined) { sets.push(`group_id = $${i++}`); params.push(b.groupId); }
      if (b.elemento !== undefined) { sets.push(`elemento = $${i++}`); params.push(b.elemento.trim()); }
      if (b.previstoCents !== undefined) { sets.push(`previsto_cents = $${i++}`); params.push(b.previstoCents); }
      if (b.comissaoCents !== undefined) { sets.push(`comissao_cents = $${i++}`); params.push(b.comissaoCents); }
      if (b.realCents !== undefined) { sets.push(`real_cents = $${i++}`); params.push(b.realCents); }
      if (b.status !== undefined) { sets.push(`status = $${i++}`); params.push(b.status); }
      if (b.data !== undefined) { sets.push(`data = $${i++}`); params.push(b.data); }
      if (b.boletoData !== undefined) { sets.push(`boleto_data = $${i++}`); params.push(b.boletoData); }
      if (b.boletoFilename !== undefined) { sets.push(`boleto_filename = $${i++}`); params.push(b.boletoFilename); }
      if (b.notas !== undefined) { sets.push(`notas = $${i++}`); params.push(b.notas.trim()); }
      if (b.position !== undefined) { sets.push(`position = $${i++}`); params.push(b.position); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);
      params.push(req.params.id);
      const [entry] = await query(`UPDATE payables_entries SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!entry) return reply.status(404).send({ message: 'Item não encontrado' });
      return entry;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/payables-entries/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const existing = await queryOne('SELECT id FROM payables_entries WHERE id = $1', [req.params.id]);
      if (!existing) return reply.status(404).send({ message: 'Item não encontrado' });
      await query('DELETE FROM payables_entries WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
