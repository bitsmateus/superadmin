import { FastifyInstance, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { allowedPageIds } from './leadPages.js';

/**
 * Bloco de notas de uma aba marcada is_notas (lead_pages) — uma nota por dia (UNIQUE page_id +
 * note_date), pensada pra alguém anotar o que precisa fazer, sem quadro/kanban/métricas.
 */

interface PageNoteRow {
  id: string;
  page_id: string;
  note_date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Mesma allowlist por aba usada em /api/lead-pages — nunca deixa ler/escrever nota de uma aba
 * que o usuário restrito não enxerga. */
async function assertPageAccess(userId: string, role: string, pageId: string, reply: FastifyReply): Promise<boolean> {
  const allowed = await allowedPageIds(userId, role);
  if (allowed !== null && !allowed.includes(pageId)) {
    reply.status(403).send({ message: 'Acesso negado' });
    return false;
  }
  return true;
}

export async function pageNoteRoutes(app: FastifyInstance) {
  // GET /api/page-notes?page=<pageId> — todas as notas dessa aba, mais recente primeiro.
  app.get<{ Querystring: { page?: string } }>(
    '/api/page-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const pageId = req.query.page;
      if (!pageId) return reply.status(400).send({ message: 'page é obrigatório' });
      if (!(await assertPageAccess(sub, role, pageId, reply))) return;
      return query<PageNoteRow>('SELECT * FROM page_notes WHERE page_id = $1 ORDER BY note_date DESC', [pageId]);
    }
  );

  // POST /api/page-notes — cria (ou atualiza, se já existir uma nota nesse dia) a nota do dia.
  app.post<{ Body: { pageId?: string; noteDate?: string; content?: string } }>(
    '/api/page-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const { pageId, noteDate, content } = req.body;
      if (!pageId || !noteDate) return reply.status(400).send({ message: 'pageId e noteDate são obrigatórios' });
      if (!(await assertPageAccess(sub, role, pageId, reply))) return;
      const [row] = await query<PageNoteRow>(
        `INSERT INTO page_notes (id, page_id, note_date, content) VALUES ($1,$2,$3,$4)
         ON CONFLICT (page_id, note_date) DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()
         RETURNING *`,
        [uuidv4(), pageId, noteDate, content ?? '']
      );
      return reply.status(201).send(row);
    }
  );

  // PATCH /api/page-notes/:id — salva o texto (debounce no front, ver src/services/pageNotes.ts).
  app.patch<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/page-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const existing = await queryOne<PageNoteRow>('SELECT * FROM page_notes WHERE id = $1', [req.params.id]);
      if (!existing) return reply.status(404).send({ message: 'Nota não encontrada' });
      if (!(await assertPageAccess(sub, role, existing.page_id, reply))) return;
      if (req.body.content === undefined) return reply.status(400).send({ message: 'Nada para atualizar' });
      const [row] = await query<PageNoteRow>(
        'UPDATE page_notes SET content = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [req.body.content, req.params.id]
      );
      return row;
    }
  );

  // DELETE /api/page-notes/:id — remove a nota de um dia (ex.: dia criado sem querer/vazio).
  app.delete<{ Params: { id: string } }>(
    '/api/page-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const existing = await queryOne<PageNoteRow>('SELECT * FROM page_notes WHERE id = $1', [req.params.id]);
      if (!existing) return reply.status(404).send({ message: 'Nota não encontrada' });
      if (!(await assertPageAccess(sub, role, existing.page_id, reply))) return;
      await query('DELETE FROM page_notes WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
