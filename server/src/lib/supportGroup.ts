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
  const t = (text ?? '').trim();
  if (!t) return { ok: false, reason: 'empty' };

  const row = await queryOne<{ support_group: Record<string, unknown> | null }>(
    'SELECT support_group FROM settings WHERE id = true'
  );
  const g = (row?.support_group ?? {}) as Record<string, unknown>;
  const apiId = (g.apiId as string) || '';
  const token = (g.token as string) || '';
  const groupId = (g.groupId as string) || '';
  const base = ((g.baseUrl as string) || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');
  if (!apiId || !token || !groupId) return { ok: false, reason: 'not_configured' };

  try {
    const resp = await fetch(`${base}/v2/api/external/${encodeURIComponent(apiId)}/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: t, number: groupId, externalKey: 'support-alert', isClosed: false }),
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
