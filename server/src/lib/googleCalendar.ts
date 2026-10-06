import { randomUUID } from 'crypto';

/**
 * Integração com a Agenda do Google via OAuth2 (refresh token) de UMA conta —
 * a que for usada na autorização única (ver abaixo) vira "a agenda compartilhada"
 * do time (Comercial e Suporte usam a mesma, GOOGLE_CALENDAR_ID, default
 * "primary" = a agenda principal dessa conta).
 *
 * Por que OAuth e não Service Account: muitos projetos novos do Google Cloud
 * vêm com a política `iam.managed.disableServiceAccountKeyCreation` ativada por
 * padrão (bloqueia gerar chave JSON de conta de serviço) e nem sempre dá pra
 * desativar. OAuth com refresh token não esbarra nisso — é só um "ID do cliente
 * OAuth" comum + uma autorização manual, uma vez só.
 *
 * Sem SDK (googleapis): só fetch cru, igual ao resto do server.
 *
 * Setup necessário (uma vez):
 *   1. Google Cloud Console → APIs e serviços → Credenciais → "ID do cliente
 *      OAuth" do tipo "Aplicativo da Web" → em "URIs de redirecionamento
 *      autorizados" adiciona: https://developers.google.com/oauthplayground
 *   2. developers.google.com/oauthplayground → ícone de engrenagem → marca
 *      "Use your own OAuth credentials" → cola o Client ID e o Client secret
 *      desse cliente OAuth.
 *   3. No campo de escopo (canto inferior esquerdo), cola
 *      https://www.googleapis.com/auth/calendar → "Authorize APIs" → loga com
 *      a conta Google que vai virar a agenda compartilhada → Allow.
 *   4. "Exchange authorization code for tokens" → copia o "Refresh token".
 *   5. Preenche no .env do servidor:
 *        GOOGLE_OAUTH_CLIENT_ID = Client ID do passo 1
 *        GOOGLE_OAUTH_CLIENT_SECRET = Client secret do passo 1
 *        GOOGLE_OAUTH_REFRESH_TOKEN = Refresh token do passo 4
 *        GOOGLE_CALENDAR_ID (opcional, default "primary")
 */

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';
const REFRESH_TOKEN = process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? '';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
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
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.token;
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
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

function buildEventBody(input: CreateMeetingInput, withConferenceRequest: boolean) {
  const tipoLabel = input.tipo === 'comercial' ? 'Comercial' : 'Suporte';
  const descricaoLinhas = [
    `Tipo: ${tipoLabel}`,
    `Cliente: ${input.clienteNome}`,
    `Responsável: ${input.responsavel}`,
  ];
  if (input.obs?.trim()) descricaoLinhas.push('', input.obs.trim());

  return {
    summary: `[${tipoLabel}] ${input.clienteNome}`,
    description: descricaoLinhas.join('\n'),
    start: { dateTime: input.start, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: input.end, timeZone: 'America/Sao_Paulo' },
    ...(withConferenceRequest
      ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {}),
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
}

export async function createCalendarEvent(input: CreateMeetingInput): Promise<CalendarEvent> {
  const body = (await calendarFetch(
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events?conferenceDataVersion=1`,
    { method: 'POST', body: JSON.stringify(buildEventBody(input, true)) },
  )) as Record<string, unknown>;
  const event = normalizeEvent(body);
  if (!event) throw new Error('Google Calendar retornou um evento inesperado');
  return event;
}

/** Atualiza um evento já existente (reagendar) — não mexe no link do Meet já criado. */
export async function updateCalendarEvent(eventId: string, input: CreateMeetingInput): Promise<CalendarEvent> {
  const body = (await calendarFetch(
    `/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(buildEventBody(input, false)) },
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
