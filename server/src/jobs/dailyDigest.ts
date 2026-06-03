import { query, queryOne } from '../db.js';
import { sendSupportGroupMessage } from '../lib/supportGroup.js';

const TZ = 'America/Sao_Paulo';
const SEND_HOUR = 7; // 07h
const WINDOW_MIN = 9; // janela 07:00–07:09 (interval de 1 min)

// ── Helpers de data no fuso de São Paulo ──────────────────────────────────────
function spDateStr(d: Date): string {
  // en-CA => YYYY-MM-DD (ordenável)
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
function clampHour(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}
function spTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

type ReminderRow = { title: string; due_at: string | null; company: string | null; resp: string | null };
type FollowUp = { dayNumber?: number; scheduledFor?: string; sentAt?: string };
type ClientRow = {
  company: string | null;
  name: string;
  stage: string;
  briefing_status: string | null;
  delivery_date: string | null;
  followup_active: boolean | null;
  followups: FollowUp[] | null;
};

async function buildDigest(): Promise<string> {
  const now = new Date();
  const todayStr = spDateStr(now);
  const weekEndStr = spDateStr(new Date(now.getTime() + 7 * 86400000));

  const reminders = await query<ReminderRow>(
    `SELECT r.title,
            r.due_at,
            COALESCE(NULLIF(c.company, ''), c.name) AS company,
            p.name AS resp
     FROM reminders r
     LEFT JOIN clients c ON c.id = r.client_id
     LEFT JOIN profiles p ON p.id = r.user_id
     WHERE r.completed_at IS NULL`
  );

  const overdue: ReminderRow[] = [];
  const today: ReminderRow[] = [];
  const week: ReminderRow[] = [];
  for (const r of reminders) {
    if (!r.due_at) continue; // backlog sem data fica de fora do digest
    const dStr = spDateStr(new Date(r.due_at));
    if (dStr < todayStr) overdue.push(r);
    else if (dStr === todayStr) today.push(r);
    else if (dStr <= weekEndStr) week.push(r);
  }
  const byDue = (a: ReminderRow, b: ReminderRow) =>
    new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime();
  overdue.sort(byDue);
  today.sort(byDue);
  week.sort(byDue);

  const rLine = (r: ReminderRow) =>
    `• ${r.title}${r.company ? ` — ${r.company}` : ''}${r.resp ? ` (${r.resp})` : ''}`;
  const rLineTime = (r: ReminderRow) =>
    `• ${spTime(r.due_at!)} — ${r.title}${r.company ? ` — ${r.company}` : ''}${r.resp ? ` (${r.resp})` : ''}`;

  // ── Demandas do pipeline ──
  const clients = await query<ClientRow>(
    `SELECT company, name, stage, briefing_status, delivery_date, followup_active, followups
     FROM clients
     WHERE stage <> 'churned'`
  );
  const nowMs = now.getTime();
  const pipeline: string[] = [];
  const followLines: string[] = [];
  for (const c of clients) {
    const co = (c.company && c.company.trim()) || c.name;
    if (c.briefing_status === 'sent') {
      pipeline.push(`• Aguardando preenchimento do briefing — ${co} (enviar mensagem)`);
    } else if (
      c.briefing_status === 'filled' &&
      !['setup', 'delivery', 'active'].includes(c.stage)
    ) {
      pipeline.push(`• Briefing preenchido — iniciar configuração — ${co}`);
    } else if (c.stage === 'setup') {
      pipeline.push(`• Em configuração — ${co}`);
    } else if (c.stage === 'delivery' && c.delivery_date && spDateStr(new Date(c.delivery_date)) === todayStr) {
      pipeline.push(`• Reunião de entrega hoje — ${co}`);
    }

    // Follow-ups vencidos (cliente ativo com mensagem agendada não enviada).
    if (c.followup_active && c.stage === 'active' && Array.isArray(c.followups)) {
      for (const f of c.followups) {
        if (!f.sentAt && f.scheduledFor && new Date(f.scheduledFor).getTime() <= nowMs) {
          followLines.push(`• Follow-up dia ${f.dayNumber ?? '?'} pendente — ${co}`);
        }
      }
    }
  }

  const out: string[] = [`☀️ *Bom dia! Demandas do suporte — ${todayStr.split('-').reverse().join('/')}*`];
  if (overdue.length) out.push('', `🔴 *Vencidas (${overdue.length})*`, ...overdue.map(rLine));
  if (today.length) out.push('', `⭐ *Para hoje (${today.length})*`, ...today.map(rLineTime));
  if (week.length) out.push('', `📅 *Próximos dias (${week.length})*`, ...week.map(rLineTime));
  if (pipeline.length) out.push('', `🔧 *Pipeline (${pipeline.length})*`, ...pipeline.slice(0, 20));
  if (followLines.length) out.push('', `💬 *Follow-ups vencidos (${followLines.length})*`, ...followLines.slice(0, 20));
  if (!overdue.length && !today.length && !week.length && !pipeline.length && !followLines.length) {
    out.push('', 'Nenhuma demanda pendente. Bom dia de trabalho! ✅');
  }
  return out.join('\n');
}

let ticking = false;

/** Inicia o agendador do digest diário (checa a cada minuto). */
export function startDailyDigest(): void {
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

      const sendHour = clampHour(g.digestHour, SEND_HOUR);
      const { hour, minute } = spHourMin(now);
      if (hour !== sendHour || minute > WINDOW_MIN) return;
      if ((g.lastDigestDate as string) === todayStr) return; // já enviou hoje

      const text = await buildDigest();
      const res = await sendSupportGroupMessage(text);
      if (res.ok) {
        await query(
          `UPDATE settings
           SET support_group = jsonb_set(COALESCE(support_group, '{}'::jsonb), '{lastDigestDate}', to_jsonb($1::text))
           WHERE id = true`,
          [todayStr]
        );
        console.log('[digest] enviado', todayStr);
      } else {
        console.warn('[digest] falha ao enviar', res);
      }
    } catch (err) {
      console.error('[digest] erro', err);
    } finally {
      ticking = false;
    }
  }, 60_000);
  console.log('[digest] agendador diário ativo (horário configurável, America/Sao_Paulo)');
}
