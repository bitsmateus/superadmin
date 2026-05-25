import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { startRealtimeListener, onDbChange } from './db.js';
import { broadcast } from './sse.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { settingsRoutes } from './routes/settings.js';
import { ticketRoutes } from './routes/tickets.js';
import { analyticsRoutes } from './routes/analytics.js';
import { publicRoutes } from './routes/public.js';
import { sseRoutes } from './routes/sse.js';

async function main() {
  const app = Fastify({ logger: true });

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? '*',
    credentials: true,
  });

  await app.register(jwt, { secret: JWT_SECRET });

  app.decorate('authenticate', async function (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.status(401).send({ message: 'Token inválido ou expirado' });
    }
  });

  await app.register(authRoutes);
  await app.register(clientRoutes);
  await app.register(settingsRoutes);
  await app.register(ticketRoutes);
  await app.register(analyticsRoutes);
  await app.register(publicRoutes);
  await app.register(sseRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  onDbChange((table, type, data) => {
    broadcast(table, type, data);
  });

  const PORT = parseInt(process.env.PORT ?? '3001');

  await startRealtimeListener();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
