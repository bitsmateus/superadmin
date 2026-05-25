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

const app = Fastify({ logger: true });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

// Plugins
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? '*',
  credentials: true,
});

await app.register(jwt, { secret: JWT_SECRET });

// Attach authenticate decorator
app.decorate('authenticate', async function (req: Parameters<typeof app.authenticate>[0], reply: Parameters<typeof app.authenticate>[1]) {
  try {
    await req.jwtVerify();
  } catch (err) {
    reply.status(401).send({ message: 'Token inválido ou expirado' });
  }
});

// Routes
await app.register(authRoutes);
await app.register(clientRoutes);
await app.register(settingsRoutes);
await app.register(ticketRoutes);
await app.register(analyticsRoutes);
await app.register(publicRoutes);
await app.register(sseRoutes);

// Healthcheck
app.get('/health', async () => ({ status: 'ok' }));

// Wire DB realtime → SSE broadcast
onDbChange((table, type, data) => {
  broadcast(table, type, data);
});

// Start
const PORT = parseInt(process.env.PORT ?? '3001');

try {
  await startRealtimeListener();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
