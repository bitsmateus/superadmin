import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Garantia de que estratégia e premissas do planejamento não saem em nenhuma resposta do portal do
 * cliente nem da prévia "ver como o cliente vê".
 *
 * Duas camadas:
 *  1. GUARDA ESTÁTICA (sempre roda, sem banco): o código do caminho público não pode mencionar essas
 *     colunas, nem usar SELECT * / RETURNING *, nem espalhar uma linha do banco na saída. É um
 *     alarme barato: se alguém, por descuido, passar a buscar a coluna no caminho público, este
 *     teste falha antes de qualquer cliente ver nada.
 *  2. INTEGRAÇÃO (só roda com GC_TEST_DATABASE_URL apontando pra um banco de TESTE): sobe a rota
 *     pública de verdade, grava textos-isca e confere o corpo inteiro das respostas.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const lerFonte = (relativo: string) => fs.readFileSync(path.join(aqui, relativo), 'utf8');

/** Tira comentários: a regra vale pro CÓDIGO, e os comentários explicam justamente o que é proibido. */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ------------------------------------------------------------------------- 1. guarda estática

test('guarda: o caminho público não toca em estratégia/premissas nem usa SELECT *', () => {
  const rotas = lerFonte('./gestaoClientes.ts');
  const inicio = rotas.indexOf('async function jornadaDoPortal');
  assert.ok(inicio > 0, 'não achei jornadaDoPortal — o teste de guarda precisa ser atualizado');
  // Do carregamento da jornada até o fim do arquivo: o carregamento + as rotas públicas.
  const caminhoPublico = semComentarios(rotas.slice(inicio));

  assert.ok(!/estrategia|premissas/i.test(caminhoPublico), 'o caminho público menciona estrategia/premissas');
  assert.ok(!/select\s+\*/i.test(caminhoPublico), 'o caminho público usa SELECT *');
  assert.ok(!/returning\s+\*/i.test(caminhoPublico), 'o caminho público usa RETURNING *');
  // As colunas lidas da tabela de cenários são explícitas.
  assert.ok(!/gc_planejamento_cenarios[^`']*\*/i.test(caminhoPublico), 'cenários lidos com curinga');
});

test('guarda: a montagem pública não espalha linhas do banco na saída', () => {
  const montagem = semComentarios(lerFonte('../lib/gcPortalJornada.ts'));
  assert.ok(!/\.\.\.\s*(p|linha|e|e\.planejamento|planejamento)\b/.test(montagem), 'a montagem espalha uma linha na saída');
  assert.ok(!/estrategia|premissas/i.test(montagem), 'a montagem menciona estrategia/premissas');
});

// ------------------------------------------------------------------------- 2. integração

const URL_DE_TESTE = process.env.GC_TEST_DATABASE_URL;

test('integração: nenhuma resposta pública ou de prévia carrega estratégia/premissas', { skip: !URL_DE_TESTE && 'defina GC_TEST_DATABASE_URL (banco de TESTE) pra rodar' }, async () => {
  process.env.DATABASE_URL = URL_DE_TESTE;
  const { default: Fastify } = await import('fastify');
  const { pool, query } = await import('../db.js');
  const { criarEstruturaGestaoClientes } = await import('../db/gestaoClientes.js');
  const { gestaoClientesRoutes, gestaoClientesPublicRoutes } = await import('./gestaoClientes.js');
  await criarEstruturaGestaoClientes(pool);

  const SEGREDOS = ['ZZ-SEGREDO-ESTRATEGIA-DB', 'ZZ-SEGREDO-PREMISSA-DB'];
  const app = Fastify();
  app.decorate('authenticate', async (req: { user?: unknown }) => {
    req.user = { sub: '00000000-0000-0000-0000-000000000000', role: 'admin' };
  });
  await app.register(gestaoClientesRoutes);
  await app.register(gestaoClientesPublicRoutes);

  const [cliente] = await query<{ id: string }>(
    "INSERT INTO gc_clientes (nome_empresa) VALUES ('ZZ TESTE PORTAL') RETURNING id"
  );
  const token = `zz-teste-${Date.now()}`;
  try {
    await query('INSERT INTO gc_links_publicos (gc_cliente_id, token) VALUES ($1, $2)', [cliente.id, token]);
    for (const h of ['6_meses', '12_meses']) {
      await query(
        `INSERT INTO gc_planejamento_cenarios (gc_cliente_id, horizonte, onde_quer_chegar, estrategia, premissas)
         VALUES ($1, $2, 'Objetivo público', $3, $4)`,
        [cliente.id, h, SEGREDOS[0], SEGREDOS[1]]
      );
    }
    await query(
      `INSERT INTO gc_metas (gc_cliente_id, chave_metrica, horizonte, valor_base, valor_meta)
       VALUES ($1, 'leads', '6_meses', 100, 300)`,
      [cliente.id]
    );

    for (const ativo of [true, false]) {
      for (const situacao of [true, false]) {
        for (const objetivo of [true, false]) {
          await query(
            `INSERT INTO gc_planejamento (gc_cliente_id, situacao_atual, leads_mes, data_diagnostico,
               portal_ativo, portal_mostrar_situacao, portal_mostrar_objetivo)
             VALUES ($1, 'Situação pública', 100, '2026-03-15', $2, $3, $4)
             ON CONFLICT (gc_cliente_id) DO UPDATE SET portal_ativo = EXCLUDED.portal_ativo,
               portal_mostrar_situacao = EXCLUDED.portal_mostrar_situacao,
               portal_mostrar_objetivo = EXCLUDED.portal_mostrar_objetivo`,
            [cliente.id, ativo, situacao, objetivo]
          );
          const contexto = `ativo=${ativo} situacao=${situacao} objetivo=${objetivo}`;
          const publica = await app.inject({ method: 'GET', url: `/api/public/cliente/${token}` });
          const previa = await app.inject({ method: 'GET', url: `/api/gc/clientes/${cliente.id}/planejamento/previa-portal` });
          assert.equal(publica.statusCode, 200, contexto);
          assert.equal(previa.statusCode, 200, contexto);
          for (const [nome, corpo] of [['portal', publica.body], ['prévia', previa.body]]) {
            for (const segredo of SEGREDOS) {
              assert.ok(!corpo.includes(segredo), `${nome} (${contexto}) vazou "${segredo}"`);
            }
            assert.ok(!/"estrategia"|"premissas"/.test(corpo), `${nome} (${contexto}) expôs o nome do campo`);
          }
          // O interruptor continua mandando: desligado, o portal não traz o bloco; a prévia traz.
          assert.equal(publica.json().jornada === null, !ativo, `portal ${contexto}`);
          assert.notEqual(previa.json().jornada, null, `prévia ${contexto}`);
        }
      }
    }
  } finally {
    await query('DELETE FROM gc_clientes WHERE id = $1', [cliente.id]);
    await app.close();
    await pool.end();
  }
});
