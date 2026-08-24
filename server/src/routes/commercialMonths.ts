import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/**
 * Painel do Mês (Dashboard Comercial) — um registro por mês (id = 'YYYY-MM') guardando só os
 * campos manuais (investimento em tráfego, leads gerados, permanência média). O resto do painel
 * (funil, MRR, ROI) é calculado no front, ao vivo, em cima de lead_rows/lead_boards já existentes.
 */

const MONTH_ID_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function commercialMonthRoutes(app: FastifyInstance) {
  // GET /api/commercial-months — todos os meses já criados, mais recente primeiro.
  app.get('/api/commercial-months', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM commercial_months ORDER BY id DESC');
  });

  // POST /api/commercial-months { id } — cria um mês novo (zerado). Idempotente: se já existir,
  // devolve o que já está lá em vez de dar erro.
  app.post<{ Body: { id?: string } }>(
    '/api/commercial-months',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const id = (req.body.id ?? '').trim();
      if (!MONTH_ID_RE.test(id)) return reply.status(400).send({ message: 'id inválido — use YYYY-MM' });

      await query('INSERT INTO commercial_months (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
      const [month] = await query('SELECT * FROM commercial_months WHERE id = $1', [id]);
      return reply.status(201).send(month);
    }
  );

  // PATCH /api/commercial-months/:id — atualiza os campos manuais.
  app.patch<{
    Params: { id: string };
    Body: { investimentoTrafego?: string; leadsGerados?: number; permanenciaMedia?: number };
  }>('/api/commercial-months/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (req.body.investimentoTrafego !== undefined) { sets.push(`investimento_trafego = $${i++}`); params.push(req.body.investimentoTrafego); }
    if (req.body.leadsGerados !== undefined) { sets.push(`leads_gerados = $${i++}`); params.push(req.body.leadsGerados); }
    if (req.body.permanenciaMedia !== undefined) { sets.push(`permanencia_media = $${i++}`); params.push(req.body.permanenciaMedia); }
    if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

    params.push(req.params.id);
    const [month] = await query(`UPDATE commercial_months SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
    if (!month) return reply.status(404).send({ message: 'Mês não encontrado' });
    return month;
  });
}
