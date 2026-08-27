import webpush from 'web-push';
import { query } from '../db.js';

let configured = false;

/** Só configura o web-push na primeira chamada que precisar dele (evita erro no boot se as
 * variáveis VAPID ainda não estiverem setadas — o resto do app continua funcionando normalmente,
 * só a notificação push fica desligada até alguém configurar). */
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT || 'mailto:contato@nxdigital.com.br';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/** Manda uma notificação push pra todo dispositivo assinado dos usuários listados. Nunca lança —
 * quem chama não deve travar por causa disso (ex.: webhook de lead não pode falhar só porque o
 * push deu erro). Assinatura expirada/revogada (404/410) é removida sozinha do banco. */
export async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<void> {
  if (!userIds.length) return;
  if (!ensureConfigured()) {
    console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY não configurados — notificação não enviada');
    return;
  }

  const subs = await query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)',
    [userIds]
  );
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        } else {
          console.error('[push] falha ao enviar notificação pra assinatura', s.id, err);
        }
      }
    })
  );
}
