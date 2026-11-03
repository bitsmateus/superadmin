import { FastifyInstance } from 'fastify';
import { queryOne } from '../db.js';
import { storage, tipoDoArquivo } from '../lib/demoStudio/storage.js';

/**
 * Rotas do Demo Studio (ver docs/demo-studio/ADAPTACAO.md). Por enquanto só a fundação (M0):
 * arquivos e saúde. As do painel entram em /api/ds/*, as públicas em /api/public/ds/*.
 */
export async function demoStudioRoutes(app: FastifyInstance) {
  // Imagens e assets das demos. Público (o player e o preview do WhatsApp leem daqui) e com cache
  // imutável: os nomes levam hash do conteúdo, um arquivo nunca muda depois de gravado.
  app.get<{ Params: { '*': string } }>('/files/*', async (req, reply) => {
    const key = req.params['*'];
    const arquivo = await storage.get(key);
    if (!arquivo) return reply.status(404).send({ message: 'Arquivo não encontrado' });
    return reply
      .header('Content-Type', tipoDoArquivo(key))
      .header('Content-Length', arquivo.size)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(arquivo.stream);
  });

  // Healthcheck com o banco junto (o /health antigo só diz que o processo está de pé).
  app.get('/api/health', async (_req, reply) => {
    try {
      await queryOne('SELECT 1');
      return { ok: true, db: true };
    } catch {
      return reply.status(503).send({ ok: false, db: false });
    }
  });
}
