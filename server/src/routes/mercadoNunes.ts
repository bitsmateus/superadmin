import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/** Layouts salvos do gerador de cartazes do Mercado Nunes (/mercadonunes) — página pública, sem
 *  login. Guardado no banco (não no localStorage do navegador) pra todo mundo que usa a ferramenta
 *  ver e reaproveitar o mesmo layout, não só quem salvou. */
export async function mercadoNunesRoutes(app: FastifyInstance) {
  app.get('/api/public/mercadonunes/layouts', async () => {
    const layouts = await query('SELECT id, nome, patch, created_at FROM mercadonunes_layouts ORDER BY created_at ASC');
    return { layouts };
  });

  app.post<{ Body: { nome?: string; patch?: Record<string, unknown> } }>(
    '/api/public/mercadonunes/layouts',
    async (req, reply) => {
      const nome = (req.body?.nome ?? '').trim();
      if (!nome) return reply.status(400).send({ message: 'Dê um nome pro layout.' });
      const patch = req.body?.patch ?? {};
      const [layout] = await query(
        'INSERT INTO mercadonunes_layouts (nome, patch) VALUES ($1, $2) RETURNING id, nome, patch, created_at',
        [nome, JSON.stringify(patch)]
      );
      return reply.status(201).send(layout);
    }
  );

  app.delete<{ Params: { id: string } }>('/api/public/mercadonunes/layouts/:id', async (req, reply) => {
    const result = await query('DELETE FROM mercadonunes_layouts WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.length) return reply.status(404).send({ message: 'Layout não encontrado.' });
    return reply.status(204).send();
  });
}
