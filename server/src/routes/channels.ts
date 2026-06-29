import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { sendOfficialTemplate } from '../lib/officialApi.js';
import { sendToSupportGroupId } from '../lib/supportGroup.js';

const ALERT_GROUP_ID = (process.env.ALERT_GROUP_ID || '120363409254876877').trim();

/**
 * Lista os canais de TODOS os tenants (via NX listChannels) E todas as
 * instâncias dos provedores (UAZAPI/Evolution), reconciliando o status que a NX
 * reporta com o real do provedor. Instâncias que existem no provedor mas não
 * batem com nenhum tenant da NX ficam como "avulsas" (orphans) — e podem ser
 * vinculadas manualmente a um cliente (channel_assignments).
 * SOMENTE LEITURA nos provedores: nada é criado, alterado ou apagado.
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
  source: 'nx' | 'provider';
  client_id: string | null;
  client_name: string | null;
  client_company: string | null;
  server_id: string | null;
  nx_channel_id: number | string | null;
  name: string;
  type: string;
  number: string | null;
  token_api: string | null;
  waba_id: string | null;
  is_active: boolean;
  nx_status: ChannelStatus;
  real_status: ChannelStatus | null;
  divergent: boolean;
  effective_status: ChannelStatus;
}

export interface OrphanInstance {
  provider: 'uazapi' | 'evolution';
  instance_key: string;
  name: string;
  number: string | null;
  status: ChannelStatus;
  server: string | null;
}

export interface UnlinkedTenant {
  client_id: string;
  name: string;
  company: string | null;
  tenant_id: string | null;
  tenant_api_id: string | null;
  server_id: string | null;
}

interface ReconcileError {
  client_id: string;
  client: string;
  server_id: string | null;
  error: string | null;
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 12_000, method = 'GET') {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method, headers, signal: ctrl.signal });
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

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Extrai um array de instâncias de respostas em formatos variados. */
function asInstanceArray(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['instances', 'data', 'result', 'items']) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
    }
  }
  return [];
}

export async function reconcileChannels(): Promise<{
  channels: ReconciledChannel[];
  orphans: OrphanInstance[];
  archivedOrphans: OrphanInstance[];
  errors: ReconcileError[];
  providerErrors: string[];
  unlinkedTenants: UnlinkedTenant[];
}> {
  const providerErrors: string[] = [];
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
  const uazapiServers = (settings?.uazapi ?? []).filter((u) => u.url && u.token);

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

  // Vínculos manuais de avulsos → cliente, e mapa de clientes (p/ nome/empresa).
  const assignmentRows = await query<{ provider: string; instance_key: string; client_id: string }>(
    'SELECT provider, instance_key, client_id FROM channel_assignments',
  );
  const assignments = new Map(assignmentRows.map((a) => [`${a.provider}:${a.instance_key}`, a.client_id]));
  const archivedRows = await query<{ provider: string; instance_key: string }>(
    'SELECT provider, instance_key FROM archived_orphans',
  );
  const archivedSet = new Set(archivedRows.map((a) => `${a.provider}:${a.instance_key}`));
  const allClients = await query<{ id: string; name: string; company: string | null }>(
    'SELECT id, name, company FROM clients',
  );
  const clientById = new Map(allClients.map((c) => [c.id, c]));

  // 1) Canais da NX por tenant.
  const perClient = await mapPool(clients, 6, async (c) => {
    const base = (c.tenant_server_id && serverBase[c.tenant_server_id]) || '';
    if (!base) return { client: c, channels: [] as Record<string, unknown>[], error: 'servidor sem baseUrl' };
    const url = `${base}/v2/api/external/${encodeURIComponent(c.tenant_api_id!)}/listChannels`;
    try {
      const r = await fetchJson(url, { Accept: 'application/json', Authorization: `Bearer ${c.tenant_api_token}` });
      if (!r.ok) return { client: c, channels: [], error: `NX ${r.status}` };
      const data = (r.body as { data?: unknown })?.data;
      return { client: c, channels: Array.isArray(data) ? (data as Record<string, unknown>[]) : [], error: null };
    } catch (err) {
      return { client: c, channels: [], error: String(err).slice(0, 120) };
    }
  });

  const channels: ReconciledChannel[] = [];
  // Identidades já representadas por canais da NX (p/ detectar avulsos).
  const claimedUazapi = new Set<string>();
  const claimedEvo = new Set<string>();
  // Dedup: nunca lista o mesmo canal da NX duas vezes (mesmo servidor+id).
  const seenChannelKeys = new Set<string>();

  for (const { client: c, channels: list } of perClient) {
    for (const ch of list) {
      const nxStatus = normStatus(ch.status);
      const type = String(ch.type ?? '');
      const tokenApi = (ch.tokenAPI as string | null) ?? null;
      const wabaId = (ch.wabaId as string | null) ?? null;
      const name = String(ch.name ?? '');
      if (type === 'uazapi' && tokenApi) claimedUazapi.add(tokenApi);
      if (type === 'evo' && (wabaId || name)) claimedEvo.add(wabaId || name);
      const channelKey = `${c.tenant_server_id ?? ''}:${(ch.id as number | string) ?? ''}`;
      if (seenChannelKeys.has(channelKey)) continue;
      seenChannelKeys.add(channelKey);
      channels.push({
        channel_key: channelKey,
        source: 'nx',
        client_id: c.id,
        client_name: c.name,
        client_company: c.company,
        server_id: c.tenant_server_id,
        nx_channel_id: (ch.id as number | string) ?? null,
        name,
        type,
        number: (ch.number as string | null) ?? null,
        token_api: tokenApi,
        waba_id: wabaId,
        is_active: Boolean(ch.isActive),
        nx_status: nxStatus,
        real_status: null,
        divergent: false,
        effective_status: nxStatus,
      });
    }
  }

  // 2) Instâncias dos provedores (todas) — p/ status real e p/ achar avulsos.
  const uazapiInstances: { server: string; token: string; name: string; number: string | null; status: ChannelStatus }[] = [];
  if (uazapiServers.length > 0) {
    await mapPool(uazapiServers, 4, async (sv) => {
      const base = (sv.url ?? '').replace(/\/$/, '');
      try {
        const r = await fetchJson(`${base}/instance/all`, { Accept: 'application/json', admintoken: sv.token ?? '' });
        if (!r.ok) {
          providerErrors.push(`UAZAPI ${base}: HTTP ${r.status}`);
          return;
        }
        const arr = asInstanceArray(r.body);
        for (const inst of arr) {
          const token = (inst.token as string) || '';
          if (!token) continue;
          uazapiInstances.push({
            server: base,
            token,
            name: pickStr(inst, 'name', 'profileName', 'instanceName') ?? token,
            number: pickStr(inst, 'number', 'phone', 'owner', 'wid'),
            status: normStatus(inst.status ?? inst.state),
          });
        }
      } catch (err) {
        providerErrors.push(`UAZAPI ${base}: ${String(err).slice(0, 80)}`);
      }
    });
  }

  const evoInstances: { name: string; number: string | null; status: ChannelStatus }[] = [];
  if (evoOn) {
    try {
      const r = await fetchJson(`${evoBase}/instance/fetchInstances`, { Accept: 'application/json', apikey: evoKey });
      if (!r.ok) {
        providerErrors.push(`Evolution: HTTP ${r.status}`);
      } else {
        for (const raw of asInstanceArray(r.body)) {
          const inner = (raw.instance && typeof raw.instance === 'object' ? raw.instance : raw) as Record<string, unknown>;
          const name = pickStr(inner, 'instanceName', 'name');
          if (!name) continue;
          evoInstances.push({
            name,
            number: pickStr(inner, 'number', 'owner', 'ownerJid')?.split('@')[0] ?? null,
            status: normStatus(inner.connectionStatus ?? inner.state ?? inner.status),
          });
        }
      }
    } catch (err) {
      providerErrors.push(`Evolution: ${String(err).slice(0, 80)}`);
    }
  }

  // 3) Reconcilia o status real nos canais da NX.
  const uazapiStatusByToken = new Map(uazapiInstances.map((i) => [i.token, i.status]));
  const evoStatusByName = new Map(evoInstances.map((i) => [i.name, i.status]));
  for (const c of channels) {
    if (c.type === 'uazapi' && c.token_api && uazapiStatusByToken.has(c.token_api)) {
      c.real_status = uazapiStatusByToken.get(c.token_api)!;
      c.divergent = c.real_status !== c.nx_status;
      c.effective_status = c.real_status;
    } else if (c.type === 'evo') {
      const key = c.waba_id || c.name;
      if (key && evoStatusByName.has(key)) {
        c.real_status = evoStatusByName.get(key)!;
        c.divergent = c.real_status !== c.nx_status;
        c.effective_status = c.real_status;
      }
    }
  }

  // 4) Avulsos: instâncias do provedor não representadas por canais da NX.
  // Se houver vínculo manual, viram "channel" sob o cliente; senão, orphan.
  const orphans: OrphanInstance[] = [];
  const archivedOrphans: OrphanInstance[] = [];
  // Dedup: a mesma instância (provider+key) nunca entra duas vezes, mesmo que
  // venha repetida de mais de um servidor / chamada.
  const seenProvider = new Set<string>();
  const addProviderInstance = (
    provider: 'uazapi' | 'evolution',
    key: string,
    name: string,
    number: string | null,
    status: ChannelStatus,
    server: string | null,
  ) => {
    const dedupId = `${provider}:${key}`;
    if (seenProvider.has(dedupId)) return;
    seenProvider.add(dedupId);
    const claimed = provider === 'uazapi' ? claimedUazapi.has(key) : claimedEvo.has(key);
    if (claimed) return; // já aparece como canal da NX
    // Avulso arquivado → vai para a lista de arquivados (não some, mas sai da principal).
    if (archivedSet.has(`${provider}:${key}`)) {
      archivedOrphans.push({ provider, instance_key: key, name, number, status, server });
      return;
    }
    const assignedClient = assignments.get(`${provider}:${key}`);
    if (assignedClient && clientById.has(assignedClient)) {
      const cl = clientById.get(assignedClient)!;
      channels.push({
        channel_key: `${provider}:${key}`,
        source: 'provider',
        client_id: cl.id,
        client_name: cl.name,
        client_company: cl.company,
        server_id: null,
        nx_channel_id: null,
        name,
        type: provider,
        number,
        token_api: provider === 'uazapi' ? key : null,
        waba_id: provider === 'evolution' ? key : null,
        is_active: true,
        nx_status: 'unknown',
        real_status: status,
        divergent: false,
        effective_status: status,
      });
    } else {
      orphans.push({ provider, instance_key: key, name, number, status, server });
    }
  };

  for (const i of uazapiInstances) addProviderInstance('uazapi', i.token, i.name, i.number, i.status, i.server);
  for (const i of evoInstances) addProviderInstance('evolution', i.name, i.name, i.number, i.status, null);

  const errors: ReconcileError[] = perClient
    .filter((p) => p.error)
    .map((p) => ({
      client_id: p.client.id,
      client: p.client.company || p.client.name,
      server_id: p.client.tenant_server_id,
      error: p.error,
    }));

  // Tenants antigos: têm contexto de tenant (id/apiId) mas sem token salvo —
  // não dá pra listar os canais até vincular o token.
  const unlinkedRows = await query<{
    id: string;
    name: string;
    company: string | null;
    tenant_id: string | null;
    tenant_api_id: string | null;
    tenant_server_id: string | null;
  }>(
    `SELECT id, name, company, tenant_id, tenant_api_id, tenant_server_id
     FROM clients
     WHERE archived_at IS NULL
       AND (tenant_id IS NOT NULL OR tenant_api_id IS NOT NULL)
       AND (tenant_api_token IS NULL OR tenant_api_token = '')
     ORDER BY company, name`,
  );
  const unlinkedTenants: UnlinkedTenant[] = unlinkedRows.map((r) => ({
    client_id: r.id,
    name: r.name,
    company: r.company,
    tenant_id: r.tenant_id,
    tenant_api_id: r.tenant_api_id,
    server_id: r.tenant_server_id,
  }));

  return { channels, orphans, archivedOrphans, errors, providerErrors, unlinkedTenants };
}

export async function channelsRoutes(app: FastifyInstance) {
  app.get('/api/channels', { onRequest: [app.authenticate] }, async () => {
    const { channels, orphans, archivedOrphans, errors, providerErrors, unlinkedTenants } =
      await reconcileChannels();

    const cfgRows = await query<{ channel_key: string; alerts_enabled: boolean; alert_number: string | null }>(
      'SELECT channel_key, alerts_enabled, alert_number FROM channel_alerts',
    );
    const cfgByKey = new Map(cfgRows.map((r) => [r.channel_key, r]));

    const out = channels.map((c) => {
      const cfg = cfgByKey.get(c.channel_key);
      // Default por canal = "sim" (avisa), salvo se houver config explícita "não".
      return { ...c, alerts_enabled: cfg ? cfg.alerts_enabled : true, alert_number: cfg?.alert_number ?? null };
    });

    const summary = {
      total: out.length,
      connected: out.filter((c) => c.effective_status === 'connected').length,
      disconnected: out.filter((c) => c.effective_status === 'disconnected').length,
      connecting: out.filter((c) => c.effective_status === 'connecting').length,
      unknown: out.filter((c) => c.effective_status === 'unknown').length,
      divergent: out.filter((c) => c.divergent).length,
      orphans: orphans.length,
    };
    return {
      channels: out,
      orphans,
      archivedOrphans,
      summary,
      errors,
      providerErrors,
      unlinkedTenants,
      updated_at: new Date().toISOString(),
    };
  });

  // Salva a config de aviso de UM canal (só preferência — não envia nada).
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
           alerts_enabled = EXCLUDED.alerts_enabled, alert_number = EXCLUDED.alert_number, updated_at = NOW()`,
        [key, enabled, number],
      );
      return { ok: true };
    },
  );

  // Vincula (ou desvincula com client_id null) uma instância avulsa a um cliente.
  app.post<{ Body: { provider?: string; instance_key?: string; client_id?: string | null } }>(
    '/api/channels/assign',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const provider = (req.body?.provider ?? '').toString().trim();
      const instanceKey = (req.body?.instance_key ?? '').toString().trim();
      const clientId = req.body?.client_id ? String(req.body.client_id) : null;
      if (!provider || !instanceKey) return reply.status(400).send({ error: 'provider e instance_key obrigatórios' });
      if (clientId) {
        await query(
          `INSERT INTO channel_assignments (provider, instance_key, client_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (provider, instance_key) DO UPDATE SET client_id = EXCLUDED.client_id, updated_at = NOW()`,
          [provider, instanceKey, clientId],
        );
      } else {
        await query('DELETE FROM channel_assignments WHERE provider = $1 AND instance_key = $2', [provider, instanceKey]);
      }
      return { ok: true };
    },
  );

  // Testa o token/apiId de um tenant: chama listChannels e devolve a contagem
  // (ou o erro). Ajuda a entender por que um tenant não lista canais.
  app.post<{ Body: { server_id?: string; api_id?: string; token?: string } }>(
    '/api/channels/test-tenant',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const serverId = (req.body?.server_id ?? '').toString().trim();
      const apiId = (req.body?.api_id ?? '').toString().trim();
      const token = (req.body?.token ?? '').toString().trim();
      if (!apiId || !token) return reply.status(400).send({ error: 'API ID e token são obrigatórios' });

      const settings = await queryOne<{ servers: Array<{ id?: string; baseUrl?: string }> | null }>(
        'SELECT servers FROM settings WHERE id = true',
      );
      const base =
        (settings?.servers ?? []).find((s) => s.id === serverId)?.baseUrl?.replace(/\/$/, '') ||
        SERVER_BASEURL_DEFAULTS[serverId] ||
        '';
      if (!base) return reply.status(400).send({ error: 'Servidor inválido / sem URL' });

      try {
        const r = await fetchJson(`${base}/v2/api/external/${encodeURIComponent(apiId)}/listChannels`, {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        });
        if (!r.ok) return reply.send({ ok: false, status: r.status, count: 0 });
        const data = (r.body as { data?: unknown })?.data;
        const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
        return reply.send({ ok: true, count: list.length, names: list.slice(0, 10).map((c) => String(c.name ?? '')) });
      } catch (err) {
        return reply.send({ ok: false, error: String(err).slice(0, 200), count: 0 });
      }
    },
  );

  // Arquiva/restaura avulsos (em lote). Não mexe no provedor — só esconde da
  // lista principal e mostra na seção "Arquivados". Para canais quebrados que
  // não dá pra excluir na UAZAPI/Evolution.
  app.post<{ Body: { items?: { provider?: string; instance_key?: string }[]; archived?: boolean } }>(
    '/api/channels/archive-orphans',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const items = Array.isArray(req.body?.items) ? req.body!.items : [];
      const archived = req.body?.archived !== false; // default true
      const clean = items
        .map((i) => ({ provider: (i.provider ?? '').toString().trim(), key: (i.instance_key ?? '').toString().trim() }))
        .filter((i) => i.provider && i.key);
      if (clean.length === 0) return reply.status(400).send({ error: 'Nenhum item válido' });
      for (const i of clean) {
        if (archived) {
          // eslint-disable-next-line no-await-in-loop
          await query(
            `INSERT INTO archived_orphans (provider, instance_key, archived_at)
             VALUES ($1, $2, NOW()) ON CONFLICT (provider, instance_key) DO NOTHING`,
            [i.provider, i.key],
          );
        } else {
          // eslint-disable-next-line no-await-in-loop
          await query('DELETE FROM archived_orphans WHERE provider = $1 AND instance_key = $2', [i.provider, i.key]);
        }
      }
      return { ok: true, count: clean.length };
    },
  );

  // DESTRUTIVO: exclui a instância no provedor (UAZAPI/Evolution). Usado só nos
  // "números avulsos". Confirme na UI antes de chamar.
  app.post<{ Body: { provider?: string; instance_key?: string; server?: string } }>(
    '/api/channels/delete-instance',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const provider = (req.body?.provider ?? '').toString().trim();
      const instanceKey = (req.body?.instance_key ?? '').toString().trim();
      const serverUrl = (req.body?.server ?? '').toString().trim();
      if (!provider || !instanceKey) return reply.status(400).send({ error: 'provider e instance_key obrigatórios' });

      const settings = await queryOne<{
        evolution: { baseUrl?: string; apiKey?: string } | null;
        uazapi: Array<{ url?: string; token?: string }> | null;
      }>('SELECT evolution, uazapi FROM settings WHERE id = true');

      try {
        if (provider === 'evolution') {
          const base = (settings?.evolution?.baseUrl ?? '').replace(/\/$/, '');
          const key = settings?.evolution?.apiKey ?? '';
          if (!base || !key) return reply.status(400).send({ error: 'Evolution não configurada' });
          const r = await fetchJson(
            `${base}/instance/delete/${encodeURIComponent(instanceKey)}`,
            { Accept: 'application/json', apikey: key },
            12_000,
            'DELETE',
          );
          if (!r.ok) return reply.status(502).send({ error: `Evolution: HTTP ${r.status}` });
          return { ok: true };
        }
        if (provider === 'uazapi') {
          const base = (serverUrl || (settings?.uazapi ?? [])[0]?.url || '').replace(/\/$/, '');
          if (!base) return reply.status(400).send({ error: 'Servidor UAZAPI não informado' });
          const admin = (settings?.uazapi ?? []).find((u) => (u.url ?? '').replace(/\/$/, '') === base)?.token;
          // UAZAPI: DELETE /instance autentica com o token da instância (e, se
          // houver, o admintoken do servidor).
          const r = await fetchJson(
            `${base}/instance`,
            {
              Accept: 'application/json',
              token: instanceKey,
              ...(admin ? { admintoken: admin } : {}),
            },
            12_000,
            'DELETE',
          );
          if (!r.ok) return reply.status(502).send({ error: `UAZAPI: HTTP ${r.status}` });
          return { ok: true };
        }
        return reply.status(400).send({ error: 'provider inválido' });
      } catch (err) {
        return reply.status(502).send({ error: String(err).slice(0, 200) });
      }
    },
  );

  // Envia o template de TESTE (teste_envio) ao número informado, pela API Oficial.
  app.post<{ Body: { number?: string } }>(
    '/api/channels/alert-test',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const number = (req.body?.number ?? '').toString().trim();
      if (!number) return reply.status(400).send({ error: 'Número obrigatório' });
      const res = await sendOfficialTemplate(number, 'teste_envio', []);
      if (ALERT_GROUP_ID) {
        await sendToSupportGroupId(
          ALERT_GROUP_ID,
          `🧪 *Teste de aviso de canal*\nEnviado para: ${number}\nSe você está vendo isto, a cópia no grupo está funcionando.`,
        ).catch(() => {});
      }
      if (res.ok) return { ok: true };
      if (res.reason === 'not_configured')
        return reply.status(400).send({ error: 'API Oficial não configurada (OFFICIAL_API_URL / OFFICIAL_API_TOKEN).' });
      return reply.status(502).send({ error: `Falha ao enviar${res.status ? ` (${res.status})` : ''}`, detail: res.detail });
    },
  );

  // Relatório de monitoramento: canais desconectados AGORA (com "desde quando")
  // e o histórico recente de quedas/retornos (channel_events, alimentado pelo job).
  app.get('/api/channels/report', { onRequest: [app.authenticate] }, async () => {
    const { channels } = await reconcileChannels();
    const disconnected = channels.filter((c) => c.effective_status === 'disconnected');
    const keys = disconnected.map((c) => c.channel_key);

    const sinceRows = keys.length
      ? await query<{ channel_key: string; status_since: string | null }>(
          'SELECT channel_key, status_since FROM channel_alerts WHERE channel_key = ANY($1)',
          [keys],
        )
      : [];
    const sinceByKey = new Map(sinceRows.map((r) => [r.channel_key, r.status_since]));

    const down = disconnected
      .map((c) => ({
        channel_key: c.channel_key,
        name: c.name,
        number: c.number,
        client_id: c.client_id,
        client_name: c.client_company || c.client_name,
        divergent: c.divergent,
        since: sinceByKey.get(c.channel_key) ?? null,
      }))
      // Mais tempo fora primeiro (since mais antigo). Sem registro de "desde" vai pro fim.
      .sort((a, b) => {
        const ta = a.since ? new Date(a.since).getTime() : NaN;
        const tb = b.since ? new Date(b.since).getTime() : NaN;
        if (Number.isNaN(ta)) return 1;
        if (Number.isNaN(tb)) return -1;
        return ta - tb;
      });

    const events = await query<{
      channel_key: string;
      channel_name: string | null;
      channel_number: string | null;
      client_name: string | null;
      status: string;
      changed_at: string;
    }>(
      `SELECT channel_key, channel_name, channel_number, client_name, status, changed_at
       FROM channel_events ORDER BY changed_at DESC LIMIT 100`,
    );

    const c24 = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM channel_events
       WHERE status = 'disconnected' AND changed_at > NOW() - INTERVAL '24 hours'`,
    );

    return {
      disconnected: down,
      events,
      summary: {
        disconnected_now: down.length,
        divergent_now: channels.filter((c) => c.divergent).length,
        disconnects_24h: c24?.n ?? 0,
        total: channels.length,
      },
      updated_at: new Date().toISOString(),
    };
  });
}
