import test from 'node:test';
import assert from 'node:assert/strict';
import { montarMensagemDeAlertas, type LinhaTicket } from './monitor.js';
import { CONFIG_PADRAO } from './regras.js';

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
  assert.match(txt, /https:\/\/app\.nxsystems\.com\.br\/atendimento\/10/);
  assert.match(txt, /Abertos há mais de 3 dias/);
});

test('mensagem de alertas: corta em 15 itens', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => linha({ ticket_id: String(100 + i), contato_nome: `C${i}` }));
  const txt = montarMensagemDeAlertas(CONFIG_PADRAO, muitos, []);
  assert.match(txt, /e mais 5 no painel/);
  assert.doesNotMatch(txt, /C19/);
});
