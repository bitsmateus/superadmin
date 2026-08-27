import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/** Assinatura de Web Push (PWA) — cada dispositivo assina sozinho ao logar (sem botão de opt-in,
 * ver usePushSubscription no front) e manda a subscription do PushManager do browser pra cá.
 * Quem de fato recebe cada notificação é filtrado na hora do envio (ver lib/webPush.ts e o
 * webhook de leads do Meta Ads), não aqui — esta rota só guarda a assinatura. */
export async function pushRoutes(app: FastifyInstance) {
  // GET /api/push/vapid-public-key — chave pública que o front usa em pushManager.subscribe().
  app.get('/api/push/vapid-public-key', { onRequest: [app.authenticate] }, async (req, reply) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) return reply.status(500).send({ message: 'Push não configurado no servidor' });
    return { key };
  });

  // POST /api/push/subscribe — upsert por endpoint (chave única por navegador/dispositivo): se o
  // mesmo aparelho assinar de novo (ex.: outra pessoa logou nele), atualiza o dono da assinatura.
  app.post<{ Body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } }>(
    '/api/push/subscribe',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const { endpoint, keys } = req.body ?? {};
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return reply.status(400).send({ message: 'endpoint e keys (p256dh, auth) são obrigatórios' });
      }
      await query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
        [sub, endpoint, keys.p256dh, keys.auth]
      );
      return reply.status(201).send({ success: true });
    }
  );

  // DELETE /api/push/subscribe — desativar notificações neste dispositivo (ex.: logout).
  app.delete<{ Body: { endpoint?: string } }>(
    '/api/push/subscribe',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const endpoint = req.body?.endpoint;
      if (!endpoint) return reply.status(400).send({ message: 'endpoint é obrigatório' });
      await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      return reply.status(204).send();
    }
  );
}
