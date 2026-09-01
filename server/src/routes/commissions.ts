import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Comissões (aba "Gestão Interna", em Financeiro) — feature isolada: só lê contagens de
 * vendas/entregas já existentes (lead_rows/clients), nunca escreve nelas. O que fica salvo aqui é
 * só (1) os valores de comissão configurados e (2) o status pago/pendente por pessoa+papel+mês.
 */
export async function commissionRoutes(app: FastifyInstance) {
  // GET /api/commission-rates — linha única.
  app.get('/api/commission-rates', { onRequest: [app.authenticate] }, async () => {
    const row = await queryOne('SELECT * FROM commission_rates WHERE id = true');
    return row ?? { sdr_per_sale_cents: 10000, suporte_per_delivery_cents: 0, suporte_per_venda_avulsa_cents: 0 };
  });

  // PUT /api/commission-rates — admin only (mexe em valor de comissão).
  app.put<{ Body: {
    sdrPerSaleCents?: number; suportePerDeliveryCents?: number; suportePerVendaAvulsaCents?: number
  } }>(
    '/api/commission-rates',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.sdrPerSaleCents !== undefined) { sets.push(`sdr_per_sale_cents = $${i++}`); params.push(req.body.sdrPerSaleCents); }
      if (req.body.suportePerDeliveryCents !== undefined) { sets.push(`suporte_per_delivery_cents = $${i++}`); params.push(req.body.suportePerDeliveryCents); }
      if (req.body.suportePerVendaAvulsaCents !== undefined) { sets.push(`suporte_per_venda_avulsa_cents = $${i++}`); params.push(req.body.suportePerVendaAvulsaCents); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);

      const [row] = await query(`UPDATE commission_rates SET ${sets.join(', ')} WHERE id = true RETURNING *`, params);
      return row;
    }
  );

  // GET /api/commission-payments — lista toda (tabela pequena, um registro por pessoa+papel+mês).
  app.get('/api/commission-payments', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM commission_payments ORDER BY month DESC, role, person');
  });

  // PUT /api/commission-payments — upsert do status (pendente/pago) de uma pessoa num mês.
  app.put<{ Body: { person?: string; role?: 'sdr' | 'suporte'; month?: string; status?: 'pendente' | 'pago' } }>(
    '/api/commission-payments',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { person, role, month, status } = req.body;
      if (!person?.trim() || !role || !month || !status) {
        return reply.status(400).send({ message: 'person, role, month e status são obrigatórios' });
      }
      const [row] = await query(
        `INSERT INTO commission_payments (person, role, month, status) VALUES ($1,$2,$3,$4)
         ON CONFLICT (person, role, month) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
         RETURNING *`,
        [person.trim(), role, month, status]
      );
      return row;
    }
  );
}
