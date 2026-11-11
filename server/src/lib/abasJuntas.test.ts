import test from 'node:test';
import assert from 'node:assert/strict';
import { comAbasJuntas, saoAbasJuntas } from './abasJuntas.js';

test('comAbasJuntas: quem tem o CRM ARTHUR ganha o CRM IA LUIZA e o CRM OUTBOUND, sem repetir', () => {
  assert.deepEqual(comAbasJuntas(['novos_leads', 'crm-arthur']), ['novos_leads', 'crm-arthur', 'crm-ia-luiza', 'crm-outbound']);
  assert.deepEqual(comAbasJuntas(['crm-arthur', 'crm-ia-luiza']), ['crm-arthur', 'crm-ia-luiza', 'crm-outbound']);
  // Só a da Luiza (ou só a OUTBOUND) não dá acesso ao Arthur.
  assert.deepEqual(comAbasJuntas(['crm-ia-luiza']), ['crm-ia-luiza']);
  assert.deepEqual(comAbasJuntas(['crm-outbound']), ['crm-outbound']);
  assert.deepEqual(comAbasJuntas([]), []);
});

test('saoAbasJuntas: ARTHUR com LUIZA e com OUTBOUND, nos dois sentidos', () => {
  assert.equal(saoAbasJuntas('crm-arthur', 'crm-ia-luiza'), true);
  assert.equal(saoAbasJuntas('crm-ia-luiza', 'crm-arthur'), true);
  assert.equal(saoAbasJuntas('crm-outbound', 'crm-arthur'), true);
  // As duas de dentro não são a mesma tela entre si: lead do OUTBOUND agendada pela IA ganha cópia na LUIZA.
  assert.equal(saoAbasJuntas('crm-outbound', 'crm-ia-luiza'), false);
  assert.equal(saoAbasJuntas('crm-luis-2', 'crm-ia-luiza'), false);
  assert.equal(saoAbasJuntas('crm-arthur', 'crm-luis-closer'), false);
});
