import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';

/**
 * Resolve a allowlist de quadros de um usuário restrito.
 * null = sem restrição (vê tudo) · [] = não vê nenhum quadro · string[] = allowlist.
 * Só faz consulta extra pro papel 'suporte' ("Usuário") — admin/supervisor saem de cara com null.
 */
async function restrictedBoardFilter(userId: string, role: string): Promise<string[] | null> {
  if (role !== 'suporte') return null;
  const profile = await queryOne<{ restrict_access: boolean; area: string | null }>(
    'SELECT restrict_access, area FROM profiles WHERE id = $1',
    [userId]
  );
  if (!profile?.restrict_access) return null;
  const area = profile.area ?? 'ambos';
  if (area !== 'comercial' && area !== 'ambos') return [];
  const access = await query<{ board_id: string }>(
    'SELECT board_id FROM user_board_access WHERE user_id = $1',
    [userId]
  );
  return access.length ? access.map((r) => r.board_id) : null;
}

export async function leadBoardRoutes(app: FastifyInstance) {
  // GET /api/lead-boards
  app.get('/api/lead-boards', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null) {
      if (!allowed.length) return [];
      return query('SELECT * FROM lead_boards WHERE id = ANY($1) ORDER BY position, created_at', [allowed]);
    }
    return query('SELECT * FROM lead_boards ORDER BY position, created_at');
  });

  // POST /api/lead-boards
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-boards',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) return reply.status(403).send({ message: 'Acesso negado' });

      const b = req.body;
      const id = (b.id as string) || uuidv4();
      const page = (b.page as string) || 'novos_leads';
      let position = b.position as number | undefined;
      if (position === undefined) {
        const [row] = await query<{ max: number | null }>(
          'SELECT MAX(position) as max FROM lead_boards WHERE page = $1',
          [page]
        );
        position = (row?.max ?? -1) + 1;
      }
      const [board] = await query(
        `INSERT INTO lead_boards (id, name, color, page, position) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, b.name, b.color ?? '#4F8EF7', page, position]
      );
      return reply.status(201).send(board);
    }
  );

  // PATCH /api/lead-boards/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/lead-boards/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(req.params.id)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }

      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [board] = await query(
        `UPDATE lead_boards SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!board) return reply.status(404).send({ message: 'Quadro não encontrado' });
      return board;
    }
  );

  // DELETE /api/lead-boards/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-boards/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(req.params.id)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }
      await query('DELETE FROM lead_boards WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/lead-rows
  app.get('/api/lead-rows', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null) {
      if (!allowed.length) return [];
      return query('SELECT * FROM lead_rows WHERE board_id = ANY($1) ORDER BY position, created_at', [allowed]);
    }
    return query('SELECT * FROM lead_rows ORDER BY position, created_at');
  });

  // POST /api/lead-rows
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-rows',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const b = req.body;
      if (!b.board_id) return reply.status(400).send({ message: 'board_id é obrigatório' });

      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(b.board_id as string)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }

      const id = (b.id as string) || uuidv4();
      let position = b.position as number | undefined;
      if (position === undefined) {
        const [row] = await query<{ max: number | null }>(
          'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
          [b.board_id]
        );
        position = (row?.max ?? -1) + 1;
      }
      const [leadRow] = await query(
        `INSERT INTO lead_rows (
          id, board_id, nome, tipo, empresa, telefone, dia_contato, ligacao, status,
          retornar, responsavel, sdr, numero,
          dor_cliente, numero_atendentes, valor_mrr, valor_implementacao, position
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [
          id, b.board_id, b.nome ?? '', b.tipo ?? '', b.empresa ?? '', b.telefone ?? '',
          b.dia_contato ?? '', b.ligacao ?? '', b.status ?? '',
          b.retornar ?? '', b.responsavel ?? '', b.sdr ?? '', b.numero ?? '',
          b.dor_cliente ?? '', b.numero_atendentes ?? '', b.valor_mrr ?? '', b.valor_implementacao ?? '',
          position,
        ]
      );
      return reply.status(201).send(leadRow);
    }
  );

  // PATCH /api/lead-rows/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/lead-rows/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const current = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.params.id]
        );
        const targetBoardId = (req.body.board_id as string | undefined) ?? current?.board_id;
        if (!current || !allowed.includes(current.board_id) || (targetBoardId && !allowed.includes(targetBoardId))) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }

      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [leadRow] = await query(
        `UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!leadRow) return reply.status(404).send({ message: 'Linha não encontrada' });
      return leadRow;
    }
  );

  // DELETE /api/lead-rows/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-rows/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const current = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.params.id]
        );
        if (!current || !allowed.includes(current.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      await query('DELETE FROM lead_rows WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/lead-notes?lead_row_id=xxx — bloco de anotações/atualizações do lead
  app.get<{ Querystring: { lead_row_id?: string } }>(
    '/api/lead-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!req.query.lead_row_id) return reply.status(400).send({ message: 'lead_row_id é obrigatório' });
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const row = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.query.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      return query(
        'SELECT * FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [req.query.lead_row_id]
      );
    }
  );

  // POST /api/lead-notes
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      if (!b.lead_row_id || !b.content) {
        return reply.status(400).send({ message: 'lead_row_id e content são obrigatórios' });
      }
      const { sub: authorId, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(authorId, role);
      if (allowed !== null) {
        const row = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [b.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      const [note] = await query(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [
          b.lead_row_id, authorId ?? null, b.author_name ?? 'Alguém', b.content,
          JSON.stringify(b.attachments ?? []),
        ]
      );
      return reply.status(201).send(note);
    }
  );

  // PATCH /api/lead-notes/:id — edita o texto de uma atualização
  app.patch<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/lead-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const note = await queryOne<{ lead_row_id: string }>(
          'SELECT lead_row_id FROM lead_notes WHERE id = $1',
          [req.params.id]
        );
        const row = note && await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [note.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }

      const content = req.body.content?.trim();
      if (!content) return reply.status(400).send({ message: 'content é obrigatório' });
      const [note] = await query(
        `UPDATE lead_notes SET content = $1 WHERE id = $2 RETURNING *`,
        [content, req.params.id]
      );
      if (!note) return reply.status(404).send({ message: 'Anotação não encontrada' });
      return note;
    }
  );

  // DELETE /api/lead-notes/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const note = await queryOne<{ lead_row_id: string }>(
          'SELECT lead_row_id FROM lead_notes WHERE id = $1',
          [req.params.id]
        );
        const row = note && await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [note.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      await query('DELETE FROM lead_notes WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
