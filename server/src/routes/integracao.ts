import { FastifyInstance } from 'fastify';
import { query, queryOne, queryAsActor } from '../db.js';
import {
  idCanonicoDasNotas, logLeadEvent, sincronizarContagemNotas, statusDoQuadro, syncEspelhoReuniaoAgendada,
} from './leadBoards.js';
import {
  chaveTelefone, chaveValida, colunasQueCasam, mesmoTelefone, parseDataIntegracao, telefoneComDdi,
  textoParaHtml, validarPatchIntegracao,
} from '../lib/integracaoCards.js';

/**
 * API de integração (n8n / réguas de WhatsApp). Protegida por chave no header `x-api-key`, comparada
 * com a env INTEGRACAO_API_KEY. Sem a env configurada, TODAS as rotas respondem 503 (nunca ficam abertas).
 *
 * Regras de segurança desta API:
 *  - NUNCA cria venda nem comissão (não chama syncVendaFromStatus/propagarComissao) e recusa mover card
 *    pra coluna de Vendas/Contrato. Mover pra "Vendido" do funil só troca coluna e status.
 *  - Trocar a coluna registra o histórico (lead_board_history) como "automação".
 */

const ATOR = 'automação';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CardRow {
  id: string; nome: string; empresa: string; telefone: string; status: string; sdr: string;
  dor_cliente: string; numero_atendentes: string; entrou_coluna_em: string | null;
  regua: string; regua_etapa: string; regua_ultimo_envio_em: string | null; regua_status: string; optout: boolean;
  coluna_id: string; coluna: string; quadro_id: string; quadro: string;
}

const SELECT_CARD = `
  SELECT r.id, r.nome, r.empresa, r.telefone, r.status, r.sdr, r.dor_cliente, r.numero_atendentes,
         r.entrou_coluna_em, r.regua, r.regua_etapa, r.regua_ultimo_envio_em, r.regua_status, r.optout,
         lb.id AS coluna_id, lb.name AS coluna, lp.id AS quadro_id, lp.name AS quadro
  FROM lead_rows r
  JOIN lead_boards lb ON lb.id = r.board_id
  JOIN lead_pages lp ON lp.id = lb.page`;

function cardParaApi(r: CardRow) {
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
  };
}

async function buscarCard(id: string): Promise<CardRow | null> {
  return queryOne<CardRow>(`${SELECT_CARD} WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
}

/**
 * Espelho pro CRM do closer (Luis) quando a API leva um card do CRM do Arthur pra "Reunião agendada".
 *
 * Existe porque o espelho nasce de um efeito colateral do PATCH da TELA (leadBoards.ts), que a API não
 * passa — sem isto o Luis não veria a reunião marcada pela automação. Reaproveita
 * syncEspelhoReuniaoAgendada, a mesma função da tela, então valem as mesmas regras: só cards do
 * CRM do Arthur que estão em "Reunião agendada", nunca espelha uma cópia, não duplica (índice único em
 * espelho_origem_id) e restaura a cópia se ela tinha sido retirada. Não cria venda nem comissão.
 * Nunca lança (a função da tela já captura os erros): falhar aqui não desfaz a movimentação.
 *
 * Limite conhecido: só CRIA/restaura a cópia. A propagação de edições para uma cópia já existente
 * (propagarEspelho) NÃO roda pela API.
 */
export async function espelharSeReuniaoAgendada(cardId: string): Promise<void> {
  await syncEspelhoReuniaoAgendada(cardId);
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

  // GET /api/integracao/cards?coluna=NOME&board_id=UUID&entrou_depois=DATA&limite=N
  // Lista os cards da coluna em TODOS os quadros. Fora da lista: cards excluídos, cópias do espelho
  // do closer e da aba Vendas (senão o mesmo telefone receberia a régua duas vezes) e quadros arquivados.
  app.get<{ Querystring: { coluna?: string; board_id?: string; entrou_depois?: string; limite?: string } }>(
    '/api/integracao/cards',
    async (req, reply) => {
      const { coluna, board_id, entrou_depois } = req.query;
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
      let ids = coluna?.trim() ? colunasQueCasam(colunas, coluna) : colunas.map((c) => c.id);
      if (board_id) ids = ids.filter((id) => id === board_id);
      if (!ids.length) return [];

      const rows = await query<CardRow>(
        `${SELECT_CARD}
         WHERE r.deleted_at IS NULL AND r.espelho_origem_id IS NULL AND r.venda_origem_id IS NULL
           AND r.board_id = ANY($1) AND ($2::timestamptz IS NULL OR r.entrou_coluna_em > $2)
         ORDER BY r.entrou_coluna_em ASC NULLS LAST, r.created_at ASC
         LIMIT $3`,
        [ids, depois ? depois.toISOString() : null, limite]
      );
      return rows.map(cardParaApi);
    }
  );

  // GET /api/integracao/cards/telefone/:numero — com/sem 55, com/sem o 9.
  // Se houver mais de um card com o número, devolve o original mais recente e lista os demais.
  app.get<{ Params: { numero: string } }>('/api/integracao/cards/telefone/:numero', async (req, reply) => {
    const chave = chaveTelefone(req.params.numero);
    if (!chave) return reply.status(400).send({ message: 'Telefone inválido: informe DDD + número.' });
    const candidatos = await query<CardRow & { espelho_origem_id: string | null; venda_origem_id: string | null }>(
      `${SELECT_CARD.replace('SELECT r.id,', 'SELECT r.espelho_origem_id, r.venda_origem_id, r.id,')}
       WHERE r.deleted_at IS NULL AND lp.archived_at IS NULL
         AND right(regexp_replace(r.telefone, '\\D', '', 'g'), 8) = $1`,
      [chave.ultimos8]
    );
    const achados = candidatos
      .filter((c) => mesmoTelefone(c.telefone, req.params.numero))
      .sort((a, b) => {
        const copia = (x: typeof a) => (x.espelho_origem_id || x.venda_origem_id ? 1 : 0);
        return copia(a) - copia(b) || (b.entrou_coluna_em ?? '').localeCompare(a.entrou_coluna_em ?? '');
      });
    if (!achados.length) return reply.status(404).send({ message: 'Nenhum card com esse telefone.' });
    return { ...cardParaApi(achados[0]), total_encontrados: achados.length, outros_ids: achados.slice(1).map((c) => c.id) };
  });

  // PATCH /api/integracao/cards/:id
  app.patch<{ Params: { id: string }; Body: unknown }>('/api/integracao/cards/:id', async (req, reply) => {
    const { id } = req.params;
    if (!UUID.test(id)) return reply.status(400).send({ message: 'id inválido.' });
    const v = validarPatchIntegracao(req.body);
    if (v.erro) return reply.status(400).send({ message: v.erro });

    const atual = await queryOne<{
      board_id: string; page: string; status: string; venda_origem_id: string | null; board_is_vendas: boolean;
    }>(
      `SELECT r.board_id, lb.page, r.status, r.venda_origem_id, lb.is_vendas AS board_is_vendas
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [id]
    );
    if (!atual) return reply.status(404).send({ message: 'Card não encontrado.' });

    // Resolve a coluna de destino. Por nome, só dentro do quadro do próprio card; por board_id, qualquer uma.
    let destino: string | null = null;
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
      const alvo = await queryOne<{ name: string; is_vendas: boolean; is_contrato: boolean; archived_at: string | null }>(
        `SELECT lb.name, lb.is_vendas, lb.is_contrato, lp.archived_at FROM lead_boards lb
         JOIN lead_pages lp ON lp.id = lb.page WHERE lb.id = $1`,
        [destino]
      );
      if (!alvo) return reply.status(404).send({ message: 'Coluna de destino não existe.' });
      if (alvo.archived_at) return reply.status(400).send({ message: 'A coluna de destino está num quadro arquivado.' });
      if (alvo.is_vendas || alvo.is_contrato) {
        return reply.status(403).send({ message: 'A API não move cards para colunas de Vendas/Contrato (venda e comissão não são pela API).' });
      }
    }
    const moveu = destino !== null && destino !== atual.board_id;

    const campos: Record<string, unknown> = { ...v.campos };
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
    const chaves = Object.keys(campos);
    if (!chaves.length) {
      const semMudanca = await buscarCard(id);
      return semMudanca ? cardParaApi(semMudanca) : reply.status(404).send({ message: 'Card não encontrado.' });
    }

    // Os nomes das colunas vêm da lista fixa do validador (nunca do cliente) — seguro interpolar.
    const sets = chaves.map((k, i) => `${k} = $${i + 1}`);
    const params = [...chaves.map((k) => campos[k]), id];
    await queryAsActor(ATOR, `UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // Linha do tempo do card (mesma da tela). Só coluna e status: o resto não é rastreado lá.
    const depois = await buscarCard(id);
    if (!depois) return reply.status(404).send({ message: 'Card não encontrado.' });
    if (moveu) {
      const antes = await queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [atual.board_id]);
      await logLeadEvent(id, 'board', antes?.name ?? null, depois.coluna, 'Automação').catch(() => undefined);
    }
    if ('status' in campos && String(campos.status) !== (atual.status ?? '')) {
      await logLeadEvent(id, 'status', atual.status || null, String(campos.status) || null, 'Automação').catch(() => undefined);
    }
    // Espelho do closer: igual à tela, quando a coluna ou o status mudou.
    if (moveu || 'status' in campos) await espelharSeReuniaoAgendada(id);

    return cardParaApi(depois);
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
