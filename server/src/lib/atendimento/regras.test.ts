import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_PADRAO, classificar, dentroDoHorario, ehAgradecimento, ehPromessa, estaIgnorado, formatarDuracao,
  lerMensagem, minutosUteis, normalizarConfig, proximaAbertura, resumirConversa, semAssinatura,
  type Mensagem,
} from './regras.js';

// 2026-11-09 é segunda-feira. Brasília = UTC-3, então 08:00 local = 11:00Z.
const br = (dataHora: string) => Date.parse(`${dataHora}:00-03:00`);
const H = CONFIG_PADRAO.horario;
const cfg = CONFIG_PADRAO;

let seq = 0;
const cli = (quando: string, body: string, tipo = 'conversation'): Mensagem => ({ id: `c${++seq}`, fromMe: false, ts: br(quando), userId: null, body, tipo });
const atd = (quando: string, body: string): Mensagem => ({ id: `a${++seq}`, fromMe: true, ts: br(quando), userId: 736, body: `*Jean*:\n ${body}`, tipo: 'chat' });
const bot = (quando: string, body: string): Mensagem => ({ id: `b${++seq}`, fromMe: true, ts: br(quando), userId: null, body, tipo: 'chat' });
const aberto = { status: 'open', userId: 736, criadoEm: br('2026-11-09T07:00'), pendenteDesde: null };

test('horário comercial: dentro/fora e dias da semana', () => {
  assert.equal(dentroDoHorario(br('2026-11-09T08:00'), H), true);
  assert.equal(dentroDoHorario(br('2026-11-09T17:59'), H), true);
  assert.equal(dentroDoHorario(br('2026-11-09T18:00'), H), false);
  assert.equal(dentroDoHorario(br('2026-11-09T07:59'), H), false);
  assert.equal(dentroDoHorario(br('2026-11-14T10:00'), H), false); // sábado
});

test('minutos úteis: só conta o expediente e pula a noite e o fim de semana', () => {
  assert.equal(minutosUteis(br('2026-11-09T09:00'), br('2026-11-09T09:15'), H), 15);
  // 17:55 → 08:10 do dia seguinte = 5 + 10
  assert.equal(minutosUteis(br('2026-11-09T17:55'), br('2026-11-10T08:10'), H), 15);
  // sexta 17:00 → segunda 09:00 = 60 + 60
  assert.equal(minutosUteis(br('2026-11-13T17:00'), br('2026-11-16T09:00'), H), 120);
  // mensagem de madrugada só começa a contar às 08:00
  assert.equal(minutosUteis(br('2026-11-10T02:00'), br('2026-11-10T08:05'), H), 5);
  assert.equal(minutosUteis(br('2026-11-10T10:00'), br('2026-11-10T09:00'), H), 0);
});

test('próxima abertura do expediente', () => {
  assert.equal(proximaAbertura(br('2026-11-09T10:00'), H), br('2026-11-09T10:00'));
  assert.equal(proximaAbertura(br('2026-11-09T19:00'), H), br('2026-11-10T08:00'));
  assert.equal(proximaAbertura(br('2026-11-14T10:00'), H), br('2026-11-16T08:00'));
});

test('promessas de retorno', () => {
  for (const t of ['Vou verificar e já te retorno', 'Já te retorno', 'estou verificando aqui', 'Aguarde um momento', 'só um minuto', 'Deixa eu ver isso', 'vou passar para a equipe técnica', 'assim que eu tiver uma posição te aviso', 'Vamos analisar']) {
    assert.equal(ehPromessa(t), true, t);
  }
  for (const t of ['Pronto, ajustei aqui. Pode testar?', 'Bom dia! Tudo certo?', 'Resolvido ✅', 'Segue o link do tutorial']) {
    assert.equal(ehPromessa(t), false, t);
  }
  assert.equal(ehPromessa('*Jean*:\n Vou verificar'), true);
  assert.equal(semAssinatura('*Jean*:\n Ajustei isto agora'), 'Ajustei isto agora');
});

test('agradecimentos que encerram a conversa', () => {
  for (const t of ['ok', 'Obrigado!', 'valeu, resolveu', '👍', 'blz obrigada', 'Show de bola', 'perfeito, muito obrigado 🙏']) {
    assert.equal(ehAgradecimento(t), true, t);
  }
  for (const t of ['ok mas ainda não funcionou', 'obrigado, e o outro canal?', 'não deu certo']) {
    assert.equal(ehAgradecimento(t), false, t);
  }
  assert.equal(ehAgradecimento('', 'audio'), false);
  assert.equal(ehAgradecimento('', 'sticker'), true);
});

test('lerMensagem: formato da API da NX', () => {
  const m = lerMensagem({ id: 'x', fromMe: false, timestamp: '1794226283000', userId: null, body: 'oi', mediaType: 'conversation' });
  assert.equal(m?.ts, 1794226283000);
  assert.equal(lerMensagem({ id: 'y', timestamp: '1', mediaType: 'transfer' }), null);
  assert.equal(lerMensagem({ id: 'z', isDeleted: true, timestamp: '1794226283000' }), null);
  assert.equal(lerMensagem({ id: 's', createdAt: '2026-11-09T12:00:00Z', mediaType: 'chat', fromMe: true, userId: 5 })?.userId, 5);
  assert.equal(lerMensagem({ id: 'seg', timestamp: '1794226283', mediaType: 'chat' })?.ts, 1794226283000);
});

test('cliente sem resposta: relógio desde a 1ª mensagem dele sem resposta', () => {
  const msgs = [cli('2026-11-09T09:00', 'oi'), atd('2026-11-09T09:02', 'Olá!'), cli('2026-11-09T09:10', 'meu canal caiu'), cli('2026-11-09T09:12', 'alguém?')];
  const r = resumirConversa(msgs, H);
  assert.equal(r.ultimaDe, 'cliente');
  assert.equal(r.esperaDesde, br('2026-11-09T09:10'));
  assert.equal(r.primeiraRespostaMin, 2);
  const c = classificar(aberto, r, cfg, br('2026-11-09T09:24'));
  assert.equal(c.situacao, 'sem_resposta');
  assert.equal(c.decorridoMin, 14);
  assert.equal(c.nivel, 0);
  assert.equal(classificar(aberto, r, cfg, br('2026-11-09T09:25')).nivel, 1);
  assert.equal(classificar(aberto, r, cfg, br('2026-11-09T09:40')).nivel, 2);
});

test('mensagem do bot não conta como resposta do atendente', () => {
  const r = resumirConversa([cli('2026-11-09T10:00', 'preciso de ajuda'), bot('2026-11-09T10:00', 'Olá, escolha uma opção')], H);
  assert.equal(r.ultimaDe, 'cliente');
  assert.equal(classificar(aberto, r, cfg, br('2026-11-09T10:20')).situacao, 'sem_resposta');
});

test('"vou verificar" e sumiu: 2h úteis', () => {
  const r = resumirConversa([cli('2026-11-09T10:00', 'não envia mensagem'), atd('2026-11-09T10:05', 'Vou verificar e já te retorno')], H);
  const c = classificar(aberto, r, cfg, br('2026-11-09T12:05'));
  assert.equal(c.situacao, 'promessa');
  assert.equal(c.nivel, 1);
  // A IA pode discordar das palavras-chave
  assert.equal(classificar(aberto, r, cfg, br('2026-11-09T12:05'), 'resolvido').situacao, 'cliente_parou');
});

test('atendente respondeu e o cliente parou: 24h corridas', () => {
  const r = resumirConversa([cli('2026-11-09T14:00', 'como faço o template?'), atd('2026-11-09T14:10', 'Segue o passo a passo: ...')], H);
  const c = classificar(aberto, r, cfg, br('2026-11-10T14:09'));
  assert.equal(c.situacao, 'cliente_parou');
  assert.equal(c.nivel, 0);
  assert.equal(c.contaHorarioComercial, false);
  assert.equal(classificar(aberto, r, cfg, br('2026-11-10T14:10')).nivel, 1);
});

test('cliente só agradeceu: não é "sem resposta"', () => {
  const r = resumirConversa([cli('2026-11-09T14:00', 'ajuda'), atd('2026-11-09T14:05', 'Pronto, ajustado'), cli('2026-11-09T14:06', 'valeu!! 👍')], H);
  assert.equal(r.clienteEncerrou, true);
  const c = classificar(aberto, r, cfg, br('2026-11-09T15:00'));
  assert.equal(c.situacao, 'cliente_parou');
  assert.equal(c.desde, br('2026-11-09T14:06'));
});

test('conversa anda: o relógio zera', () => {
  const msgs = [cli('2026-11-09T09:00', 'oi, problema'), atd('2026-11-09T09:30', 'Vou verificar')];
  const antes = classificar(aberto, resumirConversa(msgs, H), cfg, br('2026-11-09T11:40'));
  assert.equal(antes.situacao, 'promessa');
  const depois = classificar(aberto, resumirConversa([...msgs, atd('2026-11-09T11:00', 'Pronto, resolvido. Pode testar?')], H), cfg, br('2026-11-09T11:40'));
  assert.equal(depois.situacao, 'cliente_parou');
  assert.equal(depois.nivel, 0);
});

test('na fila sem dono e aberto há dias', () => {
  const pend = { status: 'pending', userId: null, criadoEm: br('2026-11-05T09:00'), pendenteDesde: br('2026-11-09T09:00') };
  const c = classificar(pend, resumirConversa([cli('2026-11-09T09:00', 'oi')], H), cfg, br('2026-11-09T09:11'));
  assert.equal(c.situacao, 'fila');
  assert.equal(c.nivel, 1);
  assert.equal(c.abertoLongo, true);
  // pendente mas com atendente atribuído não é "fila"
  const comDono = classificar({ ...pend, userId: 3 }, resumirConversa([cli('2026-11-09T09:00', 'oi')], H), cfg, br('2026-11-09T09:11'));
  assert.equal(comDono.situacao, 'sem_resposta');
});

test('normalizarConfig: valida e completa com o padrão', () => {
  const c = normalizarConfig({ prazos: { semRespostaMin: '30', promessaMin: -1 }, horario: { inicio: '09:00', fim: '07:00', dias: [1, 9, 2] }, ignorar: [' 5511 ', '', '5511'] });
  assert.equal(c.prazos.semRespostaMin, 30);
  assert.equal(c.prazos.promessaMin, 120);
  assert.equal(c.horario.inicio, '09:00');
  assert.equal(c.horario.fim, '18:00');
  assert.deepEqual(c.horario.dias, [1, 2]);
  assert.deepEqual(c.ignorar, ['5511']);
  assert.equal(normalizarConfig(null).ativo, true);
  assert.equal(normalizarConfig({ resumoHora: '' }).resumoHora, '');
});

test('formatarDuracao e estaIgnorado', () => {
  assert.equal(formatarDuracao(8), '8 min');
  assert.equal(formatarDuracao(80), '1h20');
  assert.equal(formatarDuracao(180), '3h');
  assert.equal(formatarDuracao(60 * 49), '2d 1h');
  assert.equal(formatarDuracao(60 * 48), '2 dias');
  assert.equal(estaIgnorado(['120363409254876877'], { numero: '120363409254876877@g.us' }), true);
  assert.equal(estaIgnorado(['Equipe NX interno'], { nome: 'equipe nx interno' }), true);
  assert.equal(estaIgnorado(['5511999990000'], { numero: '5511888880000' }), false);
});

test('ignorar por trecho do nome, sem acento nem maiúscula', () => {
  const lista = ['SUPORTE GERAL', 'monitoramento', 'mercado nunes', 'isabel'];
  for (const nome of ['SUPORTE GERAL NX', 'Suporte Geral | Grupo NX', 'Monitoramento de Canais', 'Mercado Nunes - Tabloide', 'Isabel', 'Isabela Souza', 'Grupo Monitoramento NX']) {
    assert.equal(estaIgnorado(lista, { nome }), true, nome);
  }
  for (const nome of ['Lassane TI - NX', 'Mercado Bom Preço', 'Suporte Lassane', 'Anabel']) {
    assert.equal(estaIgnorado(lista, { nome }), false, nome);
  }
  assert.equal(estaIgnorado(['Mônitoramento'], { nome: 'monitoramento' }), true);
  assert.equal(estaIgnorado(['ab'], { nome: 'ab cd' }), false); // curto demais
  assert.equal(estaIgnorado(['120363409254876877@g.us'], { numero: '120363409254876877' }), true);
});
