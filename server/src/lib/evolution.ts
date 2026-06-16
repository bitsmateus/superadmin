import { queryOne } from '../db.js';

export interface EvolutionResult {
  ok: boolean;
  status?: number;
  detail?: string;
  reason?: 'not_configured' | 'empty';
}

/** Lê as credenciais da Evolution salvas em settings (apiKey fica só no servidor). */
async function getEvolutionConfig(): Promise<{ baseUrl: string; apiKey: string } | null> {
  const row = await queryOne<{ evolution: Record<string, unknown> | null }>(
    'SELECT evolution FROM settings WHERE id = true'
  );
  const e = (row?.evolution ?? {}) as Record<string, unknown>;
  const baseUrl = ((e.baseUrl as string) || '').replace(/\/$/, '');
  const apiKey = (e.apiKey as string) || '';
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/**
 * Cria uma instância na Evolution API. instanceName deve ser o mesmo nome usado
 * na sessão do NX (ex.: número só com dígitos, 55+DDD+número), pra "casar" as
 * duas pontas. Idempotente do ponto de vista do app: se já existir, a Evolution
 * costuma devolver 403/409 — tratamos como "já existe".
 */
export async function createEvolutionInstance(
  instanceName: string,
  integration = 'WHATSAPP-BAILEYS'
): Promise<EvolutionResult> {
  const name = (instanceName ?? '').trim();
  if (!name) return { ok: false, reason: 'empty' };

  const cfg = await getEvolutionConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };

  try {
    const resp = await fetch(`${cfg.baseUrl}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.apiKey },
      body: JSON.stringify({ instanceName: name, qrcode: true, integration }),
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      // 403/409 normalmente = instância já existe; consideramos ok (idempotente).
      if (resp.status === 403 || resp.status === 409) {
        return { ok: true, status: resp.status, detail: 'instância já existe' };
      }
      return { ok: false, status: resp.status, detail: d.slice(0, 300) };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 300) };
  }
}
