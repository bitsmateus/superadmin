import { queryOne } from '../db.js';

export interface GroupSendResult {
  ok: boolean;
  status?: number;
  detail?: string;
  reason?: 'empty' | 'not_configured';
}

/**
 * Envia uma mensagem de texto ao grupo de WhatsApp configurado em settings.
 * O token fica só no servidor (lido aqui), nunca trafega pelo front.
 */
export async function sendSupportGroupMessage(text: string): Promise<GroupSendResult> {
  return sendToSupportGroupId('', text);
}

/**
 * Envia uma mensagem de texto a um grupo de WhatsApp usando a credencial do
 * grupo de SUPORTE (mesmo apiId/token/baseUrl). Se `groupId` vier vazio, usa o
 * grupo configurado em settings.support_group.groupId.
 *
 * Útil para mandar uma cópia dos avisos para um grupo extra pelo mesmo número
 * que envia os avisos de suporte.
 */
export async function sendToSupportGroupId(groupId: string, text: string): Promise<GroupSendResult> {
  const t = (text ?? '').trim();
  if (!t) return { ok: false, reason: 'empty' };

  const row = await queryOne<{ support_group: Record<string, unknown> | null }>(
    'SELECT support_group FROM settings WHERE id = true'
  );
  const g = (row?.support_group ?? {}) as Record<string, unknown>;
  const apiId = (g.apiId as string) || '';
  const token = (g.token as string) || '';
  const target = (groupId || '').trim() || (g.groupId as string) || '';
  const base = ((g.baseUrl as string) || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');
  if (!apiId || !token || !target) return { ok: false, reason: 'not_configured' };

  return sendToGroupWith({ apiId, token, baseUrl: base }, target, t, 'support-alert');
}

/** Envia um texto a um grupo de WhatsApp por uma conexão da NX Systems (apiId + token). Usado pelos avisos do suporte
 * e por quem tem conexão própria (ex.: o resumo do grupo LEADS, que sai pelo mesmo número dos avisos de lead novo). */
export async function sendToGroupWith(
  conexao: { apiId: string; token: string; baseUrl?: string },
  groupId: string,
  text: string,
  externalKey: string
): Promise<GroupSendResult> {
  const t = (text ?? '').trim();
  if (!t) return { ok: false, reason: 'empty' };
  const { apiId, token } = conexao;
  const target = (groupId || '').trim();
  const base = (conexao.baseUrl || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');
  if (!apiId || !token || !target) return { ok: false, reason: 'not_configured' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const resp = await fetch(`${base}/v2/api/external/${encodeURIComponent(apiId)}/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: t, number: target, externalKey, isClosed: false }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail: d.slice(0, 300) };
    }
    return { ok: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, detail: aborted ? 'timeout (15s)' : String(err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/** Texto para um NÚMERO por uma conexão da NX própria (apiId + token) — ex.: os avisos de garantia
 * da Enge Services, que saem pelo WhatsApp da própria Enge. A NX às vezes responde 200 com
 * `success: false`; isso também conta como falha. */
export async function sendTextWith(
  conexao: { apiId: string; token: string; baseUrl?: string },
  number: string,
  text: string,
  externalKey: string,
  isClosed = false
): Promise<GroupSendResult> {
  const t = (text ?? '').trim();
  const num = normalizeNumber(number);
  if (!t) return { ok: false, reason: 'empty' };
  if (!conexao.apiId || !conexao.token || !num) return { ok: false, reason: 'not_configured' };
  const base = (conexao.baseUrl || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const resp = await fetch(`${base}/v2/api/external/${encodeURIComponent(conexao.apiId)}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conexao.token}` },
      body: JSON.stringify({ body: t, number: num, externalKey, isClosed }),
      signal: ctrl.signal,
    });
    const raw = await resp.text().catch(() => '');
    let falhou = !resp.ok;
    try {
      if ((JSON.parse(raw) as { success?: boolean })?.success === false) falhou = true;
    } catch {
      /* resposta sem JSON */
    }
    if (falhou) return { ok: false, status: resp.status, detail: raw.slice(0, 300) || '(resposta vazia)' };
    return { ok: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, detail: aborted ? 'timeout (20s)' : String(err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/** Normaliza um número para o formato esperado (55 + DDD + número, só dígitos). */
export function normalizeNumber(n: string): string {
  let digits = (n ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}

/**
 * Envia uma mensagem a um NÚMERO pessoal (não grupo), reusando as credenciais
 * do grupo de suporte (apiId/token/baseUrl). POST em /v2/api/external/{apiId}/.
 */
export async function sendWhatsAppToNumber(number: string, text: string): Promise<GroupSendResult> {
  const t = (text ?? '').trim();
  const num = normalizeNumber(number);
  if (!t) return { ok: false, reason: 'empty' };
  if (!num) return { ok: false, reason: 'not_configured' };

  const row = await queryOne<{ support_group: Record<string, unknown> | null }>(
    'SELECT support_group FROM settings WHERE id = true'
  );
  const g = (row?.support_group ?? {}) as Record<string, unknown>;
  const apiId = (g.apiId as string) || '';
  const token = (g.token as string) || '';
  const base = ((g.baseUrl as string) || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');
  if (!apiId || !token) return { ok: false, reason: 'not_configured' };

  try {
    const resp = await fetch(`${base}/v2/api/external/${encodeURIComponent(apiId)}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: t, number: num, externalKey: 'briefing', isClosed: false }),
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail: d.slice(0, 300) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 300) };
  }
}
