import { FastifyInstance, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import {
  etiquetaDeStatus, idCanonicoDasNotas, logLeadEvent, quadroDoStatus, restrictedBoardFilter, sincronizarContagemNotas,
} from './leadBoards.js';
import { textoParaHtml } from '../lib/integracaoCards.js';
import { agendamentoParaDate, dateParaAgendamento, donoDaAba, ehAPessoa } from '../lib/reuniaoResultado.js';
import {
  PAGINA_DO_CLOSER, contarHistorico, ehQuadroDeProposta, rotuloDoEventoDeRetorno, textoDaNotaDeRetorno, validarRetorno,
} from '../lib/retornoProposta.js';

/**
 * Popup obrigatório do retorno da proposta (CRM LUIS CLOSER). Card em "Proposta enviada"/"Follow-up Propostas" com o
 * "Retornar" vencido e sem "retornado" vira pendência do dono do CRM do closer — só dele (não repassa, admin não
 * recebe). O resultado mexe no card pela MESMA rota da tela (PATCH /api/lead-rows/:id): espelho, venda e regras de
 * status valem igual. Nada de campo novo: o registro vai pras Atualizações e pra Linha do tempo (evento "retorno").
 *
 * Só cobra retornos a partir de RETORNO_PROPOSTA_DESDE (padrão: o dia em que o popup entrou), pra não despejar de uma
 * vez as propostas antigas com o Retornar vencido.
 */
const DESDE = process.env.RETORNO_PROPOSTA_DESDE || '2026-10-26T00:00';

async function pendenciasDe(userId: string, role: string) {
  const agora = new Date();
  const rows = await query<{
    id: string; familia: string; nome: string; empresa: string; telefone: string; retornar: string; coluna: string;
    nome_da_pagina: string; board_id: string; valor_mrr: string; valor_implementacao: string; origem: string;
    do_anuncio: boolean; resumo: string; crm_de_origem: string | null;
  }>(
    `SELECT r.id, COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id) AS familia, COALESCE(r.nome, '') AS nome,
            COALESCE(r.empresa, '') AS empresa, COALESCE(r.telefone, '') AS telefone, r.retornar, lb.name AS coluna,
            lp.name AS nome_da_pagina, r.board_id, COALESCE(r.valor_mrr, '') AS valor_mrr,
            COALESCE(r.valor_implementacao, '') AS valor_implementacao, COALESCE(r.origem, '') AS origem,
            (r.meta_lead_id IS NOT NULL) AS do_anuncio,
            COALESCE(NULLIF(o.last_note_preview, ''), r.last_note_preview, '') AS resumo, olp.name AS crm_de_origem
     FROM lead_rows r
     JOIN lead_boards lb ON lb.id = r.board_id
     JOIN lead_pages lp ON lp.id = lb.page
     LEFT JOIN lead_rows o ON o.id = COALESCE(r.espelho_origem_id, r.copia_ia_origem_id)
     LEFT JOIN lead_boards olb ON olb.id = o.board_id
     LEFT JOIN lead_pages olp ON olp.id = olb.page
     WHERE lb.page = $1 AND r.deleted_at IS NULL AND lp.archived_at IS NULL AND NOT COALESCE(r.retornado, false)
       AND r.retornar ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' AND r.retornar >= $2 AND r.retornar <= $3`,
    [PAGINA_DO_CLOSER, DESDE, dateParaAgendamento(agora)]
  );
  const vencidos = rows.filter((r) => ehQuadroDeProposta(r.coluna) && agendamentoParaDate(r.retornar));
  if (!vencidos.length) return [];

  // Só o dono do CRM do closer (pelo nome da aba, ex.: "CRM LUIS CLOSER" -> "Luis"), e só se ele enxerga o quadro.
  const [sdrs, profile] = await Promise.all([
    query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`),
    queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [userId]),
  ]);
  const dono = donoDaAba(vencidos[0].nome_da_pagina, sdrs.map((s) => s.name));
  if (!ehAPessoa(dono, profile?.name || '')) return [];
  const allowed = await restrictedBoardFilter(userId, role);
  const meus = vencidos.filter((r) => allowed === null || allowed.includes(r.board_id));
  if (!meus.length) return [];

  // Tentativas e adiamentos saem da Linha do tempo (a cópia usa a da original).
  const eventos = await query<{ lead_row_id: string; to_value: string }>(
    `SELECT lead_row_id, COALESCE(to_value, '') AS to_value FROM lead_events
     WHERE type = 'retorno' AND lead_row_id = ANY($1::uuid[]) ORDER BY created_at DESC`,
    [meus.map((r) => r.familia)]
  );
  return meus
    .sort((a, b) => a.retornar.localeCompare(b.retornar))
    .map((r) => {
      const h = contarHistorico(eventos.filter((e) => e.lead_row_id === r.familia).map((e) => e.to_value));
      return {
        card_id: r.id, familia: r.familia, nome: r.nome, empresa: r.empresa, telefone: r.telefone,
        retornar: r.retornar.slice(0, 16), coluna: r.coluna, crm_de_origem: r.crm_de_origem,
        valor_mrr: r.valor_mrr, valor_implementacao: r.valor_implementacao,
        origem: r.origem || (r.do_anuncio ? 'meta' : ''), resumo: r.resumo,
        tentativas: h.tentativas, adiamentos: h.adiamentos,
      };
    });
}

export async function retornosRoutes(app: FastifyInstance) {
  // GET /api/retornos/pendentes — os retornos de proposta vencidos que o closer logado precisa registrar.
  app.get('/api/retornos/pendentes', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    return pendenciasDe(sub, role);
  });

  // POST /api/retornos/:cardId/resultado — { resultado, observacao, desfecho?, retornar_novo?, motivo?,
  //   motivo_detalhe?, valor_mrr?, valor_implementacao?, origem?, mover_follow_up? }
  app.post<{ Params: { cardId: string }; Body: unknown }>(
    '/api/retornos/:cardId/resultado',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const pendencia = (await pendenciasDe(sub, role)).find((p) => p.card_id === req.params.cardId);
      if (!pendencia) return reply.status(409).send({ message: 'Esse retorno não está mais pendente pra você.' });
      const v = validarRetorno(req.body, new Date(), pendencia);
      if ('erro' in v) return reply.status(400).send({ message: v.erro });
      const r = v.ok;

      // O que muda no card.
      const patch: Record<string, unknown> = {};
      const irPara = async (etapa: string) => {
        const quadro = await quadroDoStatus(PAGINA_DO_CLOSER, etapa);
        if (quadro) patch.board_id = quadro;
        else patch.status = (await etiquetaDeStatus(PAGINA_DO_CLOSER, etapa)) ?? etapa;
      };
      if (r.retornarNovo) { patch.retornar = r.retornarNovo; patch.retornado = false; }
      if (r.desfecho === 'fechou') {
        await irPara('Vendido');
        patch.valor_mrr = r.valorMrr;
        patch.valor_implementacao = r.valorImplementacao;
        if (!pendencia.origem || r.origem !== pendencia.origem) patch.origem = r.origem;
      } else if (r.desfecho === 'perdeu') {
        await irPara('Perdidos');
        patch.motivo_desqualificacao = r.motivoPerda;
      } else if (r.moverProFollowUp) {
        await irPara('Follow-up Propostas');
      }
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lead-rows/${pendencia.card_id}`,
        headers: { authorization: (req as FastifyRequest).headers.authorization ?? '', 'content-type': 'application/json' },
        payload: JSON.stringify(patch),
      });
      if (res.statusCode >= 400) {
        let corpo: unknown = { message: 'Não deu pra atualizar o card.' };
        try { corpo = res.json(); } catch { /* resposta sem JSON */ }
        return reply.status(res.statusCode).send(corpo);
      }

      // Atualização (no nome do closer) + Linha do tempo — é daí que saem as contas de tentativas e adiamentos.
      const usuario = await queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [sub]);
      const nomeDoUsuario = usuario?.name || usuario?.email || 'Alguém';
      const tentativaDeAgora = pendencia.tentativas + 1;
      const canonico = await idCanonicoDasNotas(pendencia.card_id);
      await query(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, $2, $3, $4, '[]')`,
        [canonico, sub, nomeDoUsuario, textoParaHtml(textoDaNotaDeRetorno(r, pendencia.retornar, tentativaDeAgora))]
      );
      await sincronizarContagemNotas(canonico);
      await logLeadEvent(canonico, 'retorno', null, rotuloDoEventoDeRetorno(r, tentativaDeAgora), nomeDoUsuario)
        .catch((err) => console.error('[retorno] falha ao gravar na linha do tempo', canonico, err));
      return { ok: true };
    }
  );
}
