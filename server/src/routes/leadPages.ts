import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';

/**
 * Abas do Comercial (Novos Leads, CRM NX Luis, CRM NX Arthur, e as que um admin criar/duplicar
 * depois). Não são mais um enum fixo no código — viram linhas normais de lead_pages,
 * gerenciáveis por admin (criar, duplicar a estrutura de quadros, arquivar/restaurar).
 */

/** true se o usuário tem acesso ao Comercial como um todo — granularidade fina fica por quadro
 * (user_board_access), não mais por página. */
async function hasComercialAccess(userId: string, role: string): Promise<boolean> {
  if (role !== 'suporte') return true;
  const profile = await queryOne<{ restrict_access: boolean }>(
    'SELECT restrict_access FROM profiles WHERE id = $1',
    [userId]
  );
  if (!profile?.restrict_access) return true;
  const menuRows = await query<{ menu_key: string }>(
    'SELECT menu_key FROM user_menu_access WHERE user_id = $1',
    [userId]
  );
  // Sem nenhuma permissão de menu salva ainda = restrição não configurada por área, só por quadro.
  if (menuRows.length === 0) return true;
  return menuRows.some((r) => r.menu_key === 'comercial');
}

export async function leadPageRoutes(app: FastifyInstance) {
  // GET /api/lead-pages — abas ativas (ou ?archived=1, só admin, pra listar as arquivadas)
  app.get<{ Querystring: { archived?: string } }>(
    '/api/lead-pages',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const wantsArchived = req.query.archived === '1';
      if (wantsArchived && role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      if (!wantsArchived && !(await hasComercialAccess(sub, role))) return [];

      const cond = wantsArchived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL';
      return query(`SELECT * FROM lead_pages WHERE ${cond} ORDER BY position, created_at`);
    }
  );

  // POST /api/lead-pages — admin only, cria uma aba nova (vazia, sem quadro nenhum)
  app.post<{ Body: { name?: string } }>(
    '/api/lead-pages',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const name = (req.body.name ?? '').trim();
      if (!name) return reply.status(400).send({ message: 'Nome é obrigatório' });

      const [row] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM lead_pages');
      const position = (row?.max ?? -1) + 1;
      const [page] = await query(
        'INSERT INTO lead_pages (id, name, position) VALUES ($1,$2,$3) RETURNING *',
        [uuidv4(), name, position]
      );
      return reply.status(201).send(page);
    }
  );

  // PATCH /api/lead-pages/:id — admin only, renomear/reordenar
  app.patch<{ Params: { id: string }; Body: { name?: string; position?: number } }>(
    '/api/lead-pages/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.name !== undefined) { sets.push(`name = $${i++}`); params.push(req.body.name.trim()); }
      if (req.body.position !== undefined) { sets.push(`position = $${i++}`); params.push(req.body.position); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      params.push(req.params.id);
      const [page] = await query(`UPDATE lead_pages SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!page) return reply.status(404).send({ message: 'Aba não encontrada' });
      return page;
    }
  );

  // POST /api/lead-pages/:id/duplicate — admin only. Cria uma aba nova "<nome> (cópia)" com a
  // MESMA estrutura de quadros (nome/cor/posição) da original — sem copiar nenhum lead.
  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/lead-pages/:id/duplicate',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const source = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM lead_pages WHERE id = $1',
        [req.params.id]
      );
      if (!source) return reply.status(404).send({ message: 'Aba não encontrada' });

      const name = req.body.name?.trim() || `${source.name} (cópia)`;
      const [row] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM lead_pages');
      const position = (row?.max ?? -1) + 1;
      const newId = uuidv4();
      const [newPage] = await query(
        'INSERT INTO lead_pages (id, name, position) VALUES ($1,$2,$3) RETURNING *',
        [newId, name, position]
      );

      const sourceBoards = await query<{ name: string; color: string; position: number }>(
        'SELECT name, color, position FROM lead_boards WHERE page = $1 ORDER BY position',
        [source.id]
      );
      for (const b of sourceBoards) {
        await query(
          'INSERT INTO lead_boards (name, color, page, position) VALUES ($1,$2,$3,$4)',
          [b.name, b.color, newId, b.position]
        );
      }

      return reply.status(201).send(newPage);
    }
  );

  // POST /api/lead-pages/:id/archive — admin only. Soft: os quadros e leads dela continuam no
  // banco intactos, só some do menu/rotas até alguém restaurar.
  app.post<{ Params: { id: string } }>(
    '/api/lead-pages/:id/archive',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE lead_pages SET archived_at = NOW() WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Aba não encontrada' });
      return page;
    }
  );

  // POST /api/lead-pages/:id/restore — admin only
  app.post<{ Params: { id: string } }>(
    '/api/lead-pages/:id/restore',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const [page] = await query('UPDATE lead_pages SET archived_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
      if (!page) return reply.status(404).send({ message: 'Aba não encontrada' });
      return page;
    }
  );
}
