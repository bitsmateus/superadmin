import { FastifyInstance } from 'fastify';
import { queryOne, query } from '../db.js';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings
  app.get('/api/settings', { onRequest: [app.authenticate] }, async () => {
    const row = await queryOne('SELECT * FROM settings WHERE id = true');
    return row ?? {};
  });

  // PUT /api/settings — admin only
  app.put<{ Body: Record<string, unknown> }>(
    '/api/settings',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const b = req.body;
      const [row] = await query(
        `INSERT INTO settings (
          id, asaas_api_key, asaas_environment, asaas_sync_interval_min,
          default_tenant_password, default_access_password, support_phone,
          followups_enabled, followup_templates,
          nps_delay_days, nps_enabled, notify_edge_function_url, notify_enabled,
          goal_new_clients_monthly, goal_mrr_monthly, goal_nps_monthly, goals_enabled,
          last_backup_at, backup_remind_days, updated_at
        ) VALUES (
          true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          asaas_api_key = EXCLUDED.asaas_api_key,
          asaas_environment = EXCLUDED.asaas_environment,
          asaas_sync_interval_min = EXCLUDED.asaas_sync_interval_min,
          default_tenant_password = EXCLUDED.default_tenant_password,
          default_access_password = EXCLUDED.default_access_password,
          support_phone = EXCLUDED.support_phone,
          followups_enabled = EXCLUDED.followups_enabled,
          followup_templates = EXCLUDED.followup_templates,
          nps_delay_days = EXCLUDED.nps_delay_days,
          nps_enabled = EXCLUDED.nps_enabled,
          notify_edge_function_url = EXCLUDED.notify_edge_function_url,
          notify_enabled = EXCLUDED.notify_enabled,
          goal_new_clients_monthly = EXCLUDED.goal_new_clients_monthly,
          goal_mrr_monthly = EXCLUDED.goal_mrr_monthly,
          goal_nps_monthly = EXCLUDED.goal_nps_monthly,
          goals_enabled = EXCLUDED.goals_enabled,
          last_backup_at = EXCLUDED.last_backup_at,
          backup_remind_days = EXCLUDED.backup_remind_days,
          updated_at = NOW()
        RETURNING *`,
        [
          b.asaas_api_key ?? null, b.asaas_environment ?? 'sandbox',
          b.asaas_sync_interval_min ?? 15,
          b.default_tenant_password ?? null, b.default_access_password ?? null,
          b.support_phone ?? null,
          b.followups_enabled ?? true,
          b.followup_templates ? JSON.stringify(b.followup_templates) : null,
          b.nps_delay_days ?? 7, b.nps_enabled ?? true,
          b.notify_edge_function_url ?? null, b.notify_enabled ?? false,
          b.goal_new_clients_monthly ?? null, b.goal_mrr_monthly ?? null,
          b.goal_nps_monthly ?? null, b.goals_enabled ?? false,
          b.last_backup_at ?? null, b.backup_remind_days ?? 7,
        ]
      );
      return row;
    }
  );
}
