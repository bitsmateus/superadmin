import { FastifyInstance } from 'fastify';
import { query, queryOne, queryAsActor, withTransaction } from '../db.js';
import {
  idCanonicoDasNotas, logLeadEvent, propagarEspelho, sincronizarContagemNotas, statusDoQuadro, syncCopiaDaIa,
  syncEspelhoReuniaoAgendada,
} from './leadBoards.js';
import { preencherSdrDaAba } from '../lib/sdrDaAba.js';
import { agendamentoParaIso } from '../lib/reuniaoResultado.js';
import { criarNotificacao, lerNotificacaoDaIntegracao } from '../lib/notificacoes.js';
import { CAMPOS_DA_LINHA_DO_TEMPO, ehCampoDaLinhaDoTempo, registrarMudancaDeCampo } from '../lib/linhaDoTempo.js';
import {
  chaveTelefone, chaveValida, colunasQueCasam, compararAchadosPorTelefone, mesmoTelefone, montarEtiquetas,
  parseDataIntegracao, resolverEtiquetas, resolverQuadro, rotuloDaOrigem, telefoneComDdi, textoDaNota, textoParaHtml,
  validarCriacaoIntegracao, validarPatchIntegracao, type OpcoesEtiqueta,
} from '../lib/integracaoCards.js';

/**
 * API de integração (n8n / réguas de WhatsApp). Protegida por chave no header `x-api-key`, comparada
 * com a env INTEGRACAO_API_KEY. Sem a env configurada, TODAS as rotas respondem 503 (nunca ficam abertas).
 *
 * Regras de segurança desta API:
 *  - NUNCA cria venda nem comissão (não chama syncVendaFromStatus/propagarComissao) e recusa mover card
 *    pra coluna de Vendas/Contrato. Mover pra "Vendido" do funil só troca coluna e status.
 *  - Trocar a coluna registra o histórico (lead_board_history) como "automação".
 *  - Editar um card leva a edição pras outras linhas da mesma lead (cópia do closer / da IA), como na tela.
 */

const ATOR = 'automação';
/** Campos que viram evento na linha do tempo do card (type = nome da coluna). status/dia_contato/sdr já
 * eram rastreados pela tela; tipo/ligacao/followup/disparo entram aqui pra a troca de etiqueta ficar visível. */
const CAMPOS_NA_LINHA_DO_TEMPO = ['status', 'dia_contato', 'sdr', 'tipo', 'ligacao', 'followup', 'disparo'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quem aparece nas Atualizações do card criado pela automação. */
const AUTOR_LUIZA = 'Luiza (SDR IA)';

interface CardRow {
  id: string; nome: string; empresa: string; telefone: string; status: string; sdr: string;
  dor_cliente: string; numero_atendentes: string; entrou_coluna_em: Date | string | null;
  origem: string; nicho: string; ticket_nx: string;
  regua: string; regua_etapa: string; regua_ultimo_envio_em: string | null; regua_status: string; optout: boolean;
  tipo: string; dia_contato: string; ligacao: string; followup: string; disparo: string;
  coluna_id: string; coluna: string; quadro_id: string; quadro: string;
  agendamento: string;
  reuniao_resultado: { resultado: string; agendamento: string; proxima_etapa: string | null; motivo: string | null; usuario: string; em: string } | null;
}

const SELECT_CARD = `
  SELECT r.id, r.nome, r.empresa, r.telefone, r.status, r.sdr, r.dor_cliente, r.numero_atendentes,
         r.entrou_coluna_em, r.regua, r.regua_etapa, r.regua_ultimo_envio_em, r.regua_status, r.optout,
         r.tipo, r.dia_contato, r.ligacao, r.followup, r.disparo,
         r.origem, r.nicho, r.ticket_nx, r.agendamento,
         (SELECT json_build_object('resultado', rr.resultado, 'agendamento', rr.agendamento, 'proxima_etapa', rr.proxima_etapa,
                                   'motivo', rr.motivo, 'usuario', rr.user_name, 'em', rr.created_at)
          FROM reuniao_resultados rr WHERE rr.lead_row_id = COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id)
          ORDER BY rr.created_at DESC LIMIT 1) AS reuniao_resultado,
         lb.id AS coluna_id, lb.name AS coluna, lp.id AS quadro_id, lp.name AS quadro
  FROM lead_rows r
  JOIN lead_boards lb ON lb.id = r.board_id
  JOIN lead_pages lp ON lp.id = lb.page`;

/** Etiquetas cadastradas por aba: devolve uma função page -> (field -> nomes, na ordem da tela). SDR é
 * global (page_id nulo) e vale em todas as abas. */
type OpcoesPorAba = (page: string) => OpcoesEtiqueta;

async function carregarOpcoesEtiqueta(): Promise<OpcoesPorAba> {
  const rows = await query<{ field: string; name: string; page_id: string | null }>(
    'SELECT field, name, page_id FROM lead_labels ORDER BY position, created_at'
  );
  const globais: OpcoesEtiqueta = {};
  const porAba = new Map<string, OpcoesEtiqueta>();
  for (const l of rows) {
    if (l.page_id === null) (globais[l.field] ??= []).push(l.name);
    else {
      const o = porAba.get(l.page_id) ?? {};
      (o[l.field] ??= []).push(l.name);
      porAba.set(l.page_id, o);
    }
  }
  return (page) => ({ ...globais, ...(porAba.get(page) ?? {}) });
}

function cardParaApi(r: CardRow, opcoes: OpcoesPorAba) {
  return {
    id: r.id,
    quadro: r.quadro,
    quadro_id: r.quadro_id,
    nome: r.nome,
    empresa: r.empresa,
    telefone: telefoneComDdi(r.telefone),
    telefone_original: r.telefone,
    coluna: r.coluna,
    coluna_id: r.coluna_id,
    status: r.status,
    entrou_coluna_em: r.entrou_coluna_em,
    regua: r.regua,
    regua_etapa: r.regua_etapa,
    regua_ultimo_envio_em: r.regua_ultimo_envio_em,
    regua_status: r.regua_status,
    optout: r.optout,
    sdr: r.sdr,
    dor_cliente: r.dor_cliente,
    numero_atendentes: r.numero_atendentes,
    origem: r.origem,
    ramo: r.nicho,
    ticket_nx: r.ticket_nx,
    // Horário de Brasília com o fuso ("2026-10-27T09:00:00-03:00"); sem agendamento, null.
    agendamento: agendamentoParaIso(r.agendamento),
    // Último resultado da reunião dessa lead (popup do app); o "agendamento" dele diz de qual horário era.
    reuniao_resultado: r.reuniao_resultado
      ? { ...r.reuniao_resultado, agendamento: agendamentoParaIso(r.reuniao_resultado.agendamento) }
      : null,
    etiquetas: montarEtiquetas(r as unknown as Record<string, string>, opcoes(r.quadro_id)),
  };
}

async function buscarCard(id: string): Promise<CardRow | null> {
  return queryOne<CardRow>(`${SELECT_CARD} WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
}

/**
 * Espelho pro CRM do closer (Luis) quando a API leva um card do CRM do Arthur ou da IA Luiza pra "Reunião agendada".
 *
 * Existe porque o espelho nasce de um efeito colateral do PATCH da TELA (leadBoards.ts), que a API não
 * passa — sem isto o Luis não veria a reunião marcada pela automação. Reaproveita
 * syncEspelhoReuniaoAgendada, a mesma função da tela, então valem as mesmas regras: só cards do
 * CRM do Arthur/IA Luiza que estão em "Reunião agendada", nunca espelha uma cópia, não duplica (índice único em
 * espelho_origem_id) e restaura a cópia se ela tinha sido retirada. Não cria venda nem comissão.
 * Nunca lança (a função da tela já captura os erros): falhar aqui não desfaz a movimentação.
 *
 * As edições seguintes chegam na cópia pelo propagarEspelho, chamado no PATCH da API.
 */
export async function espelharSeReuniaoAgendada(cardId: string): Promise<void> {
  await syncEspelhoReuniaoAgendada(cardId);
}

/** Grava uma Atualização da Luiza no card (texto puro, escapado). Numa cópia, vai pro histórico da original. */
async function anotar(cardId: string, texto: string): Promise<void> {
  const canonico = await idCanonicoDasNotas(cardId);
  await query(
    `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, NULL, $2, $3, '[]')`,
    [canonico, AUTOR_LUIZA, textoParaHtml(texto)]
  );
  await sincronizarContagemNotas(canonico);
}

/** Quadro (aba) pelo id/slug ou nome. Só abas não arquivadas. */
async function acharQuadro(pedido: unknown): Promise<{ id?: string; nome?: string; erro?: string }> {
  const quadros = await query<{ id: string; name: string }>('SELECT id, name FROM lead_pages WHERE archived_at IS NULL');
  const r = resolverQuadro(quadros, pedido);
  return r.id ? { id: r.id, nome: quadros.find((q) => q.id === r.id)?.name } : { erro: r.erro };
}

export async function integracaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/integracao')) return;
    const esperada = process.env.INTEGRACAO_API_KEY?.trim();
    if (!esperada) {
      return reply.status(503).send({ message: 'API de integração desligada: INTEGRACAO_API_KEY não configurada no servidor.' });
    }
    if (!chaveValida(req.headers['x-api-key'], esperada)) {
      return reply.status(401).send({ message: 'Chave de API inválida ou ausente (header x-api-key).' });
    }
  });

  // GET /api/integracao/cards?coluna=NOME&board_id=UUID&quadro=ID_OU_NOME&entrou_depois=DATA&limite=N
  // Lista os cards da coluna em TODOS os quadros (ou só no `quadro` pedido). Fora da lista: cards excluídos, cópias do espelho
  // do closer e da aba Vendas (senão o mesmo telefone receberia a régua duas vezes) e quadros arquivados.
  app.get<{ Querystring: { coluna?: string; board_id?: string; quadro?: string; entrou_depois?: string; limite?: string } }>(
    '/api/integracao/cards',
    async (req, reply) => {
      const { coluna, board_id, entrou_depois } = req.query;
      let quadroId: string | null = null;
      if (req.query.quadro !== undefined) {
        const q = await acharQuadro(req.query.quadro);
        if (q.erro) return reply.status(400).send({ message: q.erro });
        quadroId = q.id!;
      }
      if (!coluna?.trim() && !board_id) return reply.status(400).send({ message: 'Informe "coluna" (nome) e/ou "board_id".' });
      if (board_id && !UUID.test(board_id)) return reply.status(400).send({ message: '"board_id" deve ser um UUID.' });
      let depois: Date | null = null;
      if (entrou_depois) {
        depois = parseDataIntegracao(entrou_depois);
        if (!depois) return reply.status(400).send({ message: '"entrou_depois" inválido. Use AAAA-MM-DD ou data ISO.' });
      }
      const limite = Math.min(Math.max(parseInt(req.query.limite ?? '1000', 10) || 1000, 1), 5000);

      const colunas = await query<{ id: string; name: string; page: string }>(
        `SELECT lb.id, lb.name, lb.page FROM lead_boards lb JOIN lead_pages lp ON lp.id = lb.page
         WHERE lp.archived_at IS NULL`
      );
      const doQuadro = quadroId ? colunas.filter((c) => c.page === quadroId) : colunas;
      let ids = coluna?.trim() ? colunasQueCasam(doQuadro, coluna) : doQuadro.map((c) => c.id);
      if (board_id) ids = ids.filter((id) => id === board_id);
      if (!ids.length) return [];

      const rows = await query<CardRow>(
        `${SELECT_CARD}
         WHERE r.deleted_at IS NULL AND r.espelho_origem_id IS NULL AND r.copia_ia_origem_id IS NULL AND r.venda_origem_id IS NULL
           AND r.board_id = ANY($1) AND ($2::timestamptz IS NULL OR r.entrou_coluna_em > $2)
         ORDER BY r.entrou_coluna_em ASC NULLS LAST, r.created_at ASC
         LIMIT $3`,
        [ids, depois ? depois.toISOString() : null, limite]
      );
      const opcoes = await carregarOpcoesEtiqueta();
      return rows.map((r) => cardParaApi(r, opcoes));
    }
  );

  // GET /api/integracao/cards/telefone/:numero?quadro=ID_OU_NOME — com/sem 55, com/sem o 9.
  // Se houver mais de um card com o número, devolve o original mais recente e lista os demais. Com `quadro`, só
  // os cards daquele quadro.
  app.get<{ Params: { numero: string }; Querystring: { quadro?: string } }>('/api/integracao/cards/telefone/:numero', async (req, reply) => {
    const chave = chaveTelefone(req.params.numero);
    if (!chave) return reply.status(400).send({ message: 'Telefone inválido: informe DDD + número.' });
    let quadroId: string | null = null;
    if (req.query.quadro !== undefined) {
      const q = await acharQuadro(req.query.quadro);
      if (q.erro) return reply.status(400).send({ message: q.erro });
      quadroId = q.id!;
    }
    const candidatos = await query<CardRow & { espelho_origem_id: string | null; copia_ia_origem_id: string | null; venda_origem_id: string | null }>(
      `${SELECT_CARD.replace('SELECT r.id,', 'SELECT r.espelho_origem_id, r.copia_ia_origem_id, r.venda_origem_id, r.id,')}
       WHERE r.deleted_at IS NULL AND lp.archived_at IS NULL
         AND right(regexp_replace(r.telefone, '\\D', '', 'g'), 8) = $1`,
      [chave.ultimos8]
    );
    // entrou_coluna_em chega como Date (ou null): ordenar por timestamp, não por texto.
    const achados = candidatos
      .filter((c) => mesmoTelefone(c.telefone, req.params.numero) && (!quadroId || c.quadro_id === quadroId))
      .map((c) => ({ ...c, copia: !!(c.espelho_origem_id || c.copia_ia_origem_id || c.venda_origem_id) }))
      .sort(compararAchadosPorTelefone);
    if (!achados.length) return reply.status(404).send({ message: 'Nenhum card com esse telefone.' });
    return { ...cardParaApi(achados[0], await carregarOpcoesEtiqueta()), total_encontrados: achados.length, outros_ids: achados.slice(1).map((c) => c.id) };
  });

  // POST /api/integracao/notificacoes — notificação do comercial pro sininho/popup (Arthur e/ou Luis). Tipos:
  // transferencia_ia, reuniao_agendada_ia, resposta_proposta, lead_novo_ia. Campo opcional torto não recusa; tipo
  // desconhecido responde 200 e não cria nada; "destino" é ignorado; "para" troca quem recebe. Sem card_id, acha o card
  // pelo telefone. A mesma (tipo + card) nas últimas 2h não duplica (devolve a que já existe).
  app.post<{ Body: unknown }>('/api/integracao/notificacoes', async (req, reply) => {
    const lido = lerNotificacaoDaIntegracao(req.body);
    if (!('dados' in lido)) return reply.status(200).send({ ignorada: true, message: 'Tipo de notificação desconhecido: ignorado.' });
    const { id, duplicada } = await criarNotificacao(lido.dados, lido.para);
    return reply.status(201).send({ id, duplicada });
  });

  // POST /api/integracao/cards — cria um card. Obrigatórios: quadro, nome, telefone (coluna: a primeira do quadro).
  // Idempotente por quadro: já existe card com esse telefone NESSE quadro = devolve ele (200, created: false). Cards
  // do mesmo telefone em outros quadros não impedem. Dispara o mesmo que a criação pela tela: entrada na coluna e
  // histórico (gatilhos do banco), SDR da aba, linha do tempo, espelho do closer se já nascer em "Reunião agendada".
  app.post<{ Body: unknown }>('/api/integracao/cards', async (req, reply) => {
    const v = validarCriacaoIntegracao(req.body);
    let quadro: { id: string; nome: string } | null = null;
    if (v.quadro) {
      const q = await acharQuadro(v.quadro);
      if (q.erro) v.erros.push(q.erro);
      else quadro = { id: q.id!, nome: q.nome ?? q.id! };
    }
    let coluna: { id: string; name: string } | null = null;
    if (quadro) {
      const colunas = await query<{ id: string; name: string; page: string; is_vendas: boolean; is_contrato: boolean }>(
        'SELECT id, name, page, is_vendas, is_contrato FROM lead_boards WHERE page = $1 ORDER BY position, created_at',
        [quadro.id]
      );
      const doFunil = colunas.filter((c) => !c.is_vendas && !c.is_contrato);
      if (!doFunil.length) v.erros.push(`O quadro "${quadro.nome}" não tem colunas.`);
      else if (v.coluna) {
        const ids = colunasQueCasam(colunas, v.coluna);
        const achada = colunas.find((c) => c.id === ids[0]);
        if (!ids.length) v.erros.push(`Coluna "${v.coluna}" não existe no quadro "${quadro.nome}". Colunas: ${doFunil.map((c) => c.name).join(', ')}.`);
        else if (ids.length > 1) v.erros.push(`Nome de coluna ambíguo ("${v.coluna}") no quadro "${quadro.nome}".`);
        else if (achada && (achada.is_vendas || achada.is_contrato)) v.erros.push('A API não cria cards em colunas de Vendas/Contrato.');
        else coluna = achada ?? null;
      } else coluna = doFunil[0];
    }
    if (v.erros.length || !quadro || !coluna) {
      return reply.status(400).send({ message: 'Não deu pra criar o card.', erros: v.erros.length ? v.erros : ['Quadro ou coluna inválidos.'] });
    }

    const telefone = v.campos.telefone;
    const ultimos8 = chaveTelefone(telefone)!.ultimos8;
    const status = (await statusDoQuadro(coluna.id)) ?? '';
    // Trava por quadro + telefone: duas chamadas iguais ao mesmo tempo não criam dois cards.
    const r = await withTransaction(async (client) => {
      await client.query(`SELECT set_config('app.actor', $1, true)`, [ATOR]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`integracao-card:${quadro!.id}:${ultimos8}`]);
      const { rows: mesmos } = await client.query<{ id: string; telefone: string; espelho_origem_id: string | null; copia_ia_origem_id: string | null }>(
        `SELECT r.id, r.telefone, r.espelho_origem_id, r.copia_ia_origem_id FROM lead_rows r
         JOIN lead_boards lb ON lb.id = r.board_id
         WHERE lb.page = $1 AND lb.is_vendas = false AND r.deleted_at IS NULL
           AND right(regexp_replace(r.telefone, '\\D', '', 'g'), 8) = $2
         ORDER BY r.created_at ASC`,
        [quadro!.id, ultimos8]
      );
      const existente = mesmos.filter((m) => mesmoTelefone(m.telefone, telefone))
        .sort((a, b) => Number(!!(a.espelho_origem_id || a.copia_ia_origem_id)) - Number(!!(b.espelho_origem_id || b.copia_ia_origem_id)))[0];
      if (existente) return { id: existente.id, criado: false };
      const { rows: [{ max }] } = await client.query<{ max: number | null }>(
        'SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [coluna!.id]);
      // Nomes de coluna vêm da lista fixa do validador (nunca do cliente) — seguro interpolar.
      const campos: Record<string, unknown> = { ...v.campos, board_id: coluna!.id, status, position: (max ?? -1) + 1, sdr: '' };
      const chaves = Object.keys(campos);
      const { rows: [novo] } = await client.query<{ id: string }>(
        `INSERT INTO lead_rows (${chaves.join(', ')}) VALUES (${chaves.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        chaves.map((k) => campos[k])
      );
      return { id: novo.id, criado: true };
    });

    if (!r.criado && textoDaNota(v.nota)) await anotar(r.id, textoDaNota(v.nota));
    if (r.criado) {
      // SDR: o dono da aba (no CRM IA LUIZA, "IA Luiza"); aba sem dono usa o "sdr" do corpo.
      const sdrDaAba = await preencherSdrDaAba(r.id).catch(() => null);
      if (!sdrDaAba && v.sdr) await query('UPDATE lead_rows SET sdr = $1 WHERE id = $2', [v.sdr, r.id]);
      await logLeadEvent(r.id, 'created', null, null, 'Automação').catch(() => undefined);
      await query(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments) VALUES ($1, NULL, $2, $3, '[]')`,
        [r.id, AUTOR_LUIZA, textoParaHtml([
          `Card criado automaticamente pela Luiza (origem: ${rotuloDaOrigem(v.campos.origem ?? '')})`,
          textoDaNota(v.nota),
        ].filter(Boolean).join('\n\n'))]
      );
      await sincronizarContagemNotas(r.id);
      await espelharSeReuniaoAgendada(r.id);
      await syncCopiaDaIa(r.id);
    }
    const card = await buscarCard(r.id);
    const resposta = {
      id: r.id, quadro: card?.quadro_id ?? quadro.id, quadro_nome: card?.quadro ?? quadro.nome,
      coluna: card?.coluna ?? coluna.name, coluna_id: card?.coluna_id ?? coluna.id, created: r.criado,
      card: card ? cardParaApi(card, await carregarOpcoesEtiqueta()) : null,
    };
    return reply.status(r.criado ? 201 : 200).send(resposta);
  });

  // PATCH /api/integracao/cards/:id
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/integracao/cards/:id', async (req, reply) => {
    const { id } = req.params;
    if (!UUID.test(id)) return reply.status(400).send({ message: 'id inválido.' });
    const v = validarPatchIntegracao(req.body);
    if (v.erro) return reply.status(400).send({ message: v.erro });

    const atual = await queryOne<Record<string, unknown> & {
      board_id: string; page: string; venda_origem_id: string | null; board_is_vendas: boolean;
      espelho_origem_id: string | null; copia_ia_origem_id: string | null;
      status: string; sdr: string; tipo: string; dia_contato: string; ligacao: string; followup: string; disparo: string;
    }>(
      `SELECT ${CAMPOS_DA_LINHA_DO_TEMPO.map((c) => `r.${c}`).join(', ')}, r.board_id, lb.page, r.status, r.sdr, r.dia_contato,
              r.venda_origem_id, r.espelho_origem_id, r.copia_ia_origem_id, lb.is_vendas AS board_is_vendas
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id]
    );
    if (!atual) return reply.status(404).send({ message: 'Card não encontrado.' });

    // Resolve a coluna de destino. Por nome, só dentro do quadro do próprio card; por board_id, qualquer uma.
    let destino: string | null = null;
    let paginaFinal = atual.page; // aba cujas etiquetas valem (muda se o card for pra outro quadro)
    if (v.coluna || v.boardId) {
      if (atual.venda_origem_id || atual.board_is_vendas) {
        return reply.status(400).send({ message: 'Esse card é uma venda: a API não move cards da aba Vendas.' });
      }
      if (v.boardId) {
        destino = v.boardId;
      } else {
        const doQuadro = await query<{ id: string; name: string; page: string }>(
          'SELECT id, name, page FROM lead_boards WHERE page = $1',
          [atual.page]
        );
        const ids = colunasQueCasam(doQuadro, v.coluna!);
        if (!ids.length) return reply.status(404).send({ message: `Coluna "${v.coluna}" não encontrada no quadro do card.` });
        if (ids.length > 1) return reply.status(409).send({ message: `Nome de coluna ambíguo ("${v.coluna}"); use board_id.` });
        destino = ids[0];
      }
      const alvo = await queryOne<{ name: string; page: string; is_vendas: boolean; is_contrato: boolean; archived_at: string | null }>(
        `SELECT lb.name, lb.page, lb.is_vendas, lb.is_contrato, lp.archived_at FROM lead_boards lb
         JOIN lead_pages lp ON lp.id = lb.page WHERE lb.id = $1`,
        [destino]
      );
      if (!alvo) return reply.status(404).send({ message: 'Coluna de destino não existe.' });
      paginaFinal = alvo.page;
      if (alvo.archived_at) return reply.status(400).send({ message: 'A coluna de destino está num quadro arquivado.' });
      if (alvo.is_vendas || alvo.is_contrato) {
        return reply.status(403).send({ message: 'A API não move cards para colunas de Vendas/Contrato (venda e comissão não são pela API).' });
      }
    }
    const moveu = destino !== null && destino !== atual.board_id;

    const campos: Record<string, unknown> = { ...v.campos };
    // Etiquetas por nome ({"Disparo":"D7"}): só aceita as que já existem na aba — nunca cria. Status e SDR
    // também são colunas de etiqueta, mas têm campo próprio no PATCH; pedir os dois é ambíguo.
    const opcoes = await carregarOpcoesEtiqueta();
    if (v.etiquetas !== undefined) {
      const r = resolverEtiquetas(v.etiquetas, opcoes(paginaFinal));
      if (r.erro) return reply.status(400).send({ message: r.erro, etiquetas_validas: r.validas });
      for (const [coluna, valor] of Object.entries(r.campos)) {
        if (coluna in campos) return reply.status(400).send({ message: `"${coluna}" veio em "etiquetas" e também como campo próprio; envie só um.` });
        campos[coluna] = valor;
      }
    }
    if (moveu) {
      const [{ max }] = await query<{ max: number | null }>('SELECT MAX(position) AS max FROM lead_rows WHERE board_id = $1', [destino]);
      campos.board_id = destino;
      campos.position = (max ?? -1) + 1;
      // Mesma regra da tela: coluna e Status andam juntos, a menos que o status venha explícito.
      if (!('status' in campos)) {
        const etiqueta = await statusDoQuadro(destino!);
        if (etiqueta) campos.status = etiqueta;
      }
    }
    // descricao/email não são campos do card: entram nas Atualizações (no histórico da original, se for cópia).
    const nota = textoDaNota(v.nota);
    if (nota) await anotar(id, nota);
    const chaves = Object.keys(campos);
    if (!chaves.length) {
      const semMudanca = await buscarCard(id);
      return semMudanca ? cardParaApi(semMudanca, opcoes) : reply.status(404).send({ message: 'Card não encontrado.' });
    }

    // Os nomes das colunas vêm da lista fixa do validador (nunca do cliente) — seguro interpolar.
    const sets = chaves.map((k, i) => `${k} = $${i + 1}`);
    const params = [...chaves.map((k) => campos[k]), id];
    await queryAsActor(ATOR, `UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // Linha do tempo do card (a mesma da tela): coluna, status, SDR, dia de contato e as colunas de etiqueta.
    const depois = await buscarCard(id);
    if (!depois) return reply.status(404).send({ message: 'Card não encontrado.' });
    if (moveu) {
      const antes = await queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [atual.board_id]);
      await logLeadEvent(id, 'board', antes?.name ?? null, depois.coluna, 'Automação').catch(() => undefined);
    }
    for (const tipo of CAMPOS_NA_LINHA_DO_TEMPO) {
      if (!(tipo in campos)) continue;
      const de = String(atual[tipo] ?? '');
      const para = String(campos[tipo] ?? '');
      if (de === para) continue;
      await logLeadEvent(id, tipo, de || null, para || null, 'Automação').catch(() => undefined);
    }
    // Os outros campos (agendamento, valores, origem, nome…), na Linha do tempo da original — como na tela.
    const outros = Object.keys(campos).filter((k) => ehCampoDaLinhaDoTempo(k) && !(CAMPOS_NA_LINHA_DO_TEMPO as readonly string[]).includes(k));
    if (outros.length) {
      const original = await idCanonicoDasNotas(id);
      for (const k of outros) await registrarMudancaDeCampo(original, k, atual[k], campos[k], 'Automação');
    }
    // As outras linhas da mesma lead (cópia do closer / da IA, ou a original) acompanham, como na tela.
    await propagarEspelho(id, atual.espelho_origem_id, campos, '', atual.copia_ia_origem_id, 'Automação', true);
    // Espelho do closer: igual à tela, quando a coluna ou o status mudou.
    if (moveu || 'status' in campos) await espelharSeReuniaoAgendada(id);
    // SDR virou "IA Luiza" num CRM de outro SDR: ganha a cópia no CRM IA LUIZA (ou perde, se desmarcar).
    if (moveu || 'status' in campos || 'sdr' in campos) await syncCopiaDaIa(id);

    const final = await buscarCard(id);
    return cardParaApi(final ?? depois, opcoes);
  });

  // POST /api/integracao/cards/:id/log  { "texto": "Luiza: enviou template D7", "autor": "Luiza" (opcional) }
  // Vira uma Atualização do card (a mesma lista do painel lateral). Texto puro: é escapado.
  app.post<{ Params: { id: string }; Body: { texto?: unknown; autor?: unknown } }>(
    '/api/integracao/cards/:id/log',
    async (req, reply) => {
      const { id } = req.params;
      if (!UUID.test(id)) return reply.status(400).send({ message: 'id inválido.' });
      const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
      if (!texto) return reply.status(400).send({ message: '"texto" é obrigatório.' });
      if (texto.length > 5000) return reply.status(400).send({ message: '"texto" passa de 5000 caracteres.' });
      const autor = typeof req.body?.autor === 'string' && req.body.autor.trim() ? req.body.autor.trim().slice(0, 80) : 'Automação';
      const existe = await queryOne<{ id: string }>('SELECT id FROM lead_rows WHERE id = $1 AND deleted_at IS NULL', [id]);
      if (!existe) return reply.status(404).send({ message: 'Card não encontrado.' });

      // Atualização escrita numa cópia do espelho entra no histórico da original, como na tela.
      const canonico = await idCanonicoDasNotas(id);
      const [nota] = await query<{ id: string; created_at: string }>(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments)
         VALUES ($1, NULL, $2, $3, '[]') RETURNING id, created_at`,
        [canonico, autor, textoParaHtml(texto)]
      );
      void sincronizarContagemNotas(canonico);
      return reply.status(201).send({ id: nota.id, card_id: canonico, autor, texto, created_at: nota.created_at });
    }
  );
}
