import { queryOne } from '../db.js';
import type { MetaAccess } from './metaGraph.js';

const SERVER_BASEURL_DEFAULTS: Record<string, string> = {
  chat: 'https://chatapi.nxsystems.com.br',
  app: 'https://appapi.nxsystems.com.br',
  web: 'https://webapi.nxsystems.com.br',
};

interface NxChannel {
  id: number;
  type?: string; // "waba" (oficial) | "uazapi" | "evo" | ...
  wabaId?: string | null;
  name?: string | null;
  number?: string | null;
}
interface NxChannelDetail {
  bmToken?: string | null; // token do Business Manager (Graph) — só vem no detalhe
  wabaId?: string | null;
  wabaVersion?: string | null; // ex.: "21.0"
}

export interface WabaOption extends MetaAccess {
  /** Nome/número do canal, pro cliente reconhecer qual número é qual ao escolher. */
  label: string;
}

async function fetchJson(url: string, headers: Record<string, string>, method = 'GET', body?: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: ctrl.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Resolve TODOS os números do WhatsApp oficial (WABA) do tenant de um cliente — um tenant pode
 * ter mais de um número conectado, e o formulário público deixa escolher em quais criar o
 * template. Mesmo caminho de dois passos que o Recorrai já usa em produção
 * (github.com/bitsmateus/recorra, templates.service.ts#acessosDoNx): `listChannels` só devolve
 * o wabaId (o tokenAPI ali é o Phone Number ID, não serve pro Graph); o token de verdade
 * (bmToken) só vem no detalhe de CADA canal, via `showChannelById`. [] = tenant sem canal WABA
 * configurado (ou credenciais do tenant ausentes).
 */
export async function resolveWabaAccesses(clientId: string): Promise<WabaOption[]> {
  const client = await queryOne<{
    tenant_server_id: string | null;
    tenant_api_id: string | null;
    tenant_api_token: string | null;
  }>(
    'SELECT tenant_server_id, tenant_api_id, tenant_api_token FROM clients WHERE id = $1',
    [clientId]
  );
  if (!client?.tenant_server_id || !client.tenant_api_id || !client.tenant_api_token) return [];

  const settings = await queryOne<{ servers: Array<{ id?: string; baseUrl?: string }> | null }>(
    'SELECT servers FROM settings WHERE id = true'
  );
  const serverBase: Record<string, string> = { ...SERVER_BASEURL_DEFAULTS };
  for (const s of settings?.servers ?? []) {
    if (s.id && s.baseUrl) serverBase[s.id] = s.baseUrl.replace(/\/$/, '');
  }
  const base = serverBase[client.tenant_server_id];
  if (!base) return [];

  const headers = { Accept: 'application/json', Authorization: `Bearer ${client.tenant_api_token}` };
  const apiId = client.tenant_api_id;

  const listRes = await fetchJson(`${base}/v2/api/external/${encodeURIComponent(apiId)}/listChannels`, headers);
  if (!listRes.ok) return [];
  const list = ((listRes.body as { data?: unknown })?.data ?? []) as NxChannel[];
  const wabaChannels = list.filter((c) => (c.type || '').toLowerCase() === 'waba' && c.wabaId);
  if (!wabaChannels.length) return [];

  const resolved = await Promise.all(
    wabaChannels.map(async (ch): Promise<WabaOption | null> => {
      const detailRes = await fetchJson(
        `${base}/v2/api/external/${encodeURIComponent(apiId)}/showChannelById`,
        { ...headers, 'Content-Type': 'application/json' },
        'POST',
        { id: ch.id }
      );
      if (!detailRes.ok) return null;
      const detail = ((detailRes.body as { data?: unknown })?.data ?? null) as NxChannelDetail | null;
      const bmToken = detail?.bmToken || '';
      const wabaId = detail?.wabaId || ch.wabaId || '';
      if (!bmToken || !wabaId) return null;
      return {
        wabaId,
        token: bmToken,
        version: (detail?.wabaVersion || '21.0').replace(/^v/i, ''),
        label: ch.name?.trim() || ch.number?.trim() || wabaId,
      };
    })
  );
  return resolved.filter((r): r is WabaOption => r !== null);
}

/** Resolve o acesso de UM número específico (pra "verificar status" de um alvo já criado). */
export async function resolveWabaAccessById(clientId: string, wabaId: string): Promise<MetaAccess | null> {
  const all = await resolveWabaAccesses(clientId);
  return all.find((a) => a.wabaId === wabaId) ?? null;
}
