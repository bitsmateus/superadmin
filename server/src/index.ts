import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { startRealtimeListener, onDbChange, runMigrations, queryOne } from './db.js';
import { isOriginAllowed } from './lib/corsOrigin.js';
import { broadcast } from './sse.js';
import { authRoutes } from './routes/auth.js';
import { clientRoutes } from './routes/clients.js';
import { settingsRoutes } from './routes/settings.js';
import { ticketRoutes } from './routes/tickets.js';
import { analyticsRoutes } from './routes/analytics.js';
import { publicRoutes } from './routes/public.js';
import { sseRoutes } from './routes/sse.js';
import { proxyRoutes } from './routes/proxy.js';
import { canaisRoutes } from './routes/canais.js';
import { channelsRoutes } from './routes/channels.js';
import { automationRoutes } from './routes/automation.js';
import { chatbotFlowRoutes } from './routes/chatbotFlow.js';
import { leadBoardRoutes } from './routes/leadBoards.js';
import { leadPageRoutes } from './routes/leadPages.js';
import { commercialMonthRoutes } from './routes/commercialMonths.js';
import { contractRoutes } from './routes/contracts.js';
import { cnpjRoutes } from './routes/cnpj.js';
import { leadLabelRoutes } from './routes/leadLabels.js';
import { supportColumnRoutes } from './routes/supportColumns.js';
import { supportPageRoutes } from './routes/supportPages.js';
import { userPageAccessRoutes } from './routes/userPageAccess.js';
import { webhookRoutes } from './routes/webhooks.js';
import { pageNoteRoutes } from './routes/pageNotes.js';
import { startDailyDigest } from './jobs/dailyDigest.js';
import { startChannelAlerts } from './jobs/channelAlerts.js';
import { startTenantUsersSync } from './jobs/syncTenantUsers.js';

async function main() {
  const app = Fastify({ logger: true });

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required');

  await app.register(cors, {
    origin: (origin, callback) => {
      // Requisições sem Origin (health checks/server-to-server) continuam válidas.
      callback(null, isOriginAllowed(origin));
    },
    credentials: true,
  });

  await app.register(jwt, { secret: JWT_SECRET });

  app.decorate('authenticate', async function (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) {
    try {
      await req.jwtVerify();
    } catch (err) {
      reply.status(401).send({ message: 'Token inválido ou expirado' });
      return;
    }
    // "Deslogar" alguém em Equipe marca profiles.session_invalidated_at — qualquer token emitido
    // antes disso (iat, em segundos) já não vale mais, mesmo sem ter expirado de verdade ainda.
    const { sub, iat } = req.user as { sub: string; iat?: number };
    if (sub && iat) {
      const profile = await queryOne<{ session_invalidated_at: string | null }>(
        'SELECT session_invalidated_at FROM profiles WHERE id = $1',
        [sub]
      );
      if (profile?.session_invalidated_at && new Date(profile.session_invalidated_at).getTime() > iat * 1000) {
        reply.status(401).send({ message: 'Sessão encerrada por um administrador' });
        return;
      }
    }
  });

  await app.register(authRoutes);
  await app.register(clientRoutes);
  await app.register(settingsRoutes);
  await app.register(ticketRoutes);
  await app.register(analyticsRoutes);
  await app.register(publicRoutes);
  await app.register(sseRoutes);
  await app.register(proxyRoutes);
  await app.register(canaisRoutes);
  await app.register(channelsRoutes);
  await app.register(automationRoutes);
  await app.register(chatbotFlowRoutes);
  await app.register(leadBoardRoutes);
  await app.register(leadPageRoutes);
  await app.register(commercialMonthRoutes);
  await app.register(contractRoutes);
  await app.register(cnpjRoutes);
  await app.register(leadLabelRoutes);
  await app.register(supportColumnRoutes);
  await app.register(supportPageRoutes);
  await app.register(userPageAccessRoutes);
  await app.register(webhookRoutes);
  await app.register(pageNoteRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  onDbChange((table, type, data) => {
    broadcast(table, type, data);
  });

  const PORT = parseInt(process.env.PORT ?? '3001');

  // Uma migração com erro NUNCA pode derrubar o servidor inteiro — sem isso, uma única instrução
  // ruim (banco já num estado que não bate com o que o código espera, etc.) travava o boot e
  // process.exit(1) tirava a API do ar até alguém notar e corrigir. Loga e segue: a imensa maioria
  // das migrações já são idempotentes (IF NOT EXISTS), então uma falha isolada não impede o resto.
  try {
    await runMigrations();
  } catch (err) {
    console.error('runMigrations falhou — subindo o servidor mesmo assim:', err);
  }
  await startRealtimeListener();
  startDailyDigest();
  startChannelAlerts();
  startTenantUsersSync();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
