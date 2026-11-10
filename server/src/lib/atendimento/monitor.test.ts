import test from 'node:test';
import assert from 'node:assert/strict';
import { filtrarAvisosDoGrupo, montarMensagemDeAlertas, precisaDeAviso, type LinhaTicket } from './monitor.js';
import { CONFIG_PADRAO, normalizarConfig } from './regras.js';

const linha = (p: Partial<LinhaTicket>): LinhaTicket =>
  ({
    ticket_id: '1', status: 'open', user_id: '736', user_name: 'Jean', queue_id: '291', queue_name: 'Suporte', is_group: false,
    contato_nome: 'Cliente', contato_numero: null, client_id: null, situacao: 'sem_resposta', situacao_desde: new Date(), decorrido_min: 18,
    prazo_min: 15, nivel: 1, aberto_longo: false, ultimo_texto_cliente: 'meu canal caiu', ultimo_texto_atendente: '', ...p,
  }) as LinhaTicket;

test('mensagem de alertas: agrupa por situação, escalados primeiro, com link', () => {
  const txt = montarMensagemDeAlertas(
    CONFIG_PADRAO,
    [
      linha({ ticket_id: '10', contato_nome: 'Mercado', nivel: 1 }),
      linha({ ticket_id: '11', contato_nome: 'Clínica', situacao: 'cliente_parou', nivel: 2, decorrido_min: 3000, prazo_min: 1440, ultimo_texto_atendente: 'Pronto, ajustei' }),
      linha({ ticket_id: '12', contato_nome: 'Lassane', is_group: true, situacao: 'promessa', decorrido_min: 130, prazo_min: 120, ultimo_texto_atendente: 'Vou verificar' }),
    ],
    [linha({ ticket_id: '13', contato_nome: 'Pet Shop', aberto_longo: true })],
  );
  assert.match(txt, /4 alertas/);
  assert.ok(txt.indexOf('ESCALADO') < txt.indexOf('Cliente sem resposta'));
  assert.match(txt, /\*Lassane \(grupo\)\* · Jean · há 2h10/);
  assert.match(txt, /_"Vou verificar"_/);
  // A NX não abre o ticket direto: número em cada item e um link só, o do atendimento, no fim.
  assert.match(txt, /· Suporte · #10\n/);
  assert.doesNotMatch(txt, /atendimento\/10/);
  assert.equal(txt.match(/https:\/\/app\.nxsystems\.com\.br\/atendimento/g)?.length, 1);
  assert.match(txt, /🔗 https:\/\/app\.nxsystems\.com\.br\/atendimento$/);
  assert.match(txt, /Abertos há mais de 3 dias/);
});

test('mensagem de alertas: corta em 15 itens', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => linha({ ticket_id: String(100 + i), contato_nome: `C${i}` }));
  const txt = montarMensagemDeAlertas(CONFIG_PADRAO, muitos, []);
  assert.match(txt, /e mais 5 no painel/);
  assert.doesNotMatch(txt, /C19/);
});

test('só avisa quando alguém precisa agir: grupo calado não vira alerta', () => {
  assert.equal(precisaDeAviso({ situacao: 'cliente_parou', nivel: 2, is_group: true }), false);
  assert.equal(precisaDeAviso({ situacao: 'cliente_parou', nivel: 1, is_group: false }), true);
  assert.equal(precisaDeAviso({ situacao: 'sem_resposta', nivel: 1, is_group: true }), true);
  assert.equal(precisaDeAviso({ situacao: 'promessa', nivel: 0, is_group: false }), false);
  assert.equal(precisaDeAviso({ situacao: 'ok', nivel: 2, is_group: false }), false);
});

test('padrão: só "vou verificar" e sumiu vai para o grupo, o resto fica no painel', () => {
  const novos = [
    linha({ ticket_id: '1', situacao: 'sem_resposta' }),
    linha({ ticket_id: '2', situacao: 'promessa' }),
    linha({ ticket_id: '3', situacao: 'fila' }),
    linha({ ticket_id: '4', situacao: 'cliente_parou' }),
    linha({ ticket_id: '5', situacao: 'promessa', nivel: 2 }),
  ];
  const longos = [linha({ ticket_id: '6', aberto_longo: true })];
  const { paraOGrupo, longosNoGrupo } = filtrarAvisosDoGrupo(CONFIG_PADRAO, novos, longos);
  assert.deepEqual(paraOGrupo.map((r) => r.ticket_id), ['2', '5']);
  assert.deepEqual(longosNoGrupo, []);
  assert.equal(CONFIG_PADRAO.avisos.resumo, false);
});

test('config salva sem "avisos" assume o padrão; lista inválida é filtrada', () => {
  assert.deepEqual(normalizarConfig({ resumoHora: '18:00' }).avisos, { situacoes: ['promessa'], abertoLongo: false, resumo: false });
  assert.deepEqual(normalizarConfig({ avisos: { situacoes: ['fila', 'ok', 'xx', 'promessa'], resumo: true } }).avisos, {
    situacoes: ['promessa', 'fila'],
    abertoLongo: false,
    resumo: true,
  });
});
