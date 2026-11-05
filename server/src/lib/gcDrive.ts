/**
 * Envio das artes aprovadas pra pasta do Google Drive do cliente. Sem SDK: fetch cru, como o
 * googleCalendar.ts.
 *
 * Configuração (uma vez, no servidor):
 *   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET — o mesmo cliente OAuth do Google Calendar.
 *   GOOGLE_DRIVE_REFRESH_TOKEN — refresh token de uma conta com acesso às pastas dos clientes,
 *     gerado no OAuth Playground com o escopo https://www.googleapis.com/auth/drive.file
 *     (ou .../auth/drive, se as pastas foram criadas por outra pessoa).
 *
 * Em cada cliente, a equipe cola o link da pasta ("Pasta do Drive das artes aprovadas"). Dentro dela o
 * sistema cria uma subpasta por mês (ex.: "2026-11") e salva a arte final ali.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const PASTA = 'application/vnd.google-apps.folder';

const env = () => ({
  id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  refresh: process.env.GOOGLE_DRIVE_REFRESH_TOKEN ?? '',
});

export const driveConfigurado = (): boolean => {
  const e = env();
  return !!(e.id && e.secret && e.refresh);
};

/** O id da pasta a partir do link que a equipe colou (ou o próprio id). */
export function idDaPasta(link: string): string | null {
  const t = link.trim();
  const m = t.match(/\/folders\/([\w-]{10,})/) ?? t.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(t) ? t : null;
}

let cache: { token: string; expira: number } | null = null;

async function token(): Promise<string> {
  if (cache && cache.expira > Date.now() + 60_000) return cache.token;
  const e = env();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.id, client_secret: e.secret, refresh_token: e.refresh, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Google recusou o acesso ao Drive (${res.status}). Gere o GOOGLE_DRIVE_REFRESH_TOKEN de novo.`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: j.access_token, expira: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function google<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (res.status === 404) throw new Error('Pasta do Drive não encontrada, ou a conta do sistema não tem acesso a ela.');
    throw new Error(`Drive ${res.status}: ${txt.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const aspas = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** A subpasta do mês dentro da pasta do cliente; cria se não existir. */
async function pastaDoMes(pai: string, mes: string): Promise<string> {
  const q = `name = '${aspas(mes)}' and '${aspas(pai)}' in parents and mimeType = '${PASTA}' and trashed = false`;
  const achou = await google<{ files: { id: string }[] }>(
    `${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (achou.files[0]) return achou.files[0].id;
  const criada = await google<{ id: string }>(`${API}/files?supportsAllDrives=true&fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: mes, mimeType: PASTA, parents: [pai] }),
  });
  return criada.id;
}

/** Sobe um arquivo (data URL) pra pasta. Devolve o link da subpasta do mês. */
export async function enviarProDrive(
  linkPasta: string, mes: string, arquivos: { nome: string; dataUrl: string }[],
): Promise<{ link: string; enviados: number }> {
  const aviso = (m: string) => Object.assign(new Error(m), { statusCode: 400 });
  if (!driveConfigurado()) throw aviso('Envio pro Drive não configurado no servidor (GOOGLE_DRIVE_REFRESH_TOKEN).');
  const pai = idDaPasta(linkPasta);
  if (!pai) throw aviso('Cole o link da pasta do Drive do cliente (drive.google.com/drive/folders/...).');
  const destino = await pastaDoMes(pai, mes);
  let enviados = 0;
  for (const a of arquivos) {
    const virgula = a.dataUrl.indexOf(',');
    if (!a.dataUrl.startsWith('data:') || virgula < 0) continue;
    const tipo = a.dataUrl.slice(5, virgula).split(';')[0] || 'application/octet-stream';
    const corpo = Buffer.from(a.dataUrl.slice(virgula + 1), 'base64');
    const fronteira = `nx${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name: a.nome, parents: [destino] });
    const multipart = Buffer.concat([
      Buffer.from(`--${fronteira}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${fronteira}\r\nContent-Type: ${tipo}\r\n\r\n`),
      corpo,
      Buffer.from(`\r\n--${fronteira}--`),
    ]);
    await google(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${fronteira}` },
      body: multipart,
    });
    enviados++;
  }
  return { link: `https://drive.google.com/drive/folders/${destino}`, enviados };
}
