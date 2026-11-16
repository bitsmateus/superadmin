import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { aplicarPlano, desfazerEmMemoria, planejarImportacao, type BatidaExistente, type BatidaLida } from './importacao.js';
import { lerData, lerHora, lerPlanilha, validarArquivo, vincularNome } from './planilha.js';

const J = 'jean';
const lidas = (data: string, horas: string[], colaboradorId = J): BatidaLida[] => horas.map((hora) => ({ colaboradorId, data, hora }));
const NOV = { inicio: '2026-11-01', fim: '2026-11-30' };

test('primeira importação: tudo novo', () => {
  const p = planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '12:00', '14:00', '18:00']), existentes: [], periodo: NOV });
  assert.equal(p.inserir.length, 4);
  assert.equal(p.novos, 4);
});

test('reimportar o mesmo mês não duplica, e completa os dias novos', () => {
  const antes = planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '12:00']), existentes: [], periodo: NOV });
  let banco = aplicarPlano([], antes, 'imp1');
  const de_novo = planejarImportacao({
    lidas: [...lidas('2026-11-03', ['08:00', '12:00', '14:00', '18:00']), ...lidas('2026-11-04', ['08:00', '18:00'])],
    existentes: banco, periodo: NOV,
  });
  assert.equal(de_novo.conflitos.length, 0);
  assert.equal(de_novo.atualizados, 2); // 14:00 e 18:00 do dia 3
  assert.equal(de_novo.novos, 2); // dia 4
  assert.equal(de_novo.ignorados, 2); // 08:00 e 12:00 do dia 3 já existiam
  banco = aplicarPlano(banco, de_novo, 'imp2');
  assert.equal(banco.length, 6);
  const terceira = planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '12:00', '14:00', '18:00']), existentes: banco, periodo: NOV });
  assert.equal(terceira.inserir.length, 0);
});

test('batida diferente no mesmo dia: conflito; sem decisão mantém, "substituir" troca', () => {
  const banco = aplicarPlano([], planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '12:00']), existentes: [], periodo: NOV }), 'imp1');
  const nova = lidas('2026-11-03', ['08:05', '12:00']);
  const manter = planejarImportacao({ lidas: nova, existentes: banco, periodo: NOV });
  assert.equal(manter.conflitos.length, 1);
  assert.deepEqual(manter.conflitos[0], { colaboradorId: J, data: '2026-11-03', atuais: ['08:00', '12:00'], novas: ['08:05', '12:00'] });
  assert.equal(manter.inserir.length, 0);
  const trocar = planejarImportacao({ lidas: nova, existentes: banco, periodo: NOV, decisoes: { [`${J}|2026-11-03`]: 'substituir' } });
  assert.deepEqual(trocar.remover.map((r) => r.hora), ['08:00']);
  assert.deepEqual(trocar.inserir.map((r) => r.hora), ['08:05']);
  const depois = aplicarPlano(banco, trocar, 'imp2');
  assert.deepEqual(depois.map((b) => b.hora).sort(), ['08:05', '12:00']);
});

test('modo período: só entram as datas escolhidas', () => {
  const p = planejarImportacao({
    lidas: [...lidas('2026-11-03', ['08:00', '18:00']), ...lidas('2026-11-04', ['08:00', '18:00']), ...lidas('2026-11-05', ['08:00'])],
    existentes: [], periodo: { inicio: '2026-11-04', fim: '2026-11-04' },
  });
  assert.equal(p.inserir.length, 2);
  assert.ok(p.inserir.every((b) => b.data === '2026-11-04'));
  assert.equal(p.foraDoPeriodo, 3);
});

test('batida repetida no próprio arquivo não entra duas vezes', () => {
  const p = planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '08:00', '12:00']), existentes: [], periodo: NOV });
  assert.equal(p.inserir.length, 2);
  assert.equal(p.duplicadasNoArquivo, 1);
});

test('desfazer: tira só o que a importação trouxe e devolve o que ela substituiu', () => {
  let banco = aplicarPlano([], planejarImportacao({ lidas: lidas('2026-11-03', ['08:00', '12:00']), existentes: [], periodo: NOV }), 'imp1');
  const segunda = planejarImportacao({
    lidas: [...lidas('2026-11-03', ['08:05', '12:00']), ...lidas('2026-11-04', ['08:00', '18:00'])],
    existentes: banco, periodo: NOV, decisoes: { [`${J}|2026-11-03`]: 'substituir' },
  });
  banco = aplicarPlano(banco, segunda, 'imp2');
  const desfeito = desfazerEmMemoria(banco, 'imp2', segunda.remover);
  assert.deepEqual(desfeito.map((b) => `${b.data} ${b.hora}`).sort(), ['2026-11-03 08:00', '2026-11-03 12:00']);
  assert.ok(desfeito.every((b) => b.importacaoId === 'imp1'));
});

// ───────────── leitura da planilha ─────────────

function xlsx(linhas: unknown[][], aba = 'Planilha1'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), aba);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('lerData / lerHora: dd/mm/aaaa, série do Excel, frações e hh:mm:ss', () => {
  assert.equal(lerData('03/11/2026'), '2026-11-03');
  assert.equal(lerData('2026-11-03'), '2026-11-03');
  assert.equal(lerData(46329), '2026-11-03');
  assert.equal(lerData('31/02/2026'), null);
  assert.equal(lerHora('8:05'), '08:05');
  assert.equal(lerHora('18:05:44'), '18:05');
  assert.equal(lerHora(0.5), '12:00');
});

test('planilha com várias batidas por linha e vários colaboradores', () => {
  const buf = xlsx([
    ['Relatório de ponto'],
    ['Nome', 'Data', 'Entrada 1', 'Saída 1', 'Entrada 2', 'Saída 2'],
    ['JEAN MAY', '03/11/2026', '08:01', '12:00', '14:02', '18:05'],
    ['João Victor', '03/11/2026', '08:20', '12:00', '', ''],
    ['Arthur', '04/11/2026', '22:00', '02:10', '', ''],
    ['Total', '', '', '', '', ''],
  ]);
  const l = lerPlanilha(buf);
  assert.equal(l.abas[0].precisaMapeamento, false);
  assert.equal(l.registros.length, 3);
  assert.deepEqual(l.registros[0].horas, ['08:01', '12:00', '14:02', '18:05']);
  assert.deepEqual(l.registros[2].horas, ['22:00', '26:10']); // passou da meia-noite na mesma linha
  assert.deepEqual(l.periodo, { inicio: '2026-11-03', fim: '2026-11-04' });
  assert.equal(l.mesProvavel, '2026-11');
});

test('planilha uma linha por batida (csv com ;) e nome no topo', () => {
  const csv = Buffer.from('Funcionário: Jean May\nData;Hora\n03/11/2026;08:00\n03/11/2026;12:00\n', 'utf8');
  const l = lerPlanilha(csv);
  assert.equal(l.abas[0].precisaMapeamento, false);
  assert.equal(l.registros.length, 2);
  assert.equal(l.registros[0].nome, 'Jean May');
});

test('cabeçalho desconhecido: pede mapeamento; com o mapeamento, lê', () => {
  const buf = xlsx([['Func', 'Dt', 'M1', 'M2'], ['Jean', '03/11/2026', '08:00', '12:00']]);
  const l = lerPlanilha(buf);
  assert.equal(l.abas[0].precisaMapeamento, true);
  assert.equal(l.registros.length, 0);
  const comMapa = lerPlanilha(buf, {}, { Planilha1: { linhaCabecalho: 0, colunas: { 0: 'nome', 1: 'data', 2: 'batida', 3: 'batida' } } });
  assert.equal(comMapa.registros.length, 1);
  // mapeamento salvo pela assinatura vale nas próximas
  const salvo = lerPlanilha(buf, { [l.abas[0].assinatura]: { linhaCabecalho: 0, colunas: { 0: 'nome', 1: 'data', 2: 'batida', 3: 'batida' } } });
  assert.equal(salvo.registros.length, 1);
});

test('mapeamento salvo vale mesmo com o cabeçalho em outra linha', () => {
  const mapa = { linhaCabecalho: 3, colunas: { 0: 'nome', 1: 'data', 2: 'batida', 3: 'batida' } as const };
  const comTitulo = xlsx([['Empresa X'], ['Relatório'], [''], ['Func', 'Dt', 'M1', 'M2'], ['Jean', '03/11/2026', '08:00', '12:00']]);
  const primeira = lerPlanilha(comTitulo, {}, { Planilha1: mapa });
  assert.equal(primeira.registros.length, 1);
  const salvos = { [primeira.abas[0].assinatura]: mapa };
  const semTitulo = xlsx([['Func', 'Dt', 'M1', 'M2'], ['Jean', '04/11/2026', '08:00', '12:00']]);
  const depois = lerPlanilha(semTitulo, salvos);
  assert.equal(depois.abas[0].precisaMapeamento, false);
  assert.equal(depois.registros.length, 1);
  assert.equal(depois.registros[0].data, '2026-11-04');
});

test('linha com horário e sem data vira inválida, sem quebrar o resto', () => {
  const l = lerPlanilha(xlsx([['Nome', 'Data', 'Hora'], ['Jean', 'ontem', '08:00'], ['Jean', '03/11/2026', '12:00']]));
  assert.equal(l.registros.length, 1);
  assert.equal(l.invalidas.length, 1);
});

test('validarArquivo: extensão, tamanho e assinatura', () => {
  assert.match(validarArquivo('ponto.pdf', Buffer.from('x')) ?? '', /Formato/);
  assert.match(validarArquivo('ponto.xlsx', Buffer.from('nao é zip')) ?? '', /xlsx/);
  assert.equal(validarArquivo('ponto.csv', Buffer.from('a;b\n1;2')), null);
  assert.match(validarArquivo('ponto.csv', Buffer.alloc(5 * 1024 * 1024 + 1, 65)) ?? '', /5 MB/);
});

test('vincularNome: sem acento/maiúscula, apelido e primeiro nome único', () => {
  const cs = [
    { id: 'j', nome: 'João', apelidos: [], ativo: true },
    { id: 'e', nome: 'Jean', apelidos: ['J. MAY'], ativo: true },
    { id: 'a', nome: 'Arthur', apelidos: [], ativo: true },
  ];
  assert.equal(vincularNome('JOAO', cs), 'j');
  assert.equal(vincularNome('Jean Carlos May', cs), 'e');
  assert.equal(vincularNome('j. may', cs), 'e');
  assert.equal(vincularNome('Maria', cs), null);
});
