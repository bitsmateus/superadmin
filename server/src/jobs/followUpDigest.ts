import { query, queryOne } from '../db.js';
import { sendSupportGroupMessage } from '../lib/supportGroup.js';

const TZ = 'America/Sao_Paulo';
const SEND_HOUR = 10; // 10h
const WINDOW_MIN = 9; // janela 10:00–10:09 (interval de 1 min)

function spDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
function spHourMin(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

type FollowUp = { dayNumber?: number; scheduledFor?: string; sentAt?: string };
type ClientRow = {
  company: string | null;
  name: string;
  stage: string;
  followup_active: boolean | null;
  followups: FollowUp[] | null;
};

/** Mesma regra usada no resumo das 7h (ver dailyDigest.ts buildDigest): cliente com follow-up
 *  ativo, em Entregas Recentes ou Ativo, com um item do checklist sem `sentAt` e já vencido. */
async function buildFollowUpMessage(): Promise<string | null> {
  const now = new Date();
  const todayStr = spDateStr(now);
  const nowMs = now.getTime();

  const clients = await query<ClientRow>(
    `SELECT company, name, stage, followup_active, followups
     FROM clients
     WHERE stage IN ('active', 'delivered') AND followup_active = true`
  );

  const lines: string[] = [];
  for (const c of clients) {
    if (!Array.isArray(c.followups)) continue;
    const co = (c.company && c.company.trim()) || c.name;
    for (const f of c.followups) {
      if (!f.sentAt && f.scheduledFor && new Date(f.scheduledFor).getTime() <= nowMs) {
        lines.push(`• ${co} — dia ${f.dayNumber ?? '?'}`);
      }
    }
  }

  if (!lines.length) return null;

  return [
    `📦 *Follow-ups de entrega pendentes — ${todayStr.split('-').reverse().join('/')}*`,
    '',
    ...lines,
    '',
    'Mensagens prontas pra copiar em Suporte → Follow-ups no TenantHub.',
  ].join('\n');
}

let ticking = false;

/** Inicia o agendador do lembrete de follow-up de entrega (todo dia às 10h, checa a cada minuto). */
export function startFollowUpDigest(): void {
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();
      const todayStr = spDateStr(now);
      const row = await queryOne<{ support_group: Record<string, unknown> | null }>(
        'SELECT support_group FROM settings WHERE id = true'
      );
      const g = (row?.support_group ?? {}) as Record<string, unknown>;
      if (!g.apiId || !g.token || !g.groupId) return; // não configurado
      if (g.digestEnabled === false) return; // envio automático desligado

      const { hour, minute } = spHourMin(now);
      if (hour !== SEND_HOUR || minute > WINDOW_MIN) return;
      if ((g.lastFollowUpDigestDate as string) === todayStr) return; // já enviou hoje

      const text = await buildFollowUpMessage();
      if (text) {
        const res = await sendSupportGroupMessage(text);
        if (!res.ok) {
          console.warn('[followup-digest] falha ao enviar', res);
          return; // tenta de novo no próximo minuto dentro da janela
        }
        console.log('[followup-digest] enviado', todayStr);
      }

      await query(
        `UPDATE settings
         SET support_group = jsonb_set(COALESCE(support_group, '{}'::jsonb), '{lastFollowUpDigestDate}', to_jsonb($1::text))
         WHERE id = true`,
        [todayStr]
      );
    } catch (err) {
      console.error('[followup-digest] erro', err);
    } finally {
      ticking = false;
    }
  }, 60_000);
  console.log('[followup-digest] agendador ativo (10h, America/Sao_Paulo)');
}
