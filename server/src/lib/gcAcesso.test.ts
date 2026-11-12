import test from 'node:test';
import assert from 'node:assert/strict';
import { clienteDaRota, sqlSoDoGestor, veTodosOsClientes } from './gcAcesso.js';

const GESTOR = { sub: '11111111-2222-3333-4444-555555555555', role: 'user' };
const ADMIN = { sub: '99999999-2222-3333-4444-555555555555', role: 'admin' };

test('admin vê todos os clientes; qualquer outro papel só os dele', () => {
  assert.equal(veTodosOsClientes(ADMIN), true);
  for (const role of ['user', 'supervisor', 'gestor', '']) assert.equal(veTodosOsClientes({ role }), false);
  assert.equal(sqlSoDoGestor(ADMIN), 'TRUE');
  assert.equal(sqlSoDoGestor(GESTOR), `c.gestor_trafego_id = '${GESTOR.sub}'::uuid`);
  assert.equal(sqlSoDoGestor(GESTOR, 'g'), `g.gestor_trafego_id = '${GESTOR.sub}'::uuid`);
});

test('id fora do formato nunca vai pro SQL', () => {
  assert.equal(sqlSoDoGestor({ sub: "x' OR '1'='1", role: 'user' }), 'FALSE');
});

test('acha o cliente pela rota', () => {
  assert.deepEqual(clienteDaRota('/api/gc/clientes/:id', { id: 'abc' }), { tipo: 'cliente', id: 'abc' });
  assert.deepEqual(clienteDaRota('/api/gc/clientes/:id/trafego/edicoes', { id: 'abc' }), { tipo: 'cliente', id: 'abc' });
  assert.deepEqual(clienteDaRota('/api/gc/social/checklist/:clienteId/:mes/:etapa', { clienteId: 'abc' }), { tipo: 'cliente', id: 'abc' });
  const filho = clienteDaRota('/api/gc/social/producao/:id/ia/copy', { id: 'p1' });
  assert.equal(filho.tipo, 'filho');
  assert.match((filho as { sql: string }).sql, /FROM gc_social_producao/);
  assert.equal((clienteDaRota('/api/gc/trafego/edicoes/:edicaoId', { edicaoId: 'e1' }) as { id: string }).id, 'e1');
  assert.equal(clienteDaRota('/api/gc/demandas/:id/mover', { id: 'd1' }).tipo, 'filho');
  assert.match((clienteDaRota('/api/gc/trafego/google/contas/:id', { id: 'g1' }) as { sql: string }).sql, /FROM gc_google_contas/);
});

test('rotas que não são de um cliente passam (as listagens filtram no SQL)', () => {
  for (const url of ['/api/gc/clientes', '/api/gc/demandas', '/api/gc/demandas/colunas/:id', '/api/gc/modelos/estrategias/:id', '/api/gc/planejamento/modelos/:id', '/api/gc/trafego/painel', '/api/gc/pendencias']) {
    assert.deepEqual(clienteDaRota(url, { id: 'x' }), { tipo: 'livre' }, url);
  }
});
