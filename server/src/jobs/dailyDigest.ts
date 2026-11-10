import { query, queryOne } from '../db.js';
import { sendSupportGroupMessage, sendWhatsAppToNumber } from '../lib/supportGroup.js';

const APP_URL = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
const BRIEFING_REMINDER_HOURS = [9, 15]; // cobranças de preenchimento

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

/** Etapas antes da configuração: o briefing ainda é a pendência. Da configuração em diante, não é mais. */
const ETAPAS_ANTES_DA_CONFIGURACAO = ['lead', 'welcome', 'contract', 'briefing'];
const ETAPAS_EM_CONFIGURACAO = ['setup_start', 'setup'];
const MAX_LINHAS = 20;

/** Dia (AAAA-MM-DD, em São Paulo) da data da entrega. Gravada como "AAAA-MM-DDTHH:MM" no horário de Brasília (sem
 * fuso): o dia é o começo do texto. Com fuso (ISO), converte. */
function diaDaEntrega(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : spDateStr(d);
}

/** Lista com no máximo MAX_LINHAS linhas; o resto vira "+N outros". */
function limitar(linhas: string[]): string[] {
  return linhas.length > MAX_LINHAS ? [...linhas.slice(0, MAX_LINHAS), `• _+${linhas.length - MAX_LINHAS} outros_`] : linhas;
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

async function buildDigest(titulo = 'Bom dia! Demandas do suporte'): Promise<string> {
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
     WHERE r.completed_at IS NULL
       -- Tarefa de cliente cancelado ou arquivado não é mais demanda do dia.
       AND (r.client_id IS NULL OR (c.archived_at IS NULL AND c.stage <> 'churned'))`
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

  // Vencida diz de quando é: "venceu 07/11" ajuda a ver o que está parado há mais tempo.
  const rLine = (r: ReminderRow) =>
    `• ${r.title}${r.company ? ` — ${r.company}` : ''}${r.resp ? ` (${r.resp})` : ''} · venceu ${spDateStr(new Date(r.due_at!)).slice(5).split('-').reverse().join('/')}`;
  const rLineTime = (r: ReminderRow) =>
    `• ${spTime(r.due_at!)} — ${r.title}${r.company ? ` — ${r.company}` : ''}${r.resp ? ` (${r.resp})` : ''}`;

  // ── Demandas do pipeline ──
  const clients = await query<ClientRow>(
    `SELECT company, name, stage, briefing_status, delivery_date, followup_active, followups
     FROM clients
     WHERE stage <> 'churned' AND archived_at IS NULL`
  );
  const nowMs = now.getTime();
  const pipeline: string[] = [];
  const followLines: string[] = [];
  for (const c of clients) {
    const co = (c.company && c.company.trim()) || c.name;
    // O briefing só é pendência antes da configuração: cliente que já passou dela (com o status do briefing
    // esquecido em "enviado") não volta a aparecer como "aguardando briefing".
    const antesDaConfiguracao = ETAPAS_ANTES_DA_CONFIGURACAO.includes(c.stage);
    if (antesDaConfiguracao && c.briefing_status === 'sent') {
      pipeline.push(`• Aguardando preenchimento do briefing — ${co} (enviar mensagem)`);
    } else if (antesDaConfiguracao && (c.briefing_status === 'filled' || c.briefing_status === 'approved')) {
      pipeline.push(`• Briefing preenchido — iniciar configuração — ${co}`);
    } else if (ETAPAS_EM_CONFIGURACAO.includes(c.stage)) {
      pipeline.push(`• Em configuração — ${co}`);
    } else if (c.stage === 'setup_done') {
      pipeline.push(`• Configuração pronta — marcar a entrega — ${co}`);
    } else if (c.stage === 'delivery' && c.delivery_date && diaDaEntrega(c.delivery_date) === todayStr) {
      pipeline.push(`• Reunião de entrega hoje — ${co}`);
    }

    // Follow-ups vencidos (cliente ativo ou em Entregas Recentes com mensagem
    // agendada não enviada).
    if (
      c.followup_active &&
      (c.stage === 'active' || c.stage === 'delivered') &&
      Array.isArray(c.followups)
    ) {
      for (const f of c.followups) {
        if (!f.sentAt && f.scheduledFor && new Date(f.scheduledFor).getTime() <= nowMs) {
          followLines.push(`• Follow-up dia ${f.dayNumber ?? '?'} pendente — ${co}`);
        }
      }
    }
  }

  const out: string[] = [`☀️ *${titulo} — ${todayStr.split('-').reverse().join('/')}*`];
  if (overdue.length) out.push('', `🔴 *Vencidas (${overdue.length})*`, ...limitar(overdue.map(rLine)));
  if (today.length) out.push('', `⭐ *Para hoje (${today.length})*`, ...limitar(today.map(rLineTime)));
  if (week.length) out.push('', `📅 *Próximos dias (${week.length})*`, ...limitar(week.map(rLineTime)));
  if (pipeline.length) out.push('', `🔧 *Pipeline (${pipeline.length})*`, ...limitar(pipeline));
  if (followLines.length) out.push('', `💬 *Follow-ups vencidos (${followLines.length})*`, ...limitar(followLines));
  if (!overdue.length && !today.length && !week.length && !pipeline.length && !followLines.length) {
    out.push('', 'Nenhuma demanda pendente. Bom dia de trabalho! ✅');
  }
  return out.join('\n');
}

type BriefPendingRow = { briefing_number: string | null; briefing_token: string | null; company: string | null; name: string };

/** Cobra (9h/15h) o preenchimento do briefing no WhatsApp do cliente. */
async function maybeRunBriefingReminders(now: Date): Promise<void> {
  const { hour, minute } = spHourMin(now);
  if (!BRIEFING_REMINDER_HOURS.includes(hour) || minute > WINDOW_MIN) return;

  const todayStr = spDateStr(now);
  const slotKey = `${todayStr}-${hour}`;
  const row = await queryOne<{ support_group: Record<string, unknown> | null }>(
    'SELECT support_group FROM settings WHERE id = true'
  );
  const g = (row?.support_group ?? {}) as Record<string, unknown>;
  if (!g.apiId || !g.token) return; // sem credenciais
  if ((g.briefRemind as string) === slotKey) return; // já cobrou neste slot

  const pending = await query<BriefPendingRow>(
    `SELECT briefing_number, briefing_token, company, name
     FROM clients
     WHERE briefing_status = 'sent'
       AND briefing_number IS NOT NULL AND briefing_number <> ''
       AND archived_at IS NULL
       -- Cliente que já passou pra configuração não recebe mais cobrança de briefing (status esquecido em "enviado").
       AND stage = ANY($1)`,
    [ETAPAS_ANTES_DA_CONFIGURACAO]
  );

  let sent = 0;
  for (const c of pending) {
    if (!c.briefing_number) continue;
    const link = APP_URL && c.briefing_token ? `${APP_URL}/briefing/${c.briefing_token}` : '';
    const co = (c.company && c.company.trim()) || c.name;
    const msg =
      `Olá! 👋 Passando para lembrar que ainda falta preencher o briefing de onboarding da ${co}.` +
      (link ? `\n\n👉 ${link}` : '') +
      `\n\nAssim que preencher, seguimos com a configuração. Qualquer dúvida, é só chamar! 😊`;
    const res = await sendWhatsAppToNumber(c.briefing_number, msg);
    if (res.ok) sent++;
  }

  await query(
    `UPDATE settings
     SET support_group = jsonb_set(COALESCE(support_group, '{}'::jsonb), '{briefRemind}', to_jsonb($1::text))
     WHERE id = true`,
    [slotKey]
  );
  if (sent > 0) console.log(`[briefing] cobranças enviadas (${slotKey}):`, sent);
}

/**
 * Uma vez só (traffic_report_log): na primeira subida com o resumo corrigido (Pipeline sem cliente que já passou do
 * briefing, sem tarefa de cliente cancelado), manda o resumo de agora no grupo. Fora de 7h–21h não manda (o das 7h
 * já vem certo).
 */
async function reenviarResumoCorrigido(): Promise<void> {
  try {
    const row = await queryOne<{ support_group: Record<string, unknown> | null }>('SELECT support_group FROM settings WHERE id = true');
    const g = (row?.support_group ?? {}) as Record<string, unknown>;
    if (!g.apiId || !g.token || !g.groupId || g.digestEnabled === false) return;
    const reservou = await query(
      `INSERT INTO traffic_report_log (dia, kind) VALUES ('2026-11-10'::date, 'digest_corrigido') ON CONFLICT DO NOTHING RETURNING dia`
    );
    if (!reservou.length) return;
    const { hour } = spHourMin(new Date());
    if (hour < 7 || hour > 21) return;
    const res = await sendSupportGroupMessage(await buildDigest('Demandas do suporte (corrigido)'));
    if (!res.ok) console.warn('[digest] falha ao reenviar o resumo corrigido', res);
  } catch (err) {
    console.error('[digest] erro ao reenviar o resumo corrigido', err);
  }
}

let ticking = false;

/** Inicia o agendador do digest diário (checa a cada minuto). */
export function startDailyDigest(): void {
  setTimeout(() => void reenviarResumoCorrigido(), 40_000);
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = new Date();

      // Cobranças de preenchimento do briefing (9h/15h).
      await maybeRunBriefingReminders(now);

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
