import test from 'node:test';
import assert from 'node:assert/strict';
import { comAbasJuntas, saoAbasJuntas } from './abasJuntas.js';

test('comAbasJuntas: quem tem o CRM ARTHUR ganha o CRM IA LUIZA, sem repetir', () => {
  assert.deepEqual(comAbasJuntas(['novos_leads', 'crm-arthur']), ['novos_leads', 'crm-arthur', 'crm-ia-luiza']);
  assert.deepEqual(comAbasJuntas(['crm-arthur', 'crm-ia-luiza']), ['crm-arthur', 'crm-ia-luiza']);
  // Só a da Luiza não dá acesso ao Arthur.
  assert.deepEqual(comAbasJuntas(['crm-ia-luiza']), ['crm-ia-luiza']);
  assert.deepEqual(comAbasJuntas([]), []);
});

test('saoAbasJuntas: só ARTHUR e LUIZA, nos dois sentidos', () => {
  assert.equal(saoAbasJuntas('crm-arthur', 'crm-ia-luiza'), true);
  assert.equal(saoAbasJuntas('crm-ia-luiza', 'crm-arthur'), true);
  assert.equal(saoAbasJuntas('crm-luis-2', 'crm-ia-luiza'), false);
  assert.equal(saoAbasJuntas('crm-arthur', 'crm-luis-closer'), false);
});
