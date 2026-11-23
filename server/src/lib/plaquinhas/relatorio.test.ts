import test from 'node:test';
import assert from 'node:assert/strict';
import { lerRelatorio, limparNome } from './relatorio.js';

const HOJE = new Date(2026, 10, 17);

test('limparNome expande abreviações e separa o peso', () => {
  assert.deepEqual(limparNome('BISC.COOKIES BAUDUCCO 96G/100G'), { produto: 'BISCOITO COOKIES BAUDUCCO', peso: '96G/100G' });
  assert.deepEqual(limparNome('SABAO PO BRILHANTE CX 800G CUIDADO TOTAL'), { produto: 'SABÃO EM PÓ BRILHANTE CAIXA CUIDADO TOTAL', peso: '800G' });
  assert.deepEqual(limparNome('COPO NADIR PAULISTA 250ML 7002'), { produto: 'COPO NADIR PAULISTA', peso: '250ML' });
  assert.deepEqual(limparNome('REFRIG.GUARANA ANT.600ML'), { produto: 'REFRIGERANTE GUARANÁ ANTARCTICA', peso: '600ML' });
});

test('relatório em tabela: preço de/por, ignora inativo e repetido', () => {
  const r = lerRelatorio(
    [
      'Se??o: 11 - PRODUTOS LIMPEZA',
      '34 16/11/2026 30/11/2026 1 116253 7896040706254 LIMPADOR CASA E PERFUME 1L 8,30 11,99 6,49 -21,81 SIM',
      '34 16/11/2026 30/11/2026 1 116253 7896040706254 LIMPADOR CASA E PERFUME 1L 8,30 11,99 6,49 -21,81 SIM',
      '34 16/11/2026 30/11/2026 1 111979 7891150091511 SABAO PO BRILHANTE CX 800G CUIDADO TOTAL8,54 11,99 9,99 16,98 SIM',
      '34 16/11/2026 30/11/2026 1 6901 7891962015484 BOLINHO BAUDUCCO 40G 1,17 2,19 1,99 70,09 N?O',
    ],
    HOJE,
  );
  assert.equal(r.modelo, 'tabela');
  assert.equal(r.itens.length, 2);
  assert.equal(r.inativos, 1);
  assert.equal(r.repetidos, 1);
  assert.equal(r.itens[0].preco, '6,49');
  assert.equal(r.itens[0].precoDe, '11,99');
  assert.equal(r.itens[0].grupo, 'PRODUTOS LIMPEZA');
  assert.equal(r.itens[1].peso, '800G');
});

test('blocos: promoção que não gera preço e nome colado no Ativo não contaminam a anterior', () => {
  const r = lerRelatorio(
    [
      'C?digo: 795 - CERV.LOHN PREMIUN 600ML Ativo: SIM Gerar Pre?os: SIM',
      'Data do In?cio: 23/11/2026 Data do Fim: 30/11/2026',
      'Qtd. p/ ativar: 6,00 Valor promo??o: 4,19',
      'DESCONTO 108142 73343 CERV.LOHN PREMIUM 600ml LAGER 6,00',
      'C?digo: 1126 - Reembolso fixo de R$ 1,02 por unidade / Consulte eAtivo: SIM Gerar Pre?os: N?O',
      'Data do In?cio: 27/11/2026 Data do Fim: 29/11/2026',
      'Qtd. p/ ativar: 1,00 Valor promo??o: 8,49',
      'DESCONTO 102750 65194 ALIM.SOJA ADES 1L ORIGINAL 1,00',
    ],
    HOJE,
  );
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].preco, '4,19');
  assert.equal(r.itens[0].fim, '30/11/2026');
  assert.equal(r.inativos, 1);
});

test('relatório "Produtos por Promoção": uma linha por produto', () => {
  const r = lerRelatorio(
    [
      'Produto C?d. Barras Nome Vlr. Venda Vlr. Promo? Data do In?cio Data do Fim',
      '102112 5000329002537 BEB.GIN BEEFEATER LONDON 750ML 0,00 89,00 23/11/2026 30/11/2026',
      '112836 7898349705532 RACAO BIRBO 10,1Kg CARNE 0,00 69,90 23/11/2026 30/11/2026',
      '3304 7896022200756 MACAR.GALO 500G ESPAGUETE 12,00 2,99 23/11/2026 30/11/2026',
    ],
    HOJE,
  );
  assert.equal(r.modelo, 'produtos');
  assert.equal(r.itens.length, 3);
  assert.equal(r.itens[0].produtoId, '102112');
  assert.equal(r.itens[0].preco, '89,00');
  assert.equal(r.itens[0].precoDe, '');
  assert.equal(r.itens[2].precoDe, '12,00');
  assert.equal(r.itens[2].fim, '30/11/2026');
});

test('relatório em blocos: quantidade mínima, sem fim e vencidos', () => {
  const r = lerRelatorio(
    [
      'C?digo: 4 - CERV.SCHIN 350ML LATA Ativo: SIM Gerar Pre?os: SIM',
      'Data do In?cio: 08/01/2016 Data do Fim: 01/01/2100',
      'Qtd. p/ ativar: 12,00 Valor promo??o: 2,79',
      'DESCONTO 85041 39903 CERV.SCHIN LATA 350ML 12,00',
      'C?digo: 9 - REFRIG.VELHO 600ML Ativo: SIM Gerar Pre?os: SIM',
      'Data do In?cio: 08/01/2016 Data do Fim: 30/12/2020',
      'Qtd. p/ ativar: 6,00 Valor promo??o: 3,49',
      'DESCONTO 4793 2076 REFRIG.VELHO 600ML 6,00',
    ],
    HOJE,
  );
  assert.equal(r.modelo, 'blocos');
  assert.equal(r.itens.length, 1);
  assert.equal(r.vencidos, 1);
  assert.equal(r.itens[0].minUnidades, '12');
  assert.equal(r.itens[0].fim, '');
  assert.equal(r.itens[0].produto, 'CERVEJA SCHIN LATA');
});
