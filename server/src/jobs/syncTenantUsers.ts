import { query, queryOne } from '../db.js';

// Sincroniza o índice tenant_users (email -> tenant + nível). Para cada cliente
// com API de tenant configurada, varre o listUsers do Z-Pro daquele tenant e
// guarda os e-mails/níveis. Assim o agente de suporte consegue identificar de
// qual cliente é um funcionário só pelo e-mail, mesmo sem o número cadastrado.

type StoredServer = { id?: string; baseUrl?: string; apiToken?: string };

type ClientRow = {
  id: string;
  name: string | null;
  tenant_name: string | null;
  tenant_api_id: string | null;
  tenant_api_token: string | null;
  tenant_server_id: string | null;
};

const DEFAULT_BASE = 'https://appapi.nxsystems.com.br';
const PAGE_SIZE_HINT = 20; // heurística de última página

function resolveBaseUrl(serverId: string | null, servers: StoredServer[]): string {
  if (serverId) {
    const s = servers.find((x) => x.id === serverId);
    if (s?.baseUrl) return s.baseUrl.replace(/\/$/, '');
  }
  return DEFAULT_BASE;
}

function extractUsers(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const arr = (p.users || p.data || p.rows || []) as unknown;
  return Array.isArray(arr) ? (arr as Array<Record<string, unknown>>) : [];
}

export async function syncTenantUsers(): Promise<{ tenants: number; users: number }> {
  const settings = await queryOne<{ servers: StoredServer[] | null }>(
    'SELECT servers FROM settings WHERE id = true'
  );
  const servers = Array.isArray(settings?.servers) ? (settings!.servers as StoredServer[]) : [];

  const clients = await query<ClientRow>(
    `SELECT id, name, tenant_name, tenant_api_id, tenant_api_token, tenant_server_id
     FROM clients
     WHERE tenant_api_id IS NOT NULL
       AND tenant_api_token IS NOT NULL
       AND archived_at IS NULL`
  );

  let tenantCount = 0;
  let userCount = 0;

  for (const c of clients) {
    const base = resolveBaseUrl(c.tenant_server_id, servers);
    const seen = new Map<string, { name: string; role: string }>();

    try {
      for (let page = 1; page <= 50; page++) {
        const url = `${base}/v2/api/external/${c.tenant_api_id}/listUsers?pageNumber=${page}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${c.tenant_api_token}` },
        });
        if (!res.ok) break;
        const payload = await res.json().catch(() => null);
        const users = extractUsers(payload);
        if (!users.length) break;
        for (const u of users) {
          const email = String(u.email || '').trim().toLowerCase();
          if (!email) continue;
          seen.set(email, {
            name: String(u.name || ''),
            role: String(u.profile || u.role || 'user'),
          });
        }
        if (users.length < PAGE_SIZE_HINT) break;
      }
    } catch (err) {
      console.error(`[syncTenantUsers] tenant ${c.id} (${c.name ?? ''}) falhou`, err);
      continue;
    }

    if (seen.size === 0) continue;
    tenantCount++;

    const emails: string[] = [];
    for (const [email, info] of seen) {
      emails.push(email);
      await query(
        `INSERT INTO tenant_users (client_id, email, name, role, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (client_id, email)
         DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, updated_at = NOW()`,
        [c.id, email, info.name, info.role]
      );
      userCount++;
    }
    // Remove e-mails que sumiram desse tenant desde a última varredura.
    await query(
      `DELETE FROM tenant_users WHERE client_id = $1 AND email <> ALL($2::text[])`,
      [c.id, emails]
    );
  }

  console.log(`[syncTenantUsers] concluído: ${tenantCount} tenants, ${userCount} usuários`);
  return { tenants: tenantCount, users: userCount };
}

// Agenda a sincronização: primeira 30s após subir, depois a cada 6h.
export function startTenantUsersSync() {
  const run = () => {
    syncTenantUsers().catch((err) => console.error('[syncTenantUsers] erro na execução', err));
  };
  setTimeout(run, 30_000);
  setInterval(run, 6 * 60 * 60 * 1000);
}
