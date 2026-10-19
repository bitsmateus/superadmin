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

export interface NxCredentials {
  baseUrl: string;
  apiId: string;
  apiToken: string;
}

/** Credenciais NX cruas do tenant de um cliente (base URL + apiId + token) — o suficiente pra
 *  chamar `listChannels`/`showChannelById`/envio de template pela própria NX. Diferente de
 *  `resolveWabaAccesses`, que ainda troca isso pelo bmToken da Meta (só necessário pra CRIAR
 *  template no Graph direto) — pra ENVIAR via NX (ver lib/nxTemplateSend.ts) essas credenciais
 *  já bastam, é a própria NX quem fala com a Meta por trás. null = tenant sem credenciais/servidor
 *  configurado. */
export async function resolveNxCredentials(clientId: string): Promise<NxCredentials | null> {
  const client = await queryOne<{
    tenant_server_id: string | null;
    tenant_api_id: string | null;
    tenant_api_token: string | null;
  }>(
    'SELECT tenant_server_id, tenant_api_id, tenant_api_token FROM clients WHERE id = $1',
    [clientId]
  );
  if (!client?.tenant_server_id || !client.tenant_api_id || !client.tenant_api_token) return null;

  const settings = await queryOne<{ servers: Array<{ id?: string; baseUrl?: string }> | null }>(
    'SELECT servers FROM settings WHERE id = true'
  );
  const serverBase: Record<string, string> = { ...SERVER_BASEURL_DEFAULTS };
  for (const s of settings?.servers ?? []) {
    if (s.id && s.baseUrl) serverBase[s.id] = s.baseUrl.replace(/\/$/, '');
  }
  const baseUrl = serverBase[client.tenant_server_id];
  if (!baseUrl) return null;

  return { baseUrl, apiId: client.tenant_api_id, apiToken: client.tenant_api_token };
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
  return (await diagnosticarWaba(clientId)).acessos;
}

/** Trecho curto da resposta da NX pro motivo/log (sem despejar o corpo inteiro). */
function resumo(res: { status: number; body: unknown }): string {
  const b = res.body as { error?: unknown; message?: unknown } | string | undefined;
  const txt = typeof b === 'string' ? b : String((b && (b.error ?? b.message)) ?? '');
  return `HTTP ${res.status}${txt ? ` — ${txt.slice(0, 120)}` : ''}`;
}

/**
 * Igual a `resolveWabaAccesses`, mas quando não acha nenhum número diz EM QUE PASSO parou (antes tudo virava
 * "não encontramos um WhatsApp oficial", e não dava pra saber se era cadastro, NX ou Meta). O motivo também
 * vai pro log do servidor.
 */
export async function diagnosticarWaba(clientId: string): Promise<{ acessos: WabaOption[]; motivo: string | null }> {
  const falhou = (motivo: string) => {
    console.warn(`[waba] cliente ${clientId}: ${motivo}`);
    return { acessos: [] as WabaOption[], motivo };
  };

  const nx = await resolveNxCredentials(clientId);
  if (!nx) return falhou('o cliente está sem servidor, API ID ou token da NX no cadastro');
  const { baseUrl: base, apiId, apiToken } = nx;

  const headers = { Accept: 'application/json', Authorization: `Bearer ${apiToken}` };

  const listRes = await fetchJson(`${base}/v2/api/external/${encodeURIComponent(apiId)}/listChannels`, headers).catch(
    (err: unknown) => ({ ok: false, status: 0, body: err instanceof Error ? err.message : String(err) })
  );
  if (!listRes.ok) return falhou(`a NX recusou listar os canais (${resumo(listRes)})`);
  const list = ((listRes.body as { data?: unknown })?.data ?? []) as NxChannel[];
  const wabaChannels = list.filter((c) => (c.type || '').toLowerCase() === 'waba' && c.wabaId);
  if (!wabaChannels.length) return falhou(`a NX não tem canal do WhatsApp oficial (WABA) nesse tenant (${list.length} canal(is) de outro tipo)`);

  const problemas: string[] = [];
  const resolved = await Promise.all(
    wabaChannels.map(async (ch): Promise<WabaOption | null> => {
      const nome = ch.name?.trim() || ch.number?.trim() || String(ch.id);
      const detailRes = await fetchJson(
        `${base}/v2/api/external/${encodeURIComponent(apiId)}/showChannelById`,
        { ...headers, 'Content-Type': 'application/json' },
        'POST',
        { id: ch.id }
      ).catch((err: unknown) => ({ ok: false, status: 0, body: err instanceof Error ? err.message : String(err) }));
      if (!detailRes.ok) {
        problemas.push(`canal ${nome}: a NX recusou o detalhe (${resumo(detailRes)})`);
        return null;
      }
      const detail = ((detailRes.body as { data?: unknown })?.data ?? null) as NxChannelDetail | null;
      const bmToken = detail?.bmToken || '';
      const wabaId = detail?.wabaId || ch.wabaId || '';
      if (!bmToken || !wabaId) {
        problemas.push(`canal ${nome}: a NX não devolveu ${!bmToken ? 'o token da Meta (bmToken)' : 'o WABA ID'}`);
        return null;
      }
      return {
        wabaId,
        token: bmToken,
        version: (detail?.wabaVersion || '21.0').replace(/^v/i, ''),
        label: ch.name?.trim() || ch.number?.trim() || wabaId,
      };
    })
  );
  const acessos = resolved.filter((r): r is WabaOption => r !== null);
  if (!acessos.length) return falhou(problemas.join('; '));
  return { acessos, motivo: null };
}

/** Resolve o acesso de UM número específico (pra "verificar status" de um alvo já criado). */
export async function resolveWabaAccessById(clientId: string, wabaId: string): Promise<MetaAccess | null> {
  const all = await resolveWabaAccesses(clientId);
  return all.find((a) => a.wabaId === wabaId) ?? null;
}
