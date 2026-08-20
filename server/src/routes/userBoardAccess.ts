import { FastifyInstance } from 'fastify';
import { query } from '../db.js';

/**
 * Allowlist de quadros (lead_boards) e de itens de menu por usuário — só tem
 * efeito pra quem tem profiles.restrict_access = true. Gerenciado em Equipe, admin-only.
 */
export async function userBoardAccessRoutes(app: FastifyInstance) {
  // GET /api/users/:id/board-access — admin only
  app.get<{ Params: { id: string } }>(
    '/api/users/:id/board-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const rows = await query<{ board_id: string }>(
        'SELECT board_id FROM user_board_access WHERE user_id = $1',
        [req.params.id]
      );
      return rows.map((r) => r.board_id);
    }
  );

  // PUT /api/users/:id/board-access — admin only, substitui a lista inteira
  app.put<{ Params: { id: string }; Body: { boardIds?: string[] } }>(
    '/api/users/:id/board-access',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const boardIds = req.body.boardIds ?? [];
      await query('DELETE FROM user_board_access WHERE user_id = $1', [req.params.id]);
      if (boardIds.length) {
        await query(
          `INSERT INTO user_board_access (user_id, board_id)
           SELECT $1, unnest($2::uuid[])`,
          [req.params.id, boardIds]
        );
      }
      return { boardIds };
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
