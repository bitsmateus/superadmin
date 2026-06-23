import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { sendWhatsAppToNumber } from '../lib/supportGroup.js';

/**
 * Lista os canais de TODOS os tenants (via NX listChannels por API) e reconcilia
 * o status que a NX reporta com o status real do provedor (Evolution / UAZAPI).
 * Tudo no superadmin — a NX é consultada com o token da API de cada tenant
 * (clients.tenant_api_token); Evolution/UAZAPI com credenciais das settings.
 * SOMENTE LEITURA: nada é criado, alterado ou apagado nos provedores.
 */

const SERVER_BASEURL_DEFAULTS: Record<string, string> = {
  chat: 'https://chatapi.nxsystems.com.br',
  app: 'https://appapi.nxsystems.com.br',
  web: 'https://webapi.nxsystems.com.br',
};

export type ChannelStatus = 'connected' | 'disconnected' | 'connecting' | 'unknown';

function normStatus(s: unknown): ChannelStatus {
  const u = String(s ?? '').toUpperCase();
  if (u === 'CONNECTED' || u === 'OPEN') return 'connected';
  if (u === 'CONNECTING') return 'connecting';
  if (u === 'DISCONNECTED' || u === 'CLOSE' || u === 'CLOSED') return 'disconnected';
  return 'unknown';
}

export interface ReconciledChannel {
  channel_key: string;
  client_id: string;
  client_name: string;
  client_company: string | null;
  server_id: string | null;
  nx_channel_id: number | string;
  name: string;
  type: string;
  number: string | null;
  token_api: string | null;
  waba_id: string | null;
  is_active: boolean;
  nx_status: ChannelStatus;
  real_status: ChannelStatus | null;
  divergent: boolean;
  /** Status que vale para alerta: o do provedor quando há, senão o da NX. */
  effective_status: ChannelStatus;
}

interface ReconcileError {
  client: string;
  error: string | null;
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    const text = await resp.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    return { ok: resp.ok, status: resp.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Busca canais na NX e reconcilia com os provedores. Reusado pela rota e pelo job. */
export async function reconcileChannels(): Promise<{
  channels: ReconciledChannel[];
  errors: ReconcileError[];
}> {
  const settings = await queryOne<{
    servers: Array<{ id?: string; baseUrl?: string }> | null;
    evolution: { baseUrl?: string; apiKey?: string } | null;
    uazapi: Array<{ url?: string; token?: string }> | null;
  }>('SELECT servers, evolution, uazapi FROM settings WHERE id = true');

  const serverBase: Record<string, string> = { ...SERVER_BASEURL_DEFAULTS };
  for (const s of settings?.servers ?? []) {
    if (s.id && s.baseUrl) serverBase[s.id] = s.baseUrl.replace(/\/$/, '');
  }
  const evoBase = (settings?.evolution?.baseUrl ?? '').replace(/\/$/, '');
  const evoKey = settings?.evolution?.apiKey ?? '';
  const evoOn = Boolean(evoBase && evoKey);

  const clients = await query<{
    id: string;
    name: string;
    company: string | null;
    tenant_api_id: string | null;
    tenant_api_token: string | null;
    tenant_server_id: string | null;
  }>(
    `SELECT id, name, company, tenant_api_id, tenant_api_token, tenant_server_id
     FROM clients
     WHERE tenant_api_id IS NOT NULL AND tenant_api_token IS NOT NULL
       AND archived_at IS NULL`,
  );

  const perClient = await mapPool(clients, 6, async (c) => {
    const base = (c.tenant_server_id && serverBase[c.tenant_server_id]) || '';
    if (!base) return { client: c, channels: [] as Record<string, unknown>[], error: 'servidor sem baseUrl' };
    const url = `${base}/v2/api/external/${encodeURIComponent(c.tenant_api_id!)}/listChannels`;
    try {
      const r = await fetchJson(url, {
        Accept: 'application/json',
        Authorization: `Bearer ${c.tenant_api_token}`,
      });
      if (!r.ok) return { client: c, channels: [], error: `NX ${r.status}` };
      const data = (r.body as { data?: unknown })?.data;
      const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
      return { client: c, channels: list, error: null };
    } catch (err) {
      return { client: c, channels: [], error: String(err).slice(0, 120) };
    }
  });

  const channels: ReconciledChannel[] = [];
  for (const { client: c, channels: list } of perClient) {
    for (const ch of list) {
      const nxStatus = normStatus(ch.status);
      channels.push({
        channel_key: `${c.tenant_server_id ?? ''}:${(ch.id as number | string) ?? ''}`,
        client_id: c.id,
        client_name: c.name,
        client_company: c.company,
        server_id: c.tenant_server_id,
        nx_channel_id: (ch.id as number | string) ?? '',
        name: String(ch.name ?? ''),
        type: String(ch.type ?? ''),
        number: (ch.number as string | null) ?? null,
        token_api: (ch.tokenAPI as string | null) ?? null,
        waba_id: (ch.wabaId as string | null) ?? null,
        is_active: Boolean(ch.isActive),
        nx_status: nxStatus,
        real_status: null,
        divergent: false,
        effective_status: nxStatus,
      });
    }
  }

  // Reconcilia Evolution (type 'evo').
  if (evoOn) {
    const evoChannels = channels.filter((c) => c.type === 'evo');
    await mapPool(evoChannels, 6, async (c) => {
      const instance = c.waba_id || c.name;
      if (!instance) return;
      try {
        const r = await fetchJson(
          `${evoBase}/instance/connectionState/${encodeURIComponent(instance)}`,
          { Accept: 'application/json', apikey: evoKey },
        );
        if (!r.ok) return;
        const body = r.body as { instance?: { state?: string }; state?: string } | undefined;
        const state = body?.instance?.state ?? body?.state;
        if (state == null) return;
        c.real_status = normStatus(state);
        c.divergent = c.real_status !== c.nx_status;
        c.effective_status = c.real_status;
      } catch {
        /* provedor indisponível */
      }
    });
  }

  // Reconcilia UAZAPI (type 'uazapi') via /instance/all (admintoken) batendo pelo token.
  const uazapiServers = (settings?.uazapi ?? []).filter((u) => u.url && u.token);
  if (uazapiServers.length > 0 && channels.some((c) => c.type === 'uazapi')) {
    const statusByToken = new Map<string, ChannelStatus>();
    await mapPool(uazapiServers, 4, async (sv) => {
      const base = (sv.url ?? '').replace(/\/$/, '');
      try {
        const r = await fetchJson(`${base}/instance/all`, {
          Accept: 'application/json',
          admintoken: sv.token ?? '',
        });
        if (!r.ok) return;
        const arr = Array.isArray(r.body)
          ? (r.body as Record<string, unknown>[])
          : ((r.body as { instances?: unknown })?.instances as Record<string, unknown>[]) ?? [];
        for (const inst of arr) {
          const tok = (inst.token as string) || '';
          if (tok) statusByToken.set(tok, normStatus(inst.status ?? inst.state));
        }
      } catch {
        /* servidor indisponível */
      }
    });
    for (const c of channels) {
      if (c.type !== 'uazapi' || !c.token_api) continue;
      const real = statusByToken.get(c.token_api);
      if (real == null) continue;
      c.real_status = real;
      c.divergent = real !== c.nx_status;
      c.effective_status = real;
    }
  }

  const errors = perClient
    .filter((p) => p.error)
    .map((p) => ({ client: p.client.company || p.client.name, error: p.error }));

  return { channels, errors };
}

export async function channelsRoutes(app: FastifyInstance) {
  app.get('/api/channels', { onRequest: [app.authenticate] }, async () => {
    const { channels, errors } = await reconcileChannels();

    // Funde a config de aviso por canal (liga/desliga + número).
    const cfgRows = await query<{
      channel_key: string;
      alerts_enabled: boolean;
      alert_number: string | null;
    }>('SELECT channel_key, alerts_enabled, alert_number FROM channel_alerts');
    const cfgByKey = new Map(cfgRows.map((r) => [r.channel_key, r]));

    const out = channels.map((c) => {
      const cfg = cfgByKey.get(c.channel_key);
      return {
        ...c,
        alerts_enabled: cfg?.alerts_enabled ?? false,
        alert_number: cfg?.alert_number ?? null,
      };
    });

    const summary = {
      total: out.length,
      connected: out.filter((c) => c.nx_status === 'connected').length,
      disconnected: out.filter((c) => c.nx_status === 'disconnected').length,
      connecting: out.filter((c) => c.nx_status === 'connecting').length,
      unknown: out.filter((c) => c.nx_status === 'unknown').length,
      divergent: out.filter((c) => c.divergent).length,
    };
    return { channels: out, summary, errors, updated_at: new Date().toISOString() };
  });

  // Salva a config de aviso de UM canal. Só preferência — não envia nada.
  app.post<{ Body: { channel_key?: string; alerts_enabled?: boolean; alert_number?: string } }>(
    '/api/channels/alert-config',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const key = (req.body?.channel_key ?? '').toString().trim();
      if (!key) return reply.status(400).send({ error: 'channel_key obrigatório' });
      const enabled = Boolean(req.body?.alerts_enabled);
      const number = (req.body?.alert_number ?? '').toString().trim() || null;
      await query(
        `INSERT INTO channel_alerts (channel_key, alerts_enabled, alert_number, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (channel_key) DO UPDATE SET
           alerts_enabled = EXCLUDED.alerts_enabled,
           alert_number = EXCLUDED.alert_number,
           updated_at = NOW()`,
        [key, enabled, number],
      );
      return { ok: true };
    },
  );

  // Envia uma mensagem de TESTE ao número informado (valida o número/credencial
  // antes de confiar no job). Vai pela credencial de suporte — nunca pro cliente.
  app.post<{ Body: { number?: string } }>(
    '/api/channels/alert-test',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const number = (req.body?.number ?? '').toString().trim();
      if (!number) return reply.status(400).send({ error: 'Número obrigatório' });
      const res = await sendWhatsAppToNumber(
        number,
        '✅ Teste de aviso de canais — NX. Se você recebeu esta mensagem, o número está OK.',
      );
      if (res.ok) return { ok: true };
      if (res.reason === 'not_configured')
        return reply.status(400).send({ error: 'Credencial de suporte (grupo de WhatsApp) não configurada.' });
      return reply
        .status(502)
        .send({ error: `Falha ao enviar${res.status ? ` (${res.status})` : ''}`, detail: res.detail });
    },
  );
}
