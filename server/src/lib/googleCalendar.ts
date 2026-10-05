import { createSign } from 'crypto';
import { randomUUID } from 'crypto';

/**
 * Integração com a Agenda do Google via conta de serviço (Service Account) com
 * delegação de domínio (Google Workspace) — sem OAuth interativo: a conta de
 * serviço "se passa" por um e-mail do domínio (GOOGLE_CALENDAR_IMPERSONATE_EMAIL)
 * e lê/escreve na agenda dele (GOOGLE_CALENDAR_ID, default "primary" = a agenda
 * principal desse e-mail). Todo o time (Comercial e Suporte) usa essa MESMA
 * agenda — é o que fica por trás da tela /agenda do painel.
 *
 * Sem SDK (googleapis): assina o JWT na mão com `crypto` (RS256) e troca por um
 * access_token OAuth2, igual ao resto do server (fetch cru, sem SDK pesado) —
 * ver officialApi.ts / channels.ts pro mesmo estilo.
 *
 * Setup necessário (uma vez, feito por quem tem acesso ao Google Workspace):
 *   1. Google Cloud Console: cria um projeto, ativa a "Google Calendar API".
 *   2. Cria uma Service Account nesse projeto, gera uma chave JSON.
 *   3. Google Admin Console (admin.google.com) → Segurança → Controles de API →
 *      Delegação em todo o domínio → adiciona o "Client ID" da service account
 *      com o escopo https://www.googleapis.com/auth/calendar
 *   4. Preenche no .env do servidor:
 *        GOOGLE_SERVICE_ACCOUNT_EMAIL = client_email da chave JSON
 *        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = private_key da chave JSON (com \n)
 *        GOOGLE_CALENDAR_IMPERSONATE_EMAIL = e-mail do Workspace cuja agenda
 *          vai ser usada como a agenda compartilhada (ex.: agenda@suaempresa.com.br)
 *        GOOGLE_CALENDAR_ID (opcional, default "primary")
 */

const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
const PRIVATE_KEY = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const IMPERSONATE_EMAIL = process.env.GOOGLE_CALENDAR_IMPERSONATE_EMAIL ?? '';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

// Horário comercial em que os horários livres são sugeridos — fora disso não
// aparece como opção (mas uma reunião já existente fora dessa janela continua
// listada normalmente na agenda).
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 18;
const SLOT_STEP_MIN = 30;
// Brasil não tem mais horário de verão desde 2019 — deslocamento fixo é seguro.
const SP_OFFSET = '-03:00';

export type MeetingType = 'comercial' | 'suporte';

export interface CalendarEvent {
  id: string;
  tipo: MeetingType | null;
  title: string;
  clienteNome: string | null;
  clienteId: string | null;
  responsavel: string | null;
  start: string;
  end: string;
  meetLink: string | null;
  htmlLink: string | null;
}

export interface CreateMeetingInput {
  tipo: MeetingType;
  clienteId?: string | null;
  clienteNome: string;
  responsavel: string;
  start: string;
  end: string;
  obs?: string;
}

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(SERVICE_ACCOUNT_EMAIL && PRIVATE_KEY && IMPERSONATE_EMAIL);
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signAssertion(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: SERVICE_ACCOUNT_EMAIL,
      sub: IMPERSONATE_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(PRIVATE_KEY, 'base64');
  const sig = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${signingInput}.${sig}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.token;
  const assertion = signAssertion();
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = (await resp.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!resp.ok || !body.access_token) {
    throw new Error(`Falha ao autenticar com o Google (${resp.status}): ${body.error_description || body.error || 'erro desconhecido'}`);
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

async function calendarFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const token = await getAccessToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await resp.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!resp.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${resp.status}`;
    throw new Error(`Google Calendar: ${msg}`);
  }
  return body;
}

function normalizeEvent(raw: Record<string, unknown>): CalendarEvent | null {
  // Ignora eventos cancelados e os "sem horário" (dia inteiro, sem start.dateTime).
  if (raw.status === 'cancelled') return null;
  const start = raw.start as Record<string, unknown> | undefined;
  const end = raw.end as Record<string, unknown> | undefined;
  const startISO = (start?.dateTime as string) ?? null;
  const endISO = (end?.dateTime as string) ?? null;
  if (!startISO || !endISO) return null;

  const ext = ((raw.extendedProperties as Record<string, unknown> | undefined)?.private ?? {}) as Record<string, unknown>;
  const tipo = (ext.tipo as MeetingType | undefined) ?? null;
  const conferenceEntryPoints = (raw.conferenceData as Record<string, unknown> | undefined)?.entryPoints as
    | Record<string, unknown>[]
    | undefined;
  const meetLink =
    (raw.hangoutLink as string | undefined) ??
    conferenceEntryPoints?.find((e) => e.entryPointType === 'video')?.uri as string | undefined ??
    null;

  return {
    id: String(raw.id ?? ''),
    tipo,
    title: String(raw.summary ?? '(sem título)'),
    clienteNome: (ext.clienteNome as string | undefined) ?? null,
    clienteId: (ext.clienteId as string | undefined) || null,
    responsavel: (ext.responsavel as string | undefined) ?? null,
    start: startISO,
    end: endISO,
    meetLink,
    htmlLink: (raw.htmlLink as string | undefined) ?? null,
  };
}

export async function listCalendarEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });
  const body = (await calendarFetch(`/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`)) as {
    items?: Record<string, unknown>[];
  };
  return (body.items ?? []).map(normalizeEvent).filter((e): e is CalendarEvent => e !== null);
}

export async function createCalendarEvent(input: CreateMeetingInput): Promise<CalendarEvent> {
  const tipoLabel = input.tipo === 'comercial' ? 'Comercial' : 'Suporte';
  const descricaoLinhas = [
    `Tipo: ${tipoLabel}`,
    `Cliente: ${input.clienteNome}`,
    `Responsável: ${input.responsavel}`,
  ];
  if (input.obs?.trim()) descricaoLinhas.push('', input.obs.trim());

  const requestBody = {
    summary: `[${tipoLabel}] ${input.clienteNome}`,
    description: descricaoLinhas.join('\n'),
    start: { dateTime: input.start, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: input.end, timeZone: 'America/Sao_Paulo' },
    conferenceData: {
      createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    extendedProperties: {
      private: {
        origem: 'superadmin',
        tipo: input.tipo,
        clienteId: input.clienteId ?? '',
        clienteNome: input.clienteNome,
        responsavel: input.responsavel,
      },
    },
  };

  const body = (await calendarFetch(
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?conferenceDataVersion=1`,
    { method: 'POST', body: JSON.stringify(requestBody) },
  )) as Record<string, unknown>;
  const event = normalizeEvent(body);
  if (!event) throw new Error('Google Calendar retornou um evento inesperado');
  return event;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const token = await getAccessToken();
  const resp = await fetch(`${API_BASE}/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 410 Gone = já tinha sido excluído antes (ex.: clique duplo) — trata como sucesso.
  if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
    throw new Error(`Google Calendar: falha ao excluir (HTTP ${resp.status})`);
  }
}

export interface FreeSlot {
  start: string;
  end: string;
}

/** Horários livres de `dateStr` (YYYY-MM-DD) dentro do horário comercial, para uma reunião de `durationMin` minutos. */
export async function getFreeSlots(dateStr: string, durationMin: number): Promise<FreeSlot[]> {
  const windowStart = new Date(`${dateStr}T${String(WORK_START_HOUR).padStart(2, '0')}:00:00${SP_OFFSET}`);
  const windowEnd = new Date(`${dateStr}T${String(WORK_END_HOUR).padStart(2, '0')}:00:00${SP_OFFSET}`);

  const fb = (await calendarFetch('/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      items: [{ id: CALENDAR_ID }],
    }),
  })) as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
  const busy = (fb.calendars?.[CALENDAR_ID]?.busy ?? []).map((b) => ({
    start: new Date(b.start).getTime(),
    end: new Date(b.end).getTime(),
  }));

  const durationMs = durationMin * 60_000;
  const stepMs = SLOT_STEP_MIN * 60_000;
  const now = Date.now();
  const slots: FreeSlot[] = [];
  for (let t = windowStart.getTime(); t + durationMs <= windowEnd.getTime(); t += stepMs) {
    if (t < now) continue; // não sugere horário que já passou
    const slotEnd = t + durationMs;
    const overlaps = busy.some((b) => t < b.end && slotEnd > b.start);
    if (!overlaps) slots.push({ start: new Date(t).toISOString(), end: new Date(slotEnd).toISOString() });
  }
  return slots;
}
