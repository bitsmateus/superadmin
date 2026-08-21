import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/**
 * Itens fixos do menu Suporte (Tarefas, Pipeline, Clientes, Canais, Tenants, Configurações,
 * Clientes arquivados, Tickets, Templates) — cada um pode ser arquivado (some do menu, fica
 * salvo pra restaurar depois) por um admin. As URLs continuam fixas (/pipeline, /tickets…), só
 * a visibilidade no menu é gerenciável — diferente do Comercial, que tem abas dinâmicas de
 * verdade (aqui não dá pra "duplicar" porque cada tela é uma feature própria, não um container
 * genérico de quadros).
 */
export async function supportPageRoutes(app: FastifyInstance) {
  // GET /api/support-pages — ativas (ou ?archived=1, só admin, pra listar as arquivadas)
  app.get<{ Querystring: { archived?: string } }>(
    '/api/support-pages',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      const wantsArchived = req.query.archived === '1';
      if (wantsArchived && role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const cond = wantsArchived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
      return query(`SELECT * FROM support_pages WHERE ${cond} ORDER BY position, created_at`);
    }
  );

  // POST /api/support-pages/:id/archive — admin only. Soft: só some do menu, nada é apagado.
  app.post<{ Params: { id: string } }>(
    '/api/support-pages/:id/archive',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE support_pages SET archived_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Item não encontrado' });
      return page;
    }
  );

  // POST /api/support-pages/:id/restore — admin only
  app.post<{ Params: { id: string } }>(
    '/api/support-pages/:id/restore',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE support_pages SET archived_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Item não encontrado' });
      return page;
    }
  );
}
