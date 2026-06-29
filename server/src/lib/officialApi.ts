import { normalizeNumber } from './supportGroup.js';

/**
 * Envio via API OFICIAL do WhatsApp (templates), usado SOMENTE para os avisos
 * de canal: desconectado / reconectado / teste. Os demais avisos do sistema
 * continuam pelo envio normal (sendWhatsAppToNumber / grupo de suporte).
 *
 * Config por env (token nunca vai pro navegador):
 *   OFFICIAL_API_URL   = https://appapi.nxsystems.com.br/v2/api/external/<apiId>
 *   OFFICIAL_API_TOKEN = <token>
 *   OFFICIAL_TUTORIAL_URL (opcional) = link de tutorial do template desconectado
 */

export interface OfficialResult {
  ok: boolean;
  status?: number;
  detail?: string;
  reason?: 'not_configured' | 'empty';
}

export const TUTORIAL_URL =
  process.env.OFFICIAL_TUTORIAL_URL || 'https://ajuda.nxsystems.com.br/';

/** Data/hora curta no fuso de São Paulo: "25/06 16:30". */
export function spDateTimeShort(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')} ${get('hour')}:${get('minute')}`;
}

/**
 * Envia um template oficial para um número. `params` são os valores das
 * variáveis {{1}}, {{2}}... do corpo (na ordem). Template sem variável → params [].
 */
export async function sendOfficialTemplate(
  number: string,
  templateName: string,
  params: string[] = [],
  langCode = 'pt_BR',
): Promise<OfficialResult> {
  const rawUrl = (process.env.OFFICIAL_API_URL || '').trim();
  const token = (process.env.OFFICIAL_API_TOKEN || '').trim();
  if (!rawUrl || !token) return { ok: false, reason: 'not_configured' };

  // O endpoint correto é .../external/{ApiID}/templateBody. Aceita a env com ou
  // sem o sufixo: se vier só a base, anexa /templateBody.
  const base = rawUrl.replace(/\/+$/, '');
  const url = /\/templateBody$/.test(base) ? base : `${base}/templateBody`;

  const to = normalizeNumber(number);
  if (!to) return { ok: false, reason: 'empty' };

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: langCode },
  };
  if (params.length > 0) {
    template.components = [
      { type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text ?? '') })) },
    ];
  }

  const body = {
    number: to,
    isClosed: false,
    templateData: {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail: d.slice(0, 300) };
    }
    return { ok: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, detail: aborted ? 'timeout (15s) — URL da API Oficial inacessível pelo servidor' : String(err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}
