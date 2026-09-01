import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';

/**
 * Resolve a allowlist de quadros de um usuário restrito. A permissão de menu é só "comercial"
 * (tudo ou nada — as abas viraram gerenciáveis, não dá mais pra restringir por aba individual
 * nessa camada); a granularidade fina é por ABA inteira (user_page_access) — ex.: um SDR só
 * enxerga "Novos Leads" e "CRM Luis", nunca "CRM Arthur", com todos os quadros dessas 2 abas.
 * null = sem restrição (vê tudo) · [] = não vê nenhum quadro (inclui "nenhuma aba marcada ainda" —
 * quem gerencia Equipe precisa marcar manualmente cada aba liberada) · string[] = allowlist de
 * board ids. Só faz consulta extra pro papel 'suporte' ("Usuário") — admin/supervisor saem com null.
 */
export async function restrictedBoardFilter(userId: string, role: string): Promise<string[] | null> {
  if (role !== 'suporte') return null;
  const profile = await queryOne<{ restrict_access: boolean }>(
    'SELECT restrict_access FROM profiles WHERE id = $1',
    [userId]
  );
  if (!profile?.restrict_access) return null;

  const menuRows = await query<{ menu_key: string }>(
    'SELECT menu_key FROM user_menu_access WHERE user_id = $1',
    [userId]
  );
  // Sem nenhuma permissão de menu salva ainda = restrição não configurada por área, só por aba.
  const hasComercial = menuRows.length === 0 || menuRows.some((r) => r.menu_key === 'comercial');
  if (!hasComercial) return [];

  const pageAccess = await query<{ page_id: string }>(
    'SELECT page_id FROM user_page_access WHERE user_id = $1',
    [userId]
  );
  if (!pageAccess.length) return []; // nenhuma aba marcada ainda = não vê nenhum quadro

  const boards = await query<{ id: string }>(
    'SELECT id FROM lead_boards WHERE page = ANY($1)',
    [pageAccess.map((r) => r.page_id)]
  );
  return boards.map((r) => r.id);
}

async function getActorName(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Sistema';
  const profile = await queryOne<{ name: string | null; email: string }>(
    'SELECT name, email FROM profiles WHERE id = $1',
    [userId]
  );
  return profile?.name || profile?.email || 'Alguém';
}

/** Grava um evento na linha do tempo automática do lead (ver aba "Linha do tempo" no modal). */
async function logLeadEvent(
  leadRowId: string,
  type: string,
  fromValue: string | null,
  toValue: string | null,
  actorName: string
): Promise<void> {
  await query(
    `INSERT INTO lead_events (lead_row_id, type, from_value, to_value, actor_name)
     VALUES ($1,$2,$3,$4,$5)`,
    [leadRowId, type, fromValue, toValue, actorName]
  );
}

/** Campos rastreados na linha do tempo — chave da coluna ↔ tipo de evento gravado. */
const TRACKED_FIELDS: Record<string, string> = {
  status: 'status',
  dia_contato: 'dia_contato',
  sdr: 'sdr',
  retornado: 'retornado',
};

/**
 * Etiquetas de Status que contam como "marco" pro dashboard de SDR. A classificação de cada
 * lead usa sempre a ocorrência MAIS RECENTE de uma dessas três na linha do tempo (não o status
 * literal atual) — assim, se o lead voltou de "no-show" pra "Reunião agendada", conta como
 * agendada; se saiu de "no-show" pra um status fora dessa lista (ex.: disparo em massa), continua
 * contando como no-show.
 */
const MILESTONE_AGENDADA = 'Reunião agendada';
const MILESTONE_VENDIDO = 'Vendido';
const MILESTONE_STATUSES = [MILESTONE_AGENDADA, 'Reunião não comparecida', MILESTONE_VENDIDO];

/** O CAMINHO VÁLIDO depois de agendar uma reunião: continua agendada, virou no-show, seguiu pra
 * proposta/follow-up, ou fechou venda. Usado como o único critério de "ever_agendada" (denominador
 * do funil) — o status ATUAL do lead precisa estar aqui, não importa o que ele já foi no passado
 * (evita contar erro de SDR: marcar Reunião agendada e depois corrigir pra um status fora desse
 * caminho, tipo "Disparo em massa", não deve contar como agendamento de verdade). Não muda o
 * "milestone" (marco mais recente, usado separadamente pra no-show/vendas). */
const POST_AGENDAMENTO_STATUSES = [
  MILESTONE_AGENDADA,
  'Reunião não comparecida',
  'Proposta Enviada',
  'Follow-up Propostas',
  MILESTONE_VENDIDO,
];

/**
 * Sincroniza o registro de venda quando o status de um lead muda.
 *
 * Virou "Vendido"  → cria a oportunidade no quadro marcado com is_vendas, copiando nome, empresa,
 *                    SDR e os valores COMO ESTÃO AGORA (foto do momento — corrigir o lead depois
 *                    não altera o que já foi fechado). O lead continua no CRM do SDR, marcado
 *                    como vendido; a oportunidade é um registro novo, não uma mudança de lugar.
 * Saiu de "Vendido" → marca a oportunidade como revertida em vez de apagar, pra não perder o
 *                     histórico se alguém trocou o status por engano.
 * Voltou a "Vendido" → reaproveita a oportunidade que já existe (venda_origem_id é único), só
 *                      tira a marca de revertida. Assim ir e voltar não gera duplicata.
 *
 * Nunca lança: é chamado em background depois do UPDATE, e falhar aqui não pode derrubar a
 * edição do lead que o usuário acabou de fazer.
 */
async function syncVendaFromStatus(leadRowId: string, fromStatus: string, toStatus: string) {
  try {
    if (fromStatus === toStatus) return;

    if (toStatus !== MILESTONE_VENDIDO) {
      if (fromStatus !== MILESTONE_VENDIDO) return;
      await query(
        'UPDATE lead_rows SET venda_revertida = true WHERE venda_origem_id = $1',
        [leadRowId]
      );
      return;
    }

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM lead_rows WHERE venda_origem_id = $1',
      [leadRowId]
    );
    if (existing) {
      await query('UPDATE lead_rows SET venda_revertida = false WHERE id = $1', [existing.id]);
      return;
    }

    const target = await queryOne<{ id: string }>('SELECT id FROM lead_boards WHERE is_vendas LIMIT 1');
    // Sem quadro de vendas configurado não há onde registrar — o lead vira Vendido normalmente e
    // o painel avisa que falta escolher o quadro. Silenciar aqui é de propósito.
    if (!target) return;

    const lead = await queryOne<{
      nome: string; empresa: string; telefone: string; sdr: string;
      valor_mrr: string; valor_implementacao: string;
    }>(
      `SELECT nome, empresa, telefone, sdr, valor_mrr, valor_implementacao
       FROM lead_rows WHERE id = $1`,
      [leadRowId]
    );
    if (!lead) return;

    const [{ max }] = await query<{ max: number | null }>(
      'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
      [target.id]
    );

    await query(
      `INSERT INTO lead_rows (
        board_id, nome, empresa, telefone, sdr, status,
        valor_mrr, valor_implementacao, fechamento, venda_origem_id, position, veio_do_funil
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`,
      [
        target.id, lead.nome, lead.empresa, lead.telefone, lead.sdr, MILESTONE_VENDIDO,
        lead.valor_mrr, lead.valor_implementacao,
        new Date().toISOString().slice(0, 10),
        leadRowId,
        (max ?? -1) + 1,
      ]
    );
  } catch (err) {
    console.error('[vendas] falha ao sincronizar venda do lead', leadRowId, err);
  }
}

export async function leadBoardRoutes(app: FastifyInstance) {
  // GET /api/lead-rows/:id/support-view — card de leitura de UMA lead específica (dados + as
  // Atualizações), SEM checar restrictedBoardFilter de propósito: é o que deixa o Suporte ver o
  // histórico do SDR com o cliente (aba Pipeline > "Lead do CRM", ver LeadLinkPanel) mesmo sem
  // nenhum acesso ao Comercial como um todo. Não é uma brecha de busca livre — só devolve dado de
  // um ID que a pessoa já tem em mãos por um vínculo que o próprio app já validou
  // (contracts.venda_lead_id ou a sugestão automática por telefone/nome), nunca uma listagem.
  app.get<{ Params: { id: string } }>(
    '/api/lead-rows/:id/support-view',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const lead = await queryOne(
        `SELECT id, nome, empresa, telefone, tipo, dia_contato, status, sdr, dor_cliente,
                numero_atendentes, valor_mrr, valor_implementacao, created_at
         FROM lead_rows WHERE id = $1`,
        [req.params.id]
      );
      if (!lead) return reply.status(404).send({ message: 'Lead não encontrada' });
      const notes = await query(
        'SELECT id, author_name, content, attachments, created_at FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );
      return { lead, notes };
    }
  );

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

  // POST /api/lead-boards/:id/set-vendas — admin only. Elege o quadro que recebe as oportunidades
  // quando um lead vira "Vendido". Só um no sistema inteiro (índice único), então tira a marca dos
  // outros antes — sem isso o UPDATE quebraria no índice em vez de trocar o quadro escolhido.
  app.post<{ Params: { id: string } }>(
    '/api/lead-boards/:id/set-vendas',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('UPDATE lead_boards SET is_vendas = false WHERE is_vendas');
      const [board] = await query(
        'UPDATE lead_boards SET is_vendas = true WHERE id = $1 RETURNING *',
        [req.params.id]
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

  // GET /api/lead-rows — ?trash=1 lista os excluídos (pra Lixeira), em vez dos ativos.
  app.get<{ Querystring: { trash?: string } }>('/api/lead-rows', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    const trash = req.query.trash === '1';
    const deletedCond = trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    const orderBy = trash ? 'deleted_at DESC' : 'position, created_at';
    if (allowed !== null) {
      if (!allowed.length) return [];
      return query(
        `SELECT * FROM lead_rows WHERE board_id = ANY($1) AND ${deletedCond} ORDER BY ${orderBy}`,
        [allowed]
      );
    }
    return query(`SELECT * FROM lead_rows WHERE ${deletedCond} ORDER BY ${orderBy}`);
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
          agendamento, retornar, responsavel, sdr, numero,
          dor_cliente, numero_atendentes, valor_mrr, valor_implementacao, position, created_at,
          fechamento, venda_origem_id, mrr_pendente, impl_pendente, observacoes, veio_do_funil
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, COALESCE($20::timestamptz, NOW()),
          $21,$22,$23,$24,$25,$26
        ) RETURNING *`,
        [
          id, b.board_id, b.nome ?? '', b.tipo ?? '', b.empresa ?? '', b.telefone ?? '',
          b.dia_contato ?? '', b.ligacao ?? '', b.status ?? '',
          b.agendamento ?? '', b.retornar ?? '', b.responsavel ?? '', b.sdr ?? '', b.numero ?? '',
          b.dor_cliente ?? '', b.numero_atendentes ?? '', b.valor_mrr ?? '', b.valor_implementacao ?? '',
          position, b.created_at ?? null,
          b.fechamento ?? '', b.venda_origem_id ?? null, b.mrr_pendente ?? true, b.impl_pendente ?? true,
          b.observacoes ?? '', b.veio_do_funil ?? false,
        ]
      );
      void getActorName(sub).then((actorName) => logLeadEvent(id, 'created', null, null, actorName));
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

      // Snapshot "antes" só dos campos rastreados na linha do tempo — pra saber o que
      // realmente mudou depois do UPDATE (nada disso roda se não tiver campo rastreado no patch).
      const trackedKeys = Object.keys(patch).filter((k) => k in TRACKED_FIELDS || k === 'board_id');
      const before = trackedKeys.length
        ? await queryOne<{ status: string; dia_contato: string; sdr: string; retornado: boolean; board_id: string }>(
            'SELECT status, dia_contato, sdr, retornado, board_id FROM lead_rows WHERE id = $1',
            [req.params.id]
          )
        : null;

      params.push(req.params.id);
      const [leadRow] = await query(
        `UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!leadRow) return reply.status(404).send({ message: 'Linha não encontrada' });

      // Corrigir o MRR/Implementação numa venda sincronizada (ex.: desconto fechado depois)
      // atualiza o valor "oficial" no lead de origem também — só nesse sentido (Vendas -> CRM),
      // nunca o contrário, senão editar o lead depois apagaria a correção feita na venda.
      const vendaOrigemId = (leadRow as { venda_origem_id?: string | null }).venda_origem_id;
      if (vendaOrigemId && ('valor_mrr' in patch || 'valor_implementacao' in patch)) {
        const originSets: string[] = [];
        const originParams: unknown[] = [];
        let j = 1;
        if ('valor_mrr' in patch) { originSets.push(`valor_mrr = $${j++}`); originParams.push(patch.valor_mrr); }
        if ('valor_implementacao' in patch) { originSets.push(`valor_implementacao = $${j++}`); originParams.push(patch.valor_implementacao); }
        originParams.push(vendaOrigemId);
        void query(`UPDATE lead_rows SET ${originSets.join(', ')} WHERE id = $${j}`, originParams)
          .catch((err) => console.error('[vendas] falha ao propagar valor pro lead de origem', vendaOrigemId, err));
      }

      if (before) {
        void (async () => {
          const actorName = await getActorName(sub);
          for (const key of trackedKeys) {
            if (key === 'board_id') {
              const fromId = before.board_id;
              const toId = patch.board_id as string;
              if (fromId === toId) continue;
              const [fromBoard, toBoard] = await Promise.all([
                queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [fromId]),
                queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [toId]),
              ]);
              await logLeadEvent(req.params.id, 'board', fromBoard?.name ?? null, toBoard?.name ?? null, actorName);
              continue;
            }
            const type = TRACKED_FIELDS[key];
            const fromVal = before[key as 'status' | 'dia_contato' | 'sdr' | 'retornado'];
            const toVal = patch[key];
            if (String(fromVal ?? '') === String(toVal ?? '')) continue;
            // Marcar/desmarcar "Vendido" reflete na aba Vendas — mesmo lugar onde a linha do
            // tempo já detecta a troca de status, pra não varrer o status em dois pontos.
            if (key === 'status') {
              await syncVendaFromStatus(req.params.id, String(fromVal ?? ''), String(toVal ?? ''));
            }
            await logLeadEvent(
              req.params.id,
              type,
              fromVal === null || fromVal === undefined ? null : String(fromVal),
              toVal === null || toVal === undefined ? null : String(toVal),
              actorName
            );
          }
        })();
      }

      return leadRow;
    }
  );

  // DELETE /api/lead-rows/:id — soft delete (marca deleted_at, não apaga de verdade) pra dar
  // pra restaurar depois pela Lixeira. `reason` é opcional (só a aba Vendas pede motivo hoje).
  app.delete<{ Params: { id: string }; Body: { reason?: string } | undefined }>(
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
      const reason = req.body?.reason?.trim() || null;
      await query('UPDATE lead_rows SET deleted_at = NOW(), delete_reason = $2 WHERE id = $1', [req.params.id, reason]);
      return reply.status(204).send();
    }
  );

  // POST /api/lead-rows/:id/restore — tira da Lixeira, volta a aparecer normal no quadro.
  app.post<{ Params: { id: string } }>(
    '/api/lead-rows/:id/restore',
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
      const [row] = await query('UPDATE lead_rows SET deleted_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
      if (!row) return reply.status(404).send({ message: 'Linha não encontrada' });
      return row;
    }
  );

  // GET /api/lead-events?page=xxx&from=iso&to=iso — log de tudo que aconteceu numa aba (todos os
  // SDRs/leads dela), pro botão "Log" ao lado de Filtro. from/to são timestamps ISO já calculados
  // no fuso do navegador (evita ambiguidade de "hoje"/"ontem" por fuso do servidor). Mesmas 500
  // mais recentes DENTRO do período, sem paginação — o filtro de data entra na query, não só no
  // front, senão um dia muito movimentado empurra dias mais antigos pra fora do LIMIT antes mesmo
  // de filtrar.
  app.get<{ Querystring: { lead_row_id?: string; page?: string; from?: string; to?: string } }>(
    '/api/lead-events',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);

      if (req.query.page) {
        const boardRows = await query<{ id: string }>('SELECT id FROM lead_boards WHERE page = $1', [req.query.page]);
        let boardIds = boardRows.map((r) => r.id);
        if (allowed !== null) boardIds = boardIds.filter((id) => allowed.includes(id));
        if (!boardIds.length) return [];
        const dateFilter = req.query.from && req.query.to ? 'AND le.created_at >= $2 AND le.created_at < $3' : '';
        const params: unknown[] = [boardIds];
        if (req.query.from && req.query.to) params.push(req.query.from, req.query.to);
        return query(
          `SELECT le.*, lr.nome AS lead_nome, lr.sdr AS lead_sdr
           FROM lead_events le
           JOIN lead_rows lr ON lr.id = le.lead_row_id
           WHERE lr.board_id = ANY($1) ${dateFilter}
           ORDER BY le.created_at DESC
           LIMIT 500`,
          params
        );
      }

      if (!req.query.lead_row_id) return reply.status(400).send({ message: 'lead_row_id ou page é obrigatório' });
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
        'SELECT * FROM lead_events WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [req.query.lead_row_id]
      );
    }
  );

  // GET /api/lead-activity — quando cada lead teve o "Dia de contato" alterado pela última vez
  // (ou a data de criação, se nunca mudou) — usado pra sinalizar quem está parado há mais de
  // 24h sem o SDR mexer (painel do dia, cartão "Status não atualizado").
  app.get('/api/lead-activity', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null && !allowed.length) return [];

    const boardFilter = allowed !== null ? 'WHERE lr.board_id = ANY($1)' : '';
    const params: unknown[] = allowed !== null ? [allowed] : [];

    return query(
      `SELECT lr.id, lr.board_id,
        COALESCE(
          (SELECT le.created_at FROM lead_events le
           WHERE le.lead_row_id = lr.id AND le.type = 'dia_contato'
           ORDER BY le.created_at DESC LIMIT 1),
          lr.created_at
        ) AS dia_contato_updated_at
       FROM lead_rows lr
       ${boardFilter}`,
      params
    );
  });

  // GET /api/lead-milestones — status "que conta" de cada lead (Reunião agendada / Reunião
  // não comparecida / Vendido), pro Dashboard de SDR. "milestone" é sempre o STATUS ATUAL do
  // lead (só isso — se não for um dos três, não tem milestone) — NÃO o "último evento desse tipo
  // na história". Um lead marcado Vendido e depois mudado pra outro status (ex.: "Disparo em
  // massa") tem que SAIR da contagem de vendas: contar pelo último evento do tipo, ignorando
  // mudanças posteriores pra status não-milestone, inflava vendas/no-show com gente que já foi
  // corrigido/mudado de status depois.
  // "ever_agendada" (denominador do funil) exige um CAMINHO VÁLIDO: o status ATUAL tem que ser
  // Reunião agendada, Reunião não comparecida, Proposta Enviada, Follow-up Propostas ou Vendido —
  // ou seja, ou está agendado agora, ou seguiu o funil esperado dali em diante. NÃO basta ter tido
  // um evento de "virou Reunião agendada" em algum momento da história: se o SDR errou (marcou
  // Reunião agendada por engano e corrigiu pra outro status fora desse caminho, tipo "Disparo em
  // massa" ou de volta pra "Primeiro Contato"), isso não é um agendamento de verdade e não deve
  // contar — só o histórico de evento, sem olhar o status atual, deixava esse erro contando pra
  // sempre.
  // "milestone_at" é a data do evento de status mais recente do lead (se o status atual bate com
  // o milestone, foi essa mudança que colocou ele lá). "first_agendada_at" é a data do PRIMEIRO
  // "Reunião agendada" da história — fica fixa mesmo com reagendamento depois de um no-show.
  // EXCLUI quadros marcados is_vendas: quando um lead vira "Vendido", o app cria uma cópia dele
  // (oportunidade) no quadro de Vendas (ver comentário em POST/PATCH lead-rows) — sem excluir
  // esses quadros aqui, a mesma venda contava duas vezes (o lead original marcado Vendido E a
  // cópia da oportunidade), inflando "Vendas fechadas" nas métricas de SDR/Painel do Mês.
  app.get('/api/lead-milestones', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null && !allowed.length) return [];

    const boardFilter = allowed !== null ? 'AND lr.board_id = ANY($4)' : '';
    const params: unknown[] = [MILESTONE_STATUSES, POST_AGENDAMENTO_STATUSES, MILESTONE_AGENDADA];
    if (allowed !== null) params.push(allowed);

    // "ever_agendada" exige as DUAS coisas: o status atual estar no caminho válido pós-agendamento
    // (evita contar quem teve "Reunião agendada" corrigida por engano depois pra fora do caminho,
    // ver comentário acima) E o lead ter passado de verdade por "Reunião agendada" em algum
    // momento — current status = $3 (setado direto, sem evento — ex.: importado assim) OU um
    // evento real de status -> "Reunião agendada" no histórico. Sem essa segunda checagem, um lead
    // que pulou direto de "Primeiro contato" pra "Proposta Enviada" (nunca passou por Agendada)
    // contava como agendado só por o status atual estar no caminho — inflava a métrica de
    // agendamentos com lead que nunca foi agendado de verdade.
    const everAgendadaSql = `(
      lr.status = ANY($2) AND (
        lr.status = $3
        OR EXISTS (
          SELECT 1 FROM lead_events le
          WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = $3
        )
      )
    )`;

    return query(
      `SELECT lr.id, lr.board_id, lr.sdr,
        CASE WHEN lr.status = ANY($1) THEN lr.status END AS milestone,
        CASE WHEN lr.status = ANY($1) THEN
          COALESCE(
            (SELECT le.created_at FROM lead_events le
             WHERE le.lead_row_id = lr.id AND le.type = 'status'
             ORDER BY le.created_at DESC LIMIT 1),
            lr.created_at
          )
        END AS milestone_at,
        ${everAgendadaSql} AS ever_agendada,
        CASE WHEN ${everAgendadaSql} THEN
          COALESCE(
            (SELECT MIN(le.created_at) FROM lead_events le
             WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = $3),
            lr.created_at
          )
        END AS first_agendada_at
       FROM lead_rows lr
       JOIN lead_boards lb ON lb.id = lr.board_id
       WHERE lb.is_vendas = false
       ${boardFilter}`,
      params
    );
  });

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
      const hasAttachments = Array.isArray(b.attachments) && b.attachments.length > 0;
      // Conteúdo é opcional quando tem anexo — mandar só um print/arquivo sem texto é válido.
      if (!b.lead_row_id || (!b.content && !hasAttachments)) {
        return reply.status(400).send({ message: 'lead_row_id é obrigatório, e content ou attachments também' });
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
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments, created_at)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW())) RETURNING *`,
        [
          b.lead_row_id, authorId ?? null, b.author_name ?? 'Alguém', b.content ?? '',
          JSON.stringify(b.attachments ?? []), b.created_at ?? null,
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
