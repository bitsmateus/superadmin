import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { restrictedBoardFilter } from './leadBoards.js';
import { renderContractPdf } from '../lib/contractPdf.js';
import { advanceClientToBriefing } from '../lib/briefingHandoff.js';

/**
 * Aba Contrato (Dashboard Comercial) — modelo(s) padrão + contratos gerados por cliente. Reusa a
 * mesma checagem de acesso por quadro (restrictedBoardFilter) já usada em lead-boards/lead-rows,
 * já que cada contrato pertence a um board_id de um quadro comum.
 */

export async function contractRoutes(app: FastifyInstance) {
  // ---------- Modelos ----------

  app.get('/api/contract-templates', { onRequest: [app.authenticate] }, async () => {
    return query('SELECT * FROM contract_templates ORDER BY created_at');
  });

  app.patch<{ Params: { id: string }; Body: { name?: string; conteudo?: string } }>(
    '/api/contract-templates/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.name !== undefined) { sets.push(`name = $${i++}`); params.push(req.body.name); }
      if (req.body.conteudo !== undefined) { sets.push(`conteudo = $${i++}`); params.push(req.body.conteudo); }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);

      params.push(req.params.id);
      const [tpl] = await query(`UPDATE contract_templates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
      if (!tpl) return reply.status(404).send({ message: 'Modelo não encontrado' });
      return tpl;
    }
  );

  // ---------- Contratos ----------

  app.get('/api/contracts', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null && !allowed.length) return [];
    if (allowed !== null) {
      return query('SELECT * FROM contracts WHERE board_id = ANY($1) ORDER BY created_at DESC', [allowed]);
    }
    return query('SELECT * FROM contracts ORDER BY created_at DESC');
  });

  app.post<{ Body: {
    boardId?: string; templateId?: string | null; campos?: Record<string, string>; conteudo?: string
    vendaLeadId?: string | null; clientId?: string | null
  } }>(
    '/api/contracts',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const boardId = req.body.boardId;
      if (!boardId) return reply.status(400).send({ message: 'boardId é obrigatório' });

      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(boardId)) return reply.status(403).send({ message: 'Acesso negado' });

      const [contract] = await query(
        `INSERT INTO contracts (board_id, template_id, campos, conteudo, venda_lead_id, client_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          boardId, req.body.templateId ?? null, JSON.stringify(req.body.campos ?? {}), req.body.conteudo ?? '',
          req.body.vendaLeadId ?? null, req.body.clientId ?? null,
        ]
      );
      return reply.status(201).send(contract);
    }
  );

  app.patch<{ Params: { id: string }; Body: {
    campos?: Record<string, string>; conteudo?: string; status?: 'pendente' | 'assinado'
    autentiqueDocumentId?: string | null; vendaLeadId?: string | null
  } }>(
    '/api/contracts/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const [current] = await query<{ board_id: string }>('SELECT board_id FROM contracts WHERE id = $1', [req.params.id]);
        if (!current || !allowed.includes(current.board_id)) return reply.status(403).send({ message: 'Acesso negado' });
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (req.body.campos !== undefined) { sets.push(`campos = $${i++}`); params.push(JSON.stringify(req.body.campos)); }
      if (req.body.conteudo !== undefined) { sets.push(`conteudo = $${i++}`); params.push(req.body.conteudo); }
      if (req.body.autentiqueDocumentId !== undefined) { sets.push(`autentique_document_id = $${i++}`); params.push(req.body.autentiqueDocumentId); }
      if (req.body.vendaLeadId !== undefined) { sets.push(`venda_lead_id = $${i++}`); params.push(req.body.vendaLeadId); }
      if (req.body.status !== undefined) {
        sets.push(`status = $${i++}`); params.push(req.body.status);
        // signed_at é derivada do status, não vem do cliente — evita relógio do navegador
        // divergir do servidor e mantém "quando foi assinado" consistente com "está assinado".
        sets.push(req.body.status === 'assinado' ? `signed_at = NOW()` : `signed_at = NULL`);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      sets.push(`updated_at = NOW()`);

      params.push(req.params.id);
      const [contract] = await query<{ id: string; client_id: string | null; status: string }>(
        `UPDATE contracts SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params
      );
      if (!contract) return reply.status(404).send({ message: 'Contrato não encontrado' });
      // Mesma etapa "Contrato -> Briefing" que o webhook do Autentique dispara sozinho — aqui é o
      // caminho manual ("Marcar como assinado" na tela), unificado no mesmo lugar pra não ter duas
      // implementações da mesma regra (ver server/src/lib/briefingHandoff.ts).
      if (req.body.status === 'assinado' && contract.client_id) {
        await advanceClientToBriefing(contract.client_id);
      }
      return contract;
    }
  );

  // POST /api/contracts/:id/pdf — gera o PDF de verdade no servidor (Chromium headless), sem
  // diálogo de impressão do navegador e sem o cabeçalho/rodapé que ele sempre adiciona. Recebe o
  // HTML atual do corpo no body (em vez de reler do banco) pra pegar edição não salva ainda,
  // exatamente igual `openContractSheet` já fazia com window.print().
  app.post<{ Params: { id: string }; Body: { html?: string; title?: string } }>(
    '/api/contracts/:id/pdf',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const [current] = await query<{ board_id: string }>('SELECT board_id FROM contracts WHERE id = $1', [req.params.id]);
        if (!current || !allowed.includes(current.board_id)) return reply.status(403).send({ message: 'Acesso negado' });
      }
      const html = req.body.html;
      if (!html) return reply.status(400).send({ message: 'html é obrigatório' });
      try {
        const pdf = await renderContractPdf(html, req.body.title ?? 'Contrato');
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', 'attachment; filename="contrato.pdf"');
        return reply.send(pdf);
      } catch (err) {
        app.log.error({ err }, 'Falha ao gerar PDF do contrato');
        return reply.status(500).send({ message: 'Falha ao gerar o PDF — tenta de novo.' });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/contracts/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const [current] = await query<{ board_id: string }>('SELECT board_id FROM contracts WHERE id = $1', [req.params.id]);
        if (!current || !allowed.includes(current.board_id)) return reply.status(403).send({ message: 'Acesso negado' });
      }
      await query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );
}
