import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Itens fixos do menu Suporte (Tarefas, Pipeline, Clientes, Canais, Tenants, Configurações,
 * Clientes arquivados, Tickets, Templates) — cada um pode ser arquivado (some do menu, fica
 * salvo pra restaurar depois) ou duplicado por um admin. Diferente do Comercial (abas dinâmicas
 * que são um container genérico de quadros), cada tela do Suporte é uma feature própria com URL
 * fixa — "duplicar" aqui NÃO cria uma tela/dados independentes, só uma segunda entrada no menu
 * com nome próprio que abre a MESMA rota do original (ver source_key).
 */

/** Vira o id do item novo — nome legível, não um UUID aleatório. */
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

/** Garante um id único — acrescenta -2, -3... se já existir um item com o mesmo slug. */
async function uniquePageId(name: string): Promise<string> {
  const base = slugify(name);
  let id = base;
  let n = 2;
  while (await queryOne('SELECT 1 FROM support_pages WHERE id = $1', [id])) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

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

  // POST /api/support-pages/:id/duplicate — admin only. Cria uma entrada nova no menu, com nome
  // próprio, apontando pra MESMA rota do original (source_key propaga — duplicar uma cópia
  // ainda aponta pro item de origem raiz, não pra cópia).
  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/support-pages/:id/duplicate',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });

      const source = await queryOne<{ name: string; source_key: string }>(
        'SELECT name, source_key FROM support_pages WHERE id = $1',
        [req.params.id]
      );
      if (!source) return reply.status(404).send({ message: 'Item não encontrado' });

      const name = req.body.name?.trim() || `${source.name} (cópia)`;
      const [row] = await query<{ max: number | null }>('SELECT MAX(position) as max FROM support_pages');
      const position = (row?.max ?? -1) + 1;
      const newId = await uniquePageId(name);
      const [page] = await query(
        'INSERT INTO support_pages (id, name, source_key, position) VALUES ($1,$2,$3,$4) RETURNING *',
        [newId, name, source.source_key, position]
      );
      return reply.status(201).send(page);
    }
  );
}
