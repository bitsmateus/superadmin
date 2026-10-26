import { FastifyInstance, FastifyRequest } from 'fastify';
import { query, queryOne } from '../db.js';
import {
  etiquetaDeStatus, idCanonicoDasNotas, logLeadEvent, quadroDoStatus, restrictedBoardFilter, sincronizarContagemNotas,
} from './leadBoards.js';
import { textoParaHtml } from '../lib/integracaoCards.js';
import { abaDeFora } from '../lib/abasJuntas.js';
import { enviarWebhookDaReuniao } from '../jobs/reuniaoWebhook.js';
import {
  agendamentoLegivel, agendamentoParaDate, dateParaAgendamento, cardDaPessoa, reunioesPendentes, responsaveisDaReuniao,
  linkDeReuniao, rotuloDoEvento, textoDaNotaDeResultado, validarResultado, chaveDaReuniao, ESPERA_MS,
  type CandidatoReuniao, type CamposDoCard, type ResultadoValidado,
} from '../lib/reuniaoResultado.js';

/**
 * Popup obrigatório de resultado da reunião. Card em "Reunião agendada" (qualquer CRM do Comercial) com o
 * Agendamento passado há 1h ou mais e sem resultado vira pendência de quem faz a reunião: primeiro o dono do CRM do
 * closer (se a lead tem a cópia lá); sem resposta em 2h, também o SDR da lead original (ver responsaveisDaReuniao).
 * Admin não recebe o popup. O resultado move o card pela MESMA rota
 * da tela (PATCH /api/lead-rows/:id), então espelho, venda, histórico e regras de status valem igual.
 *
 * Só cobra reuniões a partir de REUNIAO_RESULTADO_DESDE (padrão: o dia em que o popup entrou), pra não despejar
 * meses de cards parados em "Reunião agendada" de uma vez.
 */
const DESDE = process.env.REUNIAO_RESULTADO_DESDE || '2026-10-23T00:00';

interface Candidato extends CandidatoReuniao {
  sdr: string;
  pagina: string;
  nomeDaPagina: string;
  nome: string;
  empresa: string;
  telefone: string;
  dor_cliente: string;
  observacoes: string;
  last_note_preview: string;
}

/** As reuniões pendentes que esta pessoa tem que resolver. */
async function pendenciasDe(userId: string, role: string) {
  const agora = new Date();
  const ate = dateParaAgendamento(new Date(agora.getTime() - ESPERA_MS));
  const rows = await query<{
    id: string; familia: string; eh_copia_closer: boolean; agendamento: string; sdr: string; pagina: string;
    nome_da_pagina: string; board_id: string; nome: string; empresa: string; telefone: string; dor_cliente: string;
    observacoes: string; last_note_preview: string;
  }>(
    `SELECT r.id, COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id) AS familia,
            (r.espelho_origem_id IS NOT NULL) AS eh_copia_closer, r.agendamento, COALESCE(r.sdr, '') AS sdr,
            lb.page AS pagina, lp.name AS nome_da_pagina, r.board_id, COALESCE(r.nome, '') AS nome,
            COALESCE(r.empresa, '') AS empresa, COALESCE(r.telefone, '') AS telefone,
            COALESCE(r.dor_cliente, '') AS dor_cliente, COALESCE(r.observacoes, '') AS observacoes,
            COALESCE(r.last_note_preview, '') AS last_note_preview
     FROM lead_rows r
     JOIN lead_boards lb ON lb.id = r.board_id
     JOIN lead_pages lp ON lp.id = lb.page
     WHERE r.deleted_at IS NULL AND lp.archived_at IS NULL AND lp.section = 'comercial'
       AND NOT lb.is_vendas AND NOT lb.is_contrato AND lower(lb.name) LIKE '%agendada%'
       AND r.agendamento ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' AND r.agendamento >= $1 AND r.agendamento <= $2`,
    [DESDE, ate]
  );
  if (!rows.length) return [];

  const candidatos: Candidato[] = rows.map((r) => ({
    ...r, ehCopiaCloser: r.eh_copia_closer, nomeDaPagina: r.nome_da_pagina,
  }));
  const familias = [...new Set(candidatos.map((c) => c.familia))];
  const [respondidas, sdrs, profile, originais, paginas] = await Promise.all([
    query<{ lead_row_id: string; agendamento: string }>(
      'SELECT lead_row_id, agendamento FROM reuniao_resultados WHERE lead_row_id = ANY($1::uuid[])', [familias]
    ),
    query<{ name: string }>(`SELECT DISTINCT name FROM lead_labels WHERE field = 'sdr'`),
    queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [userId]),
    query<{ id: string; sdr: string; pagina: string; nome_da_pagina: string }>(
      `SELECT r.id, COALESCE(r.sdr, '') AS sdr, lb.page AS pagina, lp.name AS nome_da_pagina FROM lead_rows r
       JOIN lead_boards lb ON lb.id = r.board_id JOIN lead_pages lp ON lp.id = lb.page WHERE r.id = ANY($1::uuid[])`,
      [familias]
    ),
    query<{ id: string; name: string }>('SELECT id, name FROM lead_pages'),
  ]);
  const feitas = new Set(respondidas.map((r) => chaveDaReuniao(r.lead_row_id, r.agendamento)));
  const nomeDasSdrs = sdrs.map((s) => s.name);
  const nomeDaPagina = (id: string | undefined) => paginas.find((p) => p.id === id)?.name ?? '';
  const allowed = await restrictedBoardFilter(userId, role);
  const podeVer = (boardId: string) => allowed === null || allowed.includes(boardId);

  const minhas: { card: Candidato; responsavel: string }[] = [];
  for (const r of reunioesPendentes(candidatos, feitas, agora, agendamentoParaDate(DESDE) ?? new Date(0))) {
    const o = originais.find((x) => x.id === r.familia);
    const resp = responsaveisDaReuniao(
      r,
      o && { sdr: o.sdr, nomeDaPagina: o.nome_da_pagina, nomeDaAbaDeFora: nomeDaPagina(abaDeFora(o.pagina)) },
      (c) => c.nomeDaPagina,
      nomeDasSdrs,
    );
    const card = cardDaPessoa(r, resp, profile?.name || '', podeVer, agora);
    if (card) minhas.push({ card, responsavel: resp.primario || resp.secundario });
  }
  if (!minhas.length) return [];

  // CRM de origem (o da lead original) e o link da reunião, se alguém colou nas Atualizações.
  const ids = minhas.map((p) => p.card.familia);
  const notas = await query<{ lead_row_id: string; content: string }>(
    `SELECT lead_row_id, content FROM lead_notes
     WHERE lead_row_id = ANY($1::uuid[]) AND content ~* '(meet\\.google|zoom\\.us|teams\\.(microsoft|live))'
     ORDER BY created_at DESC`,
    [ids]
  );
  const origens = originais;
  return minhas.map(({ card, responsavel }) => {
    const origem = origens.find((o) => o.id === card.familia);
    return {
      card_id: card.id,
      familia: card.familia,
      nome: card.nome,
      empresa: card.empresa,
      telefone: card.telefone,
      crm: origem?.nome_da_pagina ?? card.nomeDaPagina,
      crm_do_card: card.nomeDaPagina,
      agendamento: card.agendamento.slice(0, 16),
      responsavel,
      link: linkDeReuniao(...notas.filter((n) => n.lead_row_id === card.familia).map((n) => n.content), card.observacoes),
      dor: card.dor_cliente,
      resumo: card.last_note_preview,
    };
  });
}

export async function reunioesRoutes(app: FastifyInstance) {
  // GET /api/reunioes/pendentes — as reuniões que o usuário logado precisa resolver (mais antiga primeiro).
  app.get('/api/reunioes/pendentes', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    return pendenciasDe(sub, role);
  });

  // POST /api/reunioes/:cardId/resultado — { resultado, resumo?, proxima_etapa?, motivo?, motivo_outro?, agendamento_novo? }
  app.post<{ Params: { cardId: string }; Body: unknown }>(
    '/api/reunioes/:cardId/resultado',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const pendencia = (await pendenciasDe(sub, role)).find((p) => p.card_id === req.params.cardId);
      if (!pendencia) return reply.status(409).send({ message: 'Essa reunião não está mais pendente pra você.' });

      const card = await queryOne<CamposDoCard & { id: string; page: string; nome: string; telefone: string }>(
        `SELECT r.id, lb.page, COALESCE(r.nome, '') AS nome, COALESCE(r.telefone, '') AS telefone,
                COALESCE(r.numero_atendentes, '') AS numero_atendentes, COALESCE(r.valor_mrr, '') AS valor_mrr,
                COALESCE(r.valor_implementacao, '') AS valor_implementacao, COALESCE(r.retornar, '') AS retornar,
                COALESCE(r.motivo_desqualificacao, '') AS motivo_desqualificacao
         FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id WHERE r.id = $1`,
        [req.params.cardId]
      );
      if (!card) return reply.status(404).send({ message: 'Card não encontrado.' });
      const v = validarResultado(req.body, card, new Date());
      if ('erro' in v) return reply.status(400).send({ message: v.erro });
      const r: ResultadoValidado = v.ok;

      const usuario = await queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [sub]);
      const nomeDoUsuario = usuario?.name || usuario?.email || 'Alguém';

      // Reserva a reunião antes de mexer no card: dois cliques (ou duas pessoas) ao mesmo tempo não respondem duas vezes.
      const reserva = await queryOne<{ id: string }>(
        `INSERT INTO reuniao_resultados
           (lead_row_id, card_id, agendamento, resultado, proxima_etapa, motivo, resumo, agendamento_novo, user_id, user_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (lead_row_id, agendamento) DO NOTHING RETURNING id`,
        [pendencia.familia, card.id, pendencia.agendamento, r.resultado, r.proximaEtapa, r.motivo, r.resumo,
          r.agendamentoNovo, sub, nomeDoUsuario]
      );
      if (!reserva) return reply.status(409).send({ message: 'Alguém já registrou o resultado dessa reunião.' });

      // O card anda pela rota da tela (com o login de quem respondeu): mesmas regras e efeitos de mexer na ficha.
      const patch: Record<string, unknown> = {};
      if (r.agendamentoNovo) patch.agendamento = r.agendamentoNovo;
      else if (r.proximaEtapa) {
        const quadro = await quadroDoStatus(card.page, r.proximaEtapa);
        if (quadro) patch.board_id = quadro;
        else patch.status = (await etiquetaDeStatus(card.page, r.proximaEtapa)) ?? r.proximaEtapa;
      }
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/lead-rows/${card.id}`,
        headers: { authorization: (req as FastifyRequest).headers.authorization ?? '', 'content-type': 'application/json' },
        payload: JSON.stringify(patch),
      });
      if (res.statusCode >= 400) {
        await query('DELETE FROM reuniao_resultados WHERE id = $1', [reserva.id]);
        let corpo: unknown = { message: 'Não deu pra atualizar o card.' };
        try { corpo = res.json(); } catch { /* resposta sem JSON */ }
        return reply.status(res.statusCode).send(corpo);
      }

      // Atualização (no histórico da original, que os dois CRMs leem) + Linha do tempo.
      const texto = textoDaNotaDeResultado(r, pendencia.agendamento, card);
      const canonico = await idCanonicoDasNotas(card.id);
      await query(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, $2, $3, $4, '[]')`,
        [canonico, sub, nomeDoUsuario, textoParaHtml(texto)]
      );
      await sincronizarContagemNotas(canonico);
      await logLeadEvent(canonico, 'reuniao', agendamentoLegivel(pendencia.agendamento), rotuloDoEvento(r), nomeDoUsuario)
        .catch((err) => console.error('[reuniao] falha ao gravar na linha do tempo', canonico, err));

      // Aviso pro n8n em background: grava se chegou, e o que falhar é reenviado (jobs/reuniaoWebhook.ts).
      void enviarWebhookDaReuniao(reserva.id);

      return { ok: true, resultado: r.resultado };
    }
  );
}
