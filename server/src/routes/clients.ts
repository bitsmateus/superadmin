import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';

const FINANCE_COLS = [
  'contract_url','contract_sent_at','contract_signed_at',
  'asaas_customer_id','asaas_payment_id','asaas_subscription_id',
  'implementation_value','monthly_value','due_day',
  'payment_status','last_payment_check','payments','extra_links','finance_notes',
];

export async function clientRoutes(app: FastifyInstance) {
  // GET /api/clients
  app.get('/api/clients', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM clients ORDER BY created_at DESC');
  });

  // GET /api/clients/:id
  app.get<{ Params: { id: string } }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const row = await queryOne('SELECT * FROM clients WHERE id = $1', [req.params.id]);
      if (!row) return reply.status(404).send({ message: 'Cliente não encontrado' });
      return row;
    }
  );

  // POST /api/clients
  app.post<{ Body: Record<string, unknown> }>(
    '/api/clients',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      const id = (b.id as string) || uuidv4();
      const [row] = await query(
        `INSERT INTO clients (
          id, name, email, phone, company, responsavel, stage,
          tenant_id, tenant_server_id, tenant_api_id, tenant_name,
          support_email, support_password,
          contract_url, contract_sent_at, contract_signed_at,
          asaas_customer_id, asaas_payment_id, asaas_subscription_id,
          implementation_value, monthly_value, due_day, payment_status,
          last_payment_check, payments, extra_links, finance_notes,
          briefing_token, briefing_status, briefing_sent_at, briefing_data,
          briefing_approved_at, briefing_revision_note,
          delivery_checklist, delivery_handoff_checklist, delivery_date,
          delivery_notes, delivery_completed_at,
          followup_active, followups, notes, logs
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,
          $14,$15,$16,
          $17,$18,$19,
          $20,$21,$22,$23,
          $24,$25,$26,$27,
          $28,$29,$30,$31,
          $32,$33,
          $34,$35,$36,
          $37,$38,
          $39,$40,$41,$42
        ) RETURNING *`,
        [
          id, b.name, b.email, b.phone, b.company, b.responsavel ?? null, b.stage ?? 'welcome',
          b.tenant_id ?? null, b.tenant_server_id ?? null, b.tenant_api_id ?? null, b.tenant_name ?? null,
          b.support_email ?? null, b.support_password ?? null,
          b.contract_url ?? null, b.contract_sent_at ?? null, b.contract_signed_at ?? null,
          b.asaas_customer_id ?? null, b.asaas_payment_id ?? null, b.asaas_subscription_id ?? null,
          b.implementation_value ?? null, b.monthly_value ?? null, b.due_day ?? null, b.payment_status ?? null,
          b.last_payment_check ?? null,
          JSON.stringify(b.payments ?? []), JSON.stringify(b.extra_links ?? []), b.finance_notes ?? null,
          b.briefing_token ?? null, b.briefing_status ?? null, b.briefing_sent_at ?? null,
          b.briefing_data ? JSON.stringify(b.briefing_data) : null,
          b.briefing_approved_at ?? null, b.briefing_revision_note ?? null,
          JSON.stringify(b.delivery_checklist ?? []),
          JSON.stringify(b.delivery_handoff_checklist ?? []),
          b.delivery_date ?? null, b.delivery_notes ?? null, b.delivery_completed_at ?? null,
          b.followup_active ?? false,
          JSON.stringify(b.followups ?? []),
          JSON.stringify(b.notes ?? []),
          JSON.stringify(b.logs ?? []),
        ]
      );
      return reply.status(201).send(row);
    }
  );

  // PATCH /api/clients/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      const patch = req.body;

      // Guard: suporte cannot touch finance/contract fields
      if (role === 'suporte') {
        const restricted = FINANCE_COLS.filter((col) => col in patch);
        if (restricted.length > 0) {
          return reply.status(403).send({
            message: `Role "suporte" não pode alterar: ${restricted.join(', ')}`,
          });
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;

      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        // Stringify JSON fields
        if (val !== null && typeof val === 'object') {
          params.push(JSON.stringify(val));
        } else {
          params.push(val);
        }
      }

      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(req.params.id);
      const [updated] = await query(
        `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!updated) return reply.status(404).send({ message: 'Cliente não encontrado' });
      return updated;
    }
  );

  // DELETE /api/clients/:id — admin only
  app.delete<{ Params: { id: string } }>(
    '/api/clients/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('DELETE FROM clients WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
