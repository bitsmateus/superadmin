import { queryOne } from '../../db.js';
import type { ConfigMonitor } from './regras.js';

/**
 * Cliente da API externa da NX (Z-PRO v4: /v2/api/external/{apiId}/...) usado pelo Monitor de Atendimento.
 * A credencial é a do monitor (config.credencial) ou, vazia, a mesma do grupo de suporte
 * (settings.support_group) — o token fica só no servidor.
 */

export interface Credencial {
  apiId: string;
  token: string;
  baseUrl: string;
}

export interface TicketNx {
  id: number;
  status: string;
  userId: number | null;
  username: string | null;
  queueId: number | null;
  queue: string | null;
  isGroup: boolean;
  name: string;
  contactId: number | null;
  numero: string | null;
  lastMessage: string;
  lastMessageAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  whatsappId: number | null;
  canal: string | null;
}

export async function resolverCredencial(cfg: ConfigMonitor): Promise<Credencial | null> {
  if (cfg.credencial.apiId && cfg.credencial.token) {
    return {
      apiId: cfg.credencial.apiId,
      token: cfg.credencial.token,
      baseUrl: (cfg.credencial.baseUrl || 'https://appapi.nxsystems.com.br').replace(/\/$/, ''),
    };
  }
  const row = await queryOne<{ support_group: Record<string, unknown> | null }>('SELECT support_group FROM settings WHERE id = true');
  const g = (row?.support_group ?? {}) as Record<string, unknown>;
  const apiId = String(g.apiId ?? '').trim();
  const token = String(g.token ?? '').trim();
  if (!apiId || !token) return null;
  return { apiId, token, baseUrl: String(g.baseUrl || 'https://appapi.nxsystems.com.br').replace(/\/$/, '') };
}

export class ErroNx extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

async function chamar<T = unknown>(cred: Credencial, metodo: 'GET' | 'POST', caminho: string, corpo?: unknown, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const url = `${cred.baseUrl}/v2/api/external/${encodeURIComponent(cred.apiId)}/${caminho}`;
  try {
    const resp = await fetch(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${cred.token}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) throw new ErroNx(`NX ${resp.status} em ${caminho.split('?')[0]}: ${txt.slice(0, 200)}`, resp.status);
    try {
      return (txt ? JSON.parse(txt) : {}) as T;
    } catch {
      throw new ErroNx(`NX respondeu algo que não é JSON em ${caminho.split('?')[0]}`);
    }
  } catch (err) {
    if (err instanceof ErroNx) throw err;
    const abortou = err instanceof Error && err.name === 'AbortError';
    throw new ErroNx(abortou ? `timeout em ${caminho.split('?')[0]}` : String(err).slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
}

const numOuNull = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};
const msOuNull = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
  const p = Date.parse(String(v));
  return Number.isFinite(p) ? p : null;
};

export function lerTicket(t: Record<string, any>): TicketNx | null {
  const id = numOuNull(t?.id);
  if (!id) return null;
  const contato = (t.contact ?? {}) as Record<string, any>;
  return {
    id,
    status: String(t.status ?? 'open'),
    userId: numOuNull(t.userId),
    username: (t.username ?? t.user?.name ?? null) as string | null,
    queueId: numOuNull(t.queueId),
    queue: typeof t.queue === 'string' ? t.queue : (t.queue?.queue ?? t.queue?.name ?? null),
    isGroup: t.isGroup === true,
    name: String(t.name ?? contato.name ?? t.contactName ?? ''),
    contactId: numOuNull(t.contactId),
    numero: (contato.number ?? t.number ?? null) as string | null,
    lastMessage: String(t.lastMessage ?? ''),
    lastMessageAt: msOuNull(t.lastMessageAt),
    createdAt: msOuNull(t.createdAt),
    updatedAt: msOuNull(t.updatedAt),
    whatsappId: numOuNull(t.whatsappId),
    canal: (t.channel ?? null) as string | null,
  };
}

function listaDe(resp: unknown, chaves: string[]): Record<string, any>[] {
  if (Array.isArray(resp)) return resp;
  const r = (resp ?? {}) as Record<string, any>;
  for (const k of chaves) if (Array.isArray(r[k])) return r[k];
  if (r.data && typeof r.data === 'object') return listaDe(r.data, chaves);
  return [];
}

/** Todos os tickets de um status (paginando; trava em 30 páginas). */
export async function listarTickets(cred: Credencial, status: 'open' | 'pending'): Promise<TicketNx[]> {
  const out: TicketNx[] = [];
  const vistos = new Set<number>();
  for (let pagina = 1; pagina <= 30; pagina++) {
    const resp = await chamar<Record<string, any>>(cred, 'GET', `listTickets?pageNumber=${pagina}&status=${status}`);
    const itens = listaDe(resp, ['tickets', 'rows']);
    let novos = 0;
    for (const bruto of itens) {
      const t = lerTicket(bruto);
      if (!t || vistos.has(t.id)) continue;
      // Algumas versões ignoram o filtro; garante o status pedido.
      if (t.status !== status) continue;
      vistos.add(t.id);
      out.push(t);
      novos++;
    }
    const temMais = (resp as any)?.hasMore;
    if (!itens.length || novos === 0 || temMais === false) break;
  }
  return out;
}

/** Mensagens cruas do ticket (inclui as de sistema; quem filtra é lerMensagem). */
export async function mensagensDoTicket(cred: Credencial, ticketId: number): Promise<{ mensagens: Record<string, any>[]; numero: string | null }> {
  const resp = await chamar<Record<string, any>>(cred, 'POST', 'showAllMessages', { ticket: String(ticketId) }, 30_000);
  const mensagens = listaDe(resp, ['messages', 'mensagens', 'rows']);
  let numero: string | null = null;
  for (const m of mensagens) {
    const n = m?.contact?.number;
    if (n) {
      numero = String(n);
      break;
    }
  }
  return { mensagens, numero };
}

export async function criarNota(cred: Credencial, ticketId: number, notas: string, idFront?: string) {
  return chamar(cred, 'POST', 'createNotes', { ticketId, notes: notas, ...(idFront ? { idFront } : {}) });
}

export async function enviarNoTicket(cred: Credencial, ticketId: number, body: string, opcoes: { fechar?: boolean; externalKey?: string } = {}) {
  return chamar(cred, 'POST', 'sendMessageByTicket', {
    ticketId,
    body,
    externalKey: opcoes.externalKey ?? '',
    reopen: false,
    isClosed: !!opcoes.fechar,
  });
}

export async function atualizarTicket(
  cred: Credencial,
  ticketId: number,
  dados: { status?: 'open' | 'pending' | 'closed'; userId?: number | null; queueId?: number | null },
) {
  return chamar(cred, 'POST', 'updateticketinfo', { ticketId, ...dados });
}

export interface UsuarioNx {
  id: number;
  name: string;
  email: string | null;
  profile: string | null;
}

export async function listarUsuarios(cred: Credencial): Promise<UsuarioNx[]> {
  const out: UsuarioNx[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const resp = await chamar<Record<string, any>>(cred, 'GET', `listUsers?pageNumber=${pagina}`);
    const itens = listaDe(resp, ['users', 'usuarios', 'rows']);
    for (const u of itens) {
      const id = numOuNull(u?.id);
      if (id) out.push({ id, name: String(u.name ?? `#${id}`), email: (u.email ?? null) as string | null, profile: (u.profile ?? null) as string | null });
    }
    if (!itens.length || (resp as any)?.hasMore === false || itens.length < 10) break;
  }
  return out;
}

export interface FilaNx {
  id: number;
  nome: string;
}

export async function listarFilas(cred: Credencial): Promise<FilaNx[]> {
  const resp = await chamar<unknown>(cred, 'GET', 'listQueues');
  return listaDe(resp, ['queues', 'filas', 'rows'])
    .map((q) => ({ id: Number(q?.id), nome: String(q?.queue ?? q?.name ?? `Fila ${q?.id}`) }))
    .filter((q) => Number.isFinite(q.id) && q.id > 0);
}
