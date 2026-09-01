import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Comissões (aba "Gestão Interna", em Financeiro) — feature isolada: só lê contagens de
 * vendas/entregas quando isso for automatizado (ainda não é — hoje é registro manual). O que fica
 * salvo aqui é (1) o cardápio de tipos de comissão configurados e (2) cada lançamento individual
 * (venda/entrega/indicação), com status pago/pendente.
 */
export async function commissionRoutes(app: FastifyInstance) {
  // ---------- Tipos ----------

  app.get('/api/commission-types', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM commission_types ORDER BY role, position, label');
  });

  app.post<{ Body: {
    role?: 'sdr' | 'suporte'; label?: string; kind?: 'fixed' | 'percent'
    rateCents?: number | null; ratePercent?: number | null
  } }>(
    '/api/commission-types',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role, label, kind, rateCents, ratePercent } = req.body;
      if (!role || !label?.trim() || !kind) {
        return reply.status(400).send({ message: 'role, label e kind são obrigatórios' });
      }
      const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM commission_types WHERE role = $1', [role]);
      const [type] = await query(
        `INSERT INTO commission_types (role, label, kind, rate_cents, rate_percent, position)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [role, label.trim(), kind, rateCents ?? null, ratePercent ?? null, (max ?? -1) + 1]
      );
      return reply.status(201).send(type);
    }
  );

  app.patch<{ Params: { id: string }; Body: {
    label?: string; kind?: 'fixed' | 'percent'; rateCents?: number | null; ratePercent?: number | null; archived?: boolean
  } }>(
    '/api/commission-types/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.label !== undefined) { sets.push(`label = $${i++}`); params.push(req.body.label.trim()); }
      if (req.body.kind !== undefined) { sets.push(`kind = $${i++}`); params.push(req.body.kind); }
      if (req.body.rateCents !== undefined) { sets.push(`rate_cents = $${i++}`); params.push(req.body.rateCents); }
      if (req.body.ratePercent !== undefined) { sets.push(`rate_percent = $${i++}`); params.push(req.body.ratePercent); }
      if (req.body.archived !== undefined) { sets.push(`archived = $${i++}`); params.push(req.body.archived); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);

      params.push(req.params.id);
      const [type] = await query(`UPDATE commission_types SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!type) return reply.status(404).send({ message: 'Tipo não encontrado' });
      return type;
    }
  );

  // ---------- Lançamentos ----------

  app.get('/api/commission-entries', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM commission_entries ORDER BY month DESC, created_at DESC');
  });

  app.post<{ Body: {
    nome?: string; person?: string; role?: 'sdr' | 'suporte'; typeId?: string | null; typeLabel?: string
    reference?: string; baseValueCents?: number | null; amountCents?: number; month?: string
  } }>(
    '/api/commission-entries',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { nome, person, role, typeId, typeLabel, reference, baseValueCents, amountCents, month } = req.body;
      if (!person?.trim() || !role || !typeLabel?.trim() || amountCents === undefined || !month) {
        return reply.status(400).send({ message: 'person, role, typeLabel, amountCents e month são obrigatórios' });
      }
      const [entry] = await query(
        `INSERT INTO commission_entries (nome, person, role, type_id, type_label, reference, base_value_cents, amount_cents, month)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [nome?.trim() ?? '', person.trim(), role, typeId ?? null, typeLabel.trim(), reference?.trim() ?? '', baseValueCents ?? null, amountCents, month]
      );
      return reply.status(201).send(entry);
    }
  );

  app.patch<{ Params: { id: string }; Body: {
    status?: 'pendente' | 'pago'; amountCents?: number; reference?: string; nome?: string
    typeId?: string | null; typeLabel?: string; baseValueCents?: number | null
  } }>(
    '/api/commission-entries/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.status !== undefined) { sets.push(`status = $${i++}`); params.push(req.body.status); }
      if (req.body.amountCents !== undefined) { sets.push(`amount_cents = $${i++}`); params.push(req.body.amountCents); }
      if (req.body.reference !== undefined) { sets.push(`reference = $${i++}`); params.push(req.body.reference.trim()); }
      if (req.body.nome !== undefined) { sets.push(`nome = $${i++}`); params.push(req.body.nome.trim()); }
      if (req.body.typeId !== undefined) { sets.push(`type_id = $${i++}`); params.push(req.body.typeId); }
      if (req.body.typeLabel !== undefined) { sets.push(`type_label = $${i++}`); params.push(req.body.typeLabel); }
      if (req.body.baseValueCents !== undefined) { sets.push(`base_value_cents = $${i++}`); params.push(req.body.baseValueCents); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);

      params.push(req.params.id);
      const [entry] = await query(`UPDATE commission_entries SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!entry) return reply.status(404).send({ message: 'Lançamento não encontrado' });
      return entry;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/commission-entries/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const existing = await queryOne('SELECT id FROM commission_entries WHERE id = $1', [req.params.id]);
      if (!existing) return reply.status(404).send({ message: 'Lançamento não encontrado' });
      await query('DELETE FROM commission_entries WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
