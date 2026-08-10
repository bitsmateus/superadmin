import { FastifyInstance } from 'fastify';
import { queryOne, query } from '../db.js';
import { sendSupportGroupMessage, sendWhatsAppToNumber } from '../lib/supportGroup.js';
import { createEvolutionInstance } from '../lib/evolution.js';

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/settings — token dos servers é mascarado (nunca vai pro front).
  app.get('/api/settings', { onRequest: [app.authenticate] }, async () => {
    const row = await queryOne<Record<string, unknown>>('SELECT * FROM settings WHERE id = true');
    if (row && Array.isArray(row.servers)) {
      row.servers = (row.servers as Array<Record<string, unknown>>).map((s) => ({
        ...s,
        apiToken: '',
        apiTokenSet: Boolean(s.apiToken),
      }));
    }
    // Mascara o token do grupo do WhatsApp também.
    if (row && row.support_group && typeof row.support_group === 'object') {
      const sg = row.support_group as Record<string, unknown>;
      row.support_group = { ...sg, token: '', tokenSet: Boolean(sg.token) };
    }
    // Mascara a apiKey da Evolution.
    if (row && row.evolution && typeof row.evolution === 'object') {
      const ev = row.evolution as Record<string, unknown>;
      row.evolution = { ...ev, apiKey: '', apiKeySet: Boolean(ev.apiKey) };
    }
    // Mascara os tokens dos servidores UAZAPI.
    if (row && Array.isArray(row.uazapi)) {
      row.uazapi = (row.uazapi as Array<Record<string, unknown>>).map((u) => ({
        url: u.url,
        token: '',
        tokenSet: Boolean(u.token),
      }));
    }
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

      // Merge dos servers preservando o token existente quando o front manda
      // vazio (token mascarado). Remove o flag de UI apiTokenSet. Só grava o
      // token quando o admin digita um novo.
      let serversParam: string | null = null;
      if (Array.isArray(b.servers) && b.servers.length > 0) {
        const existing = await queryOne<{ servers: Array<Record<string, unknown>> | null }>(
          'SELECT servers FROM settings WHERE id = true'
        );
        const existingServers = Array.isArray(existing?.servers) ? existing!.servers : [];
        const merged = (b.servers as Array<Record<string, unknown>>).map((s) => {
          const rest: Record<string, unknown> = { ...s };
          delete rest.apiTokenSet; // flag de UI — não persiste
          const token = typeof s.apiToken === 'string' ? s.apiToken.trim() : '';
          if (token) {
            rest.apiToken = token;
          } else {
            const prev = existingServers.find((e) => e.id === s.id);
            rest.apiToken = (prev?.apiToken as string) ?? '';
          }
          return rest;
        });
        serversParam = JSON.stringify(merged);
      }

      // Merge do grupo de WhatsApp preservando o token quando vier vazio.
      let supportGroupParam: string | null = null;
      if (b.support_group && typeof b.support_group === 'object') {
        const sg = b.support_group as Record<string, unknown>;
        const existing = await queryOne<{ support_group: Record<string, unknown> | null }>(
          'SELECT support_group FROM settings WHERE id = true'
        );
        const prev = (existing?.support_group ?? {}) as Record<string, unknown>;
        const rest: Record<string, unknown> = { ...sg };
        delete rest.tokenSet;
        const token = typeof sg.token === 'string' ? sg.token.trim() : '';
        rest.token = token || (prev.token as string) || '';
        // Preserva o controle de envio do digest (gerido pelo job).
        if (prev.lastDigestDate && !rest.lastDigestDate) rest.lastDigestDate = prev.lastDigestDate;
        supportGroupParam = JSON.stringify(rest);
      }

      // Merge da Evolution preservando a apiKey quando vier vazia (mascarada).
      let evolutionParam: string | null = null;
      if (b.evolution && typeof b.evolution === 'object') {
        const ev = b.evolution as Record<string, unknown>;
        const existing = await queryOne<{ evolution: Record<string, unknown> | null }>(
          'SELECT evolution FROM settings WHERE id = true'
        );
        const prev = (existing?.evolution ?? {}) as Record<string, unknown>;
        const rest: Record<string, unknown> = { ...ev };
        delete rest.apiKeySet;
        const apiKey = typeof ev.apiKey === 'string' ? ev.apiKey.trim() : '';
        rest.apiKey = apiKey || (prev.apiKey as string) || '';
        evolutionParam = JSON.stringify(rest);
      }

      // Merge dos servidores UAZAPI preservando o token (por url) quando vazio.
      let uazapiParam: string | null = null;
      if (Array.isArray(b.uazapi)) {
        const existing = await queryOne<{ uazapi: Array<Record<string, unknown>> | null }>(
          'SELECT uazapi FROM settings WHERE id = true'
        );
        const prev = Array.isArray(existing?.uazapi) ? existing!.uazapi : [];
        const merged = (b.uazapi as Array<Record<string, unknown>>)
          .map((u) => {
            const url = typeof u.url === 'string' ? u.url.trim().replace(/\/$/, '') : '';
            const token = typeof u.token === 'string' ? u.token.trim() : '';
            const prevToken = (prev.find((p) => p.url === url)?.token as string) || '';
            return { url, token: token || prevToken };
          })
          .filter((u) => u.url);
        uazapiParam = JSON.stringify(merged);
      }

      const [row] = await query(
        `INSERT INTO settings (
          id, asaas_api_key, asaas_environment, asaas_sync_interval_min,
          default_tenant_password, default_access_password, support_phone,
          followups_enabled, followup_templates,
          nps_delay_days, nps_enabled, notify_edge_function_url, notify_enabled,
          goal_new_clients_monthly, goal_mrr_monthly, goal_nps_monthly, goals_enabled,
          last_backup_at, backup_remind_days, servers, support_group, evolution, uazapi, sla_by_stage, updated_at
        ) VALUES (
          true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
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
          servers = COALESCE(EXCLUDED.servers, settings.servers),
          support_group = COALESCE(EXCLUDED.support_group, settings.support_group),
          evolution = COALESCE(EXCLUDED.evolution, settings.evolution),
          uazapi = COALESCE(EXCLUDED.uazapi, settings.uazapi),
          sla_by_stage = COALESCE(EXCLUDED.sla_by_stage, settings.sla_by_stage),
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
          serversParam,
          supportGroupParam,
          evolutionParam,
          uazapiParam,
          b.sla_by_stage ? JSON.stringify(b.sla_by_stage) : null,
        ]
      );
      return row;
    }
  );

  // POST /api/support-group/send — envia uma mensagem ao grupo de WhatsApp
  // configurado. O token fica só no servidor (lido aqui de settings).
  app.post<{ Body: { text?: string } }>(
    '/api/support-group/send',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const text = (req.body?.text ?? '').toString();
      const res = await sendSupportGroupMessage(text);
      if (res.ok) return { ok: true };
      if (res.reason === 'empty') return reply.status(400).send({ message: 'Mensagem vazia' });
      if (res.reason === 'not_configured')
        return reply.status(400).send({ message: 'Grupo do WhatsApp não configurado' });
      return reply
        .status(502)
        .send({ message: `Falha ao enviar${res.status ? ` (NX ${res.status})` : ''}`, detail: res.detail });
    }
  );

  // POST /api/evolution/instance — cria uma instância na Evolution API com o
  // nome informado (mesmo nome usado na sessão do NX). apiKey fica só no servidor.
  app.post<{ Body: { instanceName?: string } }>(
    '/api/evolution/instance',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const instanceName = (req.body?.instanceName ?? '').toString();
      if (!instanceName.trim())
        return reply.status(400).send({ message: 'instanceName não informado' });
      const res = await createEvolutionInstance(instanceName);
      if (res.ok) return { ok: true, detail: res.detail };
      if (res.reason === 'not_configured')
        return reply.status(400).send({ message: 'Evolution não configurada em Configurações' });
      return reply
        .status(502)
        .send({ message: `Falha ao criar instância${res.status ? ` (${res.status})` : ''}`, detail: res.detail });
    }
  );

  // POST /api/whatsapp/send — envia mensagem a um número pessoal (com 55+DDD).
  app.post<{ Body: { number?: string; text?: string } }>(
    '/api/whatsapp/send',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const number = (req.body?.number ?? '').toString();
      const text = (req.body?.text ?? '').toString();
      if (!number.trim()) return reply.status(400).send({ message: 'Número não informado' });
      const res = await sendWhatsAppToNumber(number, text);
      if (res.ok) return { ok: true };
      if (res.reason === 'empty') return reply.status(400).send({ message: 'Mensagem vazia' });
      if (res.reason === 'not_configured')
        return reply.status(400).send({ message: 'Grupo/credenciais não configurados ou número inválido' });
      return reply
        .status(502)
        .send({ message: `Falha ao enviar${res.status ? ` (NX ${res.status})` : ''}`, detail: res.detail });
    }
  );
}
