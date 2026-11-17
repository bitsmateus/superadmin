import { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../db.js';
import { lerPdfDePromocao } from '../lib/plaquinhas/relatorio.js';

/**
 * Plaquinhas em massa do Mercado Nunes (/mercadonunes/plaquinhas) — página pública, sem login (igual ao gerador
 * de cartazes). O mercado sobe o PDF de promoções do ERP, o servidor lê e cria uma plaquinha por produto; depois
 * é só ajustar em massa, mandar pra fila e imprimir. Nada some ao imprimir.
 */

const BASE = '/api/public/mercadonunes/plaquinhas';

/** Campos do cartaz que a tela pode gravar (o resto é descartado). */
const CAMPOS_CARTAZ = new Set([
  'produto', 'subtitulo', 'peso', 'preco', 'precoDe', 'unidade', 'textoFaixa', 'mostrarFaixa', 'mostrarDePor',
  'mostrarLogo', 'logoEsquerda', 'mostrarBolinhaPreco', 'minUnidades', 'mostrarPrecoAvulsoCaixa', 'precoAvulso',
  'caixaQtd', 'caixaPreco', 'precoLitro', 'precoQuilo', 'temaId', 'fonte', 'ajusteNome', 'ajusteSubtitulo',
  'ajusteFaixa', 'ajustePreco', 'ajustePeso',
]);

function limpar(patch: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!CAMPOS_CARTAZ.has(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

const COLUNAS = 'id, produto_id, ean, grupo, nome_original, inicio, fim, dados, na_fila, impressa_em, impressoes, origem, created_at, updated_at';

export async function mercadoNunesPlaquinhasRoutes(app: FastifyInstance) {
  app.get(BASE, async () => ({
    plaquinhas: await query(`SELECT ${COLUNAS} FROM mn_plaquinhas ORDER BY grupo, nome_original`),
  }));

  // Lê o PDF e cria/atualiza as plaquinhas. Mesmo produto = mesma plaquinha: o preço novo entra por cima, o que
  // a pessoa editou (nome, modelo, tema) fica. Se o preço mudou, ela volta a "não impressa".
  app.post<{ Body: { nome?: string; pdf?: string; padrao?: unknown } }>(`${BASE}/importar`, async (req, reply) => {
    const m = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.pdf ?? ''));
    if (!m) return reply.status(400).send({ message: 'Envie um arquivo PDF.' });
    let lido;
    try {
      lido = await lerPdfDePromocao(Buffer.from(m[1], 'base64'));
    } catch {
      return reply.status(400).send({ message: 'Não consegui abrir esse PDF.' });
    }
    if (!lido.itens.length) {
      return reply.status(422).send({
        message: 'Não achei produtos em promoção nesse PDF. Ele é o relatório "Itens em Promoção" ou "Promoção de Produto" do sistema?',
        inativos: lido.inativos,
        vencidos: lido.vencidos,
      });
    }
    const padrao = limpar(req.body?.padrao);
    const origem = String(req.body?.nome ?? '').slice(0, 200);
    let criadas = 0;
    let atualizadas = 0;
    // Ids que esta importação mexeu — a tela usa pra selecionar/excluir "as desta importação".
    const idsCriadas: string[] = [];
    const idsAtualizadas: string[] = [];
    await withTransaction(async (client) => {
      for (const i of lido.itens) {
        // subtitulo vazio: o padrão do cartaz traz um texto de exemplo ("TRADICIONAL") que não pode vazar pra plaquinha.
        const novos = { produto: i.produto, subtitulo: '', peso: i.peso, preco: i.preco, precoDe: i.precoDe, minUnidades: i.minUnidades, mostrarDePor: Boolean(i.precoDe) };
        const { rows } = await client.query<{ id: string; dados: Record<string, unknown> }>('SELECT id, dados FROM mn_plaquinhas WHERE produto_id = $1', [i.produtoId]);
        if (rows.length) {
          const antes = rows[0].dados ?? {};
          const mudouPreco = String(antes.preco ?? '') !== i.preco || String(antes.precoDe ?? '') !== i.precoDe;
          // Só preço/mínimo entram por cima; nome, peso e visual continuam como a pessoa deixou.
          const dados = { ...antes, preco: i.preco, precoDe: i.precoDe, minUnidades: i.minUnidades, mostrarDePor: antes.mostrarDePor === false ? false : Boolean(i.precoDe) };
          await client.query(
            `UPDATE mn_plaquinhas SET dados = $2::jsonb, grupo = $3, nome_original = $4, ean = $5, inicio = $6, fim = $7, origem = $8,
               impressa_em = CASE WHEN $9 THEN NULL ELSE impressa_em END, updated_at = NOW() WHERE id = $1`,
            [rows[0].id, JSON.stringify(dados), i.grupo, i.nomeOriginal, i.ean, i.inicio, i.fim, origem, mudouPreco],
          );
          atualizadas++;
          idsAtualizadas.push(rows[0].id);
        } else {
          const novo = await client.query<{ id: string }>(
            `INSERT INTO mn_plaquinhas (produto_id, ean, grupo, nome_original, inicio, fim, dados, origem)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id`,
            [i.produtoId, i.ean, i.grupo, i.nomeOriginal, i.inicio, i.fim, JSON.stringify({ ...novos, ...padrao, mostrarDePor: padrao.mostrarDePor === false ? false : novos.mostrarDePor }), origem],
          );
          criadas++;
          if (novo.rows[0]) idsCriadas.push(novo.rows[0].id);
        }
      }
    });
    return {
      modelo: lido.modelo,
      lidos: lido.itens.length,
      criadas,
      atualizadas,
      inativos: lido.inativos,
      vencidos: lido.vencidos,
      repetidos: lido.repetidos,
      idsCriadas,
      idsAtualizadas,
    };
  });

  // Edita uma plaquinha: campos do cartaz (mescla) e/ou entrada na fila.
  app.patch<{ Params: { id: string }; Body: { dados?: unknown; na_fila?: boolean } }>(`${BASE}/:id`, async (req, reply) => {
    const patch = limpar(req.body?.dados);
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [req.params.id];
    if (Object.keys(patch).length) {
      params.push(JSON.stringify(patch));
      sets.push(`dados = dados || $${params.length}::jsonb`);
    }
    if (typeof req.body?.na_fila === 'boolean') {
      params.push(req.body.na_fila);
      sets.push(`na_fila = $${params.length}`);
    }
    const row = await queryOne(`UPDATE mn_plaquinhas SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUNAS}`, params);
    if (!row) return reply.status(404).send({ message: 'Plaquinha não encontrada.' });
    return row;
  });

  app.delete<{ Params: { id: string } }>(`${BASE}/:id`, async (req) => {
    await query('DELETE FROM mn_plaquinhas WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  // Ação em lote nas plaquinhas escolhidas: fila, tirar da fila, aplicar modelo/tema/fonte, marcar impressa, excluir.
  app.post<{ Body: { ids?: string[]; acao?: string; patch?: unknown } }>(`${BASE}/lote`, async (req, reply) => {
    const ids = Array.isArray(req.body?.ids) ? req.body!.ids!.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 2000) : [];
    if (!ids.length) return reply.status(400).send({ message: 'Escolha pelo menos uma plaquinha.' });
    const acao = req.body?.acao;
    let rows: unknown[];
    switch (acao) {
      case 'fila':
      case 'tirar_fila':
        rows = await query('UPDATE mn_plaquinhas SET na_fila = $2, updated_at = NOW() WHERE id = ANY($1::uuid[]) RETURNING id', [ids, acao === 'fila']);
        break;
      case 'imprimida':
        // Saem da fila, mas continuam salvas com a data da impressão.
        rows = await query(
          'UPDATE mn_plaquinhas SET na_fila = false, impressa_em = NOW(), impressoes = impressoes + 1, updated_at = NOW() WHERE id = ANY($1::uuid[]) RETURNING id',
          [ids],
        );
        break;
      case 'aplicar': {
        const patch = limpar(req.body?.patch);
        if (!Object.keys(patch).length) return reply.status(400).send({ message: 'Nada para aplicar.' });
        // De/por só liga onde existe preço de; o resto do patch vai igual.
        const { mostrarDePor, ...resto } = patch;
        rows = await query(
          `UPDATE mn_plaquinhas SET updated_at = NOW(),
             dados = dados || $2::jsonb || CASE WHEN $3::boolean IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('mostrarDePor', $3::boolean AND COALESCE(dados->>'precoDe','') <> '') END
           WHERE id = ANY($1::uuid[]) RETURNING id`,
          [ids, JSON.stringify(resto), typeof mostrarDePor === 'boolean' ? mostrarDePor : null],
        );
        break;
      }
      case 'excluir':
        rows = await query('DELETE FROM mn_plaquinhas WHERE id = ANY($1::uuid[]) RETURNING id', [ids]);
        break;
      default:
        return reply.status(400).send({ message: 'Ação inválida.' });
    }
    return { afetadas: rows.length };
  });
}
