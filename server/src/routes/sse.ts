import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { addSseClient, removeSseClient } from '../sse.js';

export async function sseRoutes(app: FastifyInstance) {
  // GET /api/events?token=<jwt>
  // EventSource doesn't support custom headers, so token comes via query param
  app.get<{ Querystring: { token?: string } }>(
    '/api/events',
    async (req, reply) => {
      const token = req.query.token;
      if (!token) return reply.status(401).send({ message: 'Token ausente' });

      let userId: string;
      let role: string;
      try {
        const decoded = app.jwt.verify(token) as { sub: string; role: string };
        userId = decoded.sub;
        role = decoded.role;
      } catch {
        return reply.status(401).send({ message: 'Token inválido' });
      }

      const clientId = uuidv4();

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      reply.raw.write(': connected\n\n');

      addSseClient(clientId, userId, role, reply);

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      req.raw.on('close', () => {
        clearInterval(heartbeat);
        removeSseClient(clientId);
      });

      await new Promise<void>((resolve) => {
        req.raw.on('close', resolve);
      });
    }
  );
}
