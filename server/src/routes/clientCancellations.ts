import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Cancelamentos de cliente (tela "Clientes Geral", do Financeiro).
 *
 * Cancelar não apaga nem arquiva o cliente: cria um REGISTRO do cancelamento (data, motivo,
 * observação e quanto de mensalidade saiu junto) e joga o cliente pra etapa 'churned'. É isso que
 * permite responder "quanto eu perdi em setembro?" mês a mês — com o cliente arquivado essa conta
 * some, e com o `stage` sozinho só dá pra saber o estado de hoje, não o histórico.
 *
 * `mrr_cents` é uma FOTO do valor no momento do cancelamento: se a mensalidade do cliente for
 * corrigida depois (ou ele voltar por outro valor), o que ele custou naquele mês não muda.
 *
 * Reativar não apaga o registro — marca `reactivated_at`. O cancelamento aconteceu e continua
 * contando no mês em que aconteceu; quem errou de cliente exclui o registro (DELETE).
 */
export async function clientCancellationRoutes(app: FastifyInstance) {
  // GET /api/client-cancellations — todos, do mais recente pro mais antigo. São poucos por mês e o
  // front já filtra por período igual ao resto do Financeiro, então não vale paginar aqui.
  app.get('/api/client-cancellations', { onRequest: [app.authenticate] }, async () => {
    return query(
      `SELECT cc.*, c.name AS client_name, c.company AS client_company, c.phone AS client_phone,
              c.stage AS client_stage
       FROM client_cancellations cc
       JOIN clients c ON c.id = cc.client_id
       ORDER BY cc.canceled_at DESC, cc.created_at DESC`
    );
  });

  // POST /api/client-cancellations — cancela um cliente.
  app.post<{
    Body: {
      clientId?: string; canceledAt?: string; motivo?: string; observacao?: string; mrrCents?: number;
      multaCents?: number; asaasRemovido?: boolean;
    };
  }>('/api/client-cancellations', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub } = req.user as { sub: string };
    const { clientId, canceledAt, motivo, observacao, mrrCents, multaCents, asaasRemovido } = req.body ?? {};
    if (!clientId) return reply.status(400).send({ message: 'clientId é obrigatório' });

    const cliente = await queryOne<{ id: string; monthly_value: string | null }>(
      'SELECT id, monthly_value FROM clients WHERE id = $1',
      [clientId]
    );
    if (!cliente) return reply.status(404).send({ message: 'Cliente não encontrado' });

    // Sem valor informado, congela a mensalidade que o cliente tem hoje.
    const valor =
      mrrCents !== undefined && mrrCents !== null
        ? Math.round(mrrCents)
        : Math.round(Number(cliente.monthly_value ?? 0) * 100);

    const [row] = await query(
      `INSERT INTO client_cancellations
         (client_id, canceled_at, motivo, observacao, mrr_cents, multa_cents, asaas_removido, created_by)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        clientId, canceledAt ?? null, motivo ?? '', observacao ?? '', valor,
        Math.round(multaCents ?? 0), asaasRemovido ?? false, sub,
      ]
    );

    await query(`UPDATE clients SET stage = 'churned', stage_updated_at = NOW(), updated_at = NOW() WHERE id = $1`, [
      clientId,
    ]);

    return reply.status(201).send(row);
  });

  // PATCH /api/client-cancellations/:id — corrigir data/motivo/observação/valor depois.
  app.patch<{
    Params: { id: string };
    Body: {
      canceledAt?: string; motivo?: string; observacao?: string; mrrCents?: number;
      multaCents?: number; asaasRemovido?: boolean;
    };
  }>('/api/client-cancellations/:id', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { canceledAt, motivo, observacao, mrrCents, multaCents, asaasRemovido } = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (canceledAt !== undefined) { sets.push(`canceled_at = $${i++}::date`); params.push(canceledAt); }
    if (motivo !== undefined) { sets.push(`motivo = $${i++}`); params.push(motivo); }
    if (observacao !== undefined) { sets.push(`observacao = $${i++}`); params.push(observacao); }
    if (mrrCents !== undefined) { sets.push(`mrr_cents = $${i++}`); params.push(Math.round(mrrCents)); }
    if (multaCents !== undefined) { sets.push(`multa_cents = $${i++}`); params.push(Math.round(multaCents)); }
    if (asaasRemovido !== undefined) { sets.push(`asaas_removido = $${i++}`); params.push(asaasRemovido); }
    if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

    params.push(req.params.id);
    const [row] = await query(
      `UPDATE client_cancellations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    if (!row) return reply.status(404).send({ message: 'Cancelamento não encontrado' });
    return row;
  });

  // POST /api/client-cancellations/:id/reativar — cliente voltou. Marca o registro como reativado
  // (continua contando no mês em que o cancelamento aconteceu) e devolve o cliente pra 'active'.
  app.post<{ Params: { id: string } }>(
    '/api/client-cancellations/:id/reativar',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const [row] = await query<{ client_id: string }>(
        `UPDATE client_cancellations SET reactivated_at = NOW() WHERE id = $1 AND reactivated_at IS NULL
         RETURNING *`,
        [req.params.id]
      );
      if (!row) return reply.status(404).send({ message: 'Cancelamento não encontrado ou já reativado' });
      await query(
        `UPDATE clients SET stage = 'active', stage_updated_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.client_id]
      );
      return row;
    }
  );

  // DELETE /api/client-cancellations/:id — registro criado por engano. Se era o cancelamento em
  // vigor do cliente, ele volta pra 'active': senão ficaria churned sem nada explicando por quê.
  app.delete<{ Params: { id: string } }>(
    '/api/client-cancellations/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const [row] = await query<{ client_id: string; reactivated_at: string | null }>(
        'DELETE FROM client_cancellations WHERE id = $1 RETURNING *',
        [req.params.id]
      );
      if (!row) return reply.status(404).send({ message: 'Cancelamento não encontrado' });
      if (!row.reactivated_at) {
        await query(
          `UPDATE clients SET stage = 'active', stage_updated_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND stage = 'churned'`,
          [row.client_id]
        );
      }
      return reply.status(204).send();
    }
  );
}
