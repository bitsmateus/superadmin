import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/**
 * Allowlist de abas do Comercial (lead_pages) e de itens de menu por usuário — só tem
 * efeito pra quem tem profiles.restrict_access = true. Gerenciado em Equipe, admin-only.
 * A restrição é por ABA inteira (ex.: "só CRM Luis e Novos Leads"), não por quadro — todos
 * os quadros de uma aba liberada ficam visíveis.
 */
export async function userPageAccessRoutes(app: FastifyInstance) {
  // GET /api/users/:id/page-access — admin only
  app.get<{ Params: { id: string } }>(
    '/api/users/:id/page-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const rows = await query<{ page_id: string }>(
        'SELECT page_id FROM user_page_access WHERE user_id = $1',
        [req.params.id]
      );
      return rows.map((r) => r.page_id);
    }
  );

  // PUT /api/users/:id/page-access — admin only, substitui a lista inteira
  app.put<{ Params: { id: string }; Body: { pageIds?: string[] } }>(
    '/api/users/:id/page-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const pageIds = req.body.pageIds ?? [];
      await query('DELETE FROM user_page_access WHERE user_id = $1', [req.params.id]);
      if (pageIds.length) {
        await query(
          `INSERT INTO user_page_access (user_id, page_id)
           SELECT $1, unnest($2::text[])`,
          [req.params.id, pageIds]
        );
      }
      return { pageIds };
    }
  );

  // GET /api/users/:id/menu-access — admin only
  app.get<{ Params: { id: string } }>(
    '/api/users/:id/menu-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const rows = await query<{ menu_key: string }>(
        'SELECT menu_key FROM user_menu_access WHERE user_id = $1',
        [req.params.id]
      );
      return rows.map((r) => r.menu_key);
    }
  );

  // PUT /api/users/:id/menu-access — admin only, substitui a lista inteira
  app.put<{ Params: { id: string }; Body: { menuKeys?: string[] } }>(
    '/api/users/:id/menu-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const menuKeys = req.body.menuKeys ?? [];
      await query('DELETE FROM user_menu_access WHERE user_id = $1', [req.params.id]);
      if (menuKeys.length) {
        await query(
          `INSERT INTO user_menu_access (user_id, menu_key)
           SELECT $1, unnest($2::text[])`,
          [req.params.id, menuKeys]
        );
      }
      return { menuKeys };
    }
  );
}
