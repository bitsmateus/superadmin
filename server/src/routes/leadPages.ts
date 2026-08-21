import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Abas do Comercial (Novos Leads, CRM NX Luis, CRM NX Arthur, e as que um admin criar/duplicar
 * depois). Não são mais um enum fixo no código — viram linhas normais de lead_pages,
 * gerenciáveis por admin (criar, duplicar a estrutura de quadros, arquivar/restaurar).
 */

/** Vira o id da aba (e o pedaço da URL) — nome legível, não um UUID aleatório. */
function slugify(name: string): string {
  const noAccents = name
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join('');
  const base = noAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 60) || 'aba';
}

/** Garante um id único — acrescenta -2, -3... se já existir uma aba com o mesmo slug. */
async function uniquePageId(name: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await queryOne('SELECT 1 FROM lead_pages WHERE id = $1', [id])) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** true se o usuário tem acesso ao Comercial como um todo — granularidade fina fica por ABA
 * (user_page_access, ver allowedPageIds abaixo). */
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
  // Sem nenhuma permissão de menu salva ainda = restrição não configurada por área, só por aba.
  if (menuRows.length === 0) return true;
  return menuRows.some((r) => r.menu_key === 'comercial');
}

/** Allowlist de abas visíveis pra quem tem profiles.restrict_access = true — ex.: um SDR só
 * enxerga "Novos Leads" e "CRM Luis", nunca "CRM Arthur". null = sem restrição de aba configurada
 * (vê todas as abas ativas). */
async function allowedPageIds(userId: string, role: string): Promise<string[] | null> {
  if (role !== 'suporte') return null;
  const profile = await queryOne<{ restrict_access: boolean }>(
    'SELECT restrict_access FROM profiles WHERE id = $1',
    [userId]
  );
  if (!profile?.restrict_access) return null;
  const rows = await query<{ page_id: string }>(
    'SELECT page_id FROM user_page_access WHERE user_id = $1',
    [userId]
  );
  if (!rows.length) return null;
  return rows.map((r) => r.page_id);
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
      if (!wantsArchived) {
        const allowed = await allowedPageIds(sub, role);
        if (allowed !== null) {
          return query(
            `SELECT * FROM lead_pages WHERE ${cond} AND id = ANY($1) ORDER BY position, created_at`,
            [allowed]
          );
        }
      }
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
        [await uniquePageId(name), name, position]
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
  // MESMA estrutura (nome/cor/posição) dos quadros da original — sem copiar nenhum lead.
  // boardIds opcional: só duplica esses quadros específicos; sem informar (ou vazio), duplica
  // todos os quadros da aba de origem.
  app.post<{ Params: { id: string }; Body: { name?: string; boardIds?: string[] } }>(
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
      const newId = await uniquePageId(name);
      const [newPage] = await query(
        'INSERT INTO lead_pages (id, name, position) VALUES ($1,$2,$3) RETURNING *',
        [newId, name, position]
      );

      const boardIds = req.body.boardIds;
      const sourceBoards = boardIds && boardIds.length
        ? await query<{ name: string; color: string; position: number }>(
            'SELECT name, color, position FROM lead_boards WHERE page = $1 AND id = ANY($2) ORDER BY position',
            [source.id, boardIds]
          )
        : await query<{ name: string; color: string; position: number }>(
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
