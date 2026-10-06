import test from 'node:test';
import assert from 'node:assert/strict';
import { montarJornadaPublica, type EntradaJornada } from './gcPortalJornada.js';

/**
 * O que NUNCA pode chegar ao cliente: estratégia e premissas. Estes textos-isca atravessam a
 * montagem em todas as combinações de interruptores, e o teste procura por eles na saída inteira —
 * tanto como texto quanto como NOME de campo, em qualquer profundidade.
 */
const SEGREDO_ESTRATEGIA = 'SEGREDO-ESTRATEGIA-NAO-PODE-VAZAR';
const SEGREDO_PREMISSA = 'SEGREDO-PREMISSA-NAO-PODE-VAZAR';
const SEGREDO_EXTRA = 'SEGREDO-COLUNA-EXTRA-NAO-PODE-VAZAR';

function entrada(sobre: Partial<EntradaJornada['planejamento'] & object> = {}, extra: Partial<EntradaJornada> = {}): EntradaJornada {
  return {
    planejamento: {
      situacao_atual: 'Clínica com 3 unidades',
      leads_mes: '100', investimento_mes: '2000', ticket_medio: '800', taxa_conversao: '8', faturamento_mensal: '6400',
      data_diagnostico: '2026-03-15', curva: 'composta',
      portal_ativo: true, portal_mostrar_situacao: false, portal_mostrar_objetivo: false,
      // Colunas que NÃO deveriam nem estar na linha: simulam um SELECT * descuidado no futuro.
      estrategia_geral: SEGREDO_EXTRA, premissas: SEGREDO_PREMISSA,
      ...sobre,
    },
    metas: [
      { horizonte: '6_meses', chave_metrica: 'leads', valor_meta: '300', estrategia: SEGREDO_ESTRATEGIA } as never,
      { horizonte: '6_meses', chave_metrica: 'cpl', valor_meta: '12' },
      { horizonte: '12_meses', chave_metrica: 'receita', valor_meta: '24000' },
    ],
    cenarios: [
      { horizonte: '6_meses', onde_quer_chegar: 'Dobrar os leads', estrategia: SEGREDO_ESTRATEGIA, premissas: SEGREDO_PREMISSA },
      { horizonte: '12_meses', onde_quer_chegar: 'Ser referência', estrategia: SEGREDO_ESTRATEGIA, premissas: SEGREDO_PREMISSA },
    ],
    realizado: [
      { chave: 'leads', mes: '2026-04', valor: '118' },
      { chave: 'investimento', mes: '2026-04', valor: '2100' },
    ],
    ...extra,
  };
}

/** Todos os nomes de campo de um objeto, em qualquer profundidade. */
function chavesDe(valor: unknown, acumulado = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) valor.forEach((v) => chavesDe(v, acumulado));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) {
      acumulado.add(k);
      chavesDe(v, acumulado);
    }
  }
  return acumulado;
}

function semVazamento(saida: unknown, contexto: string) {
  const texto = JSON.stringify(saida);
  for (const segredo of [SEGREDO_ESTRATEGIA, SEGREDO_PREMISSA, SEGREDO_EXTRA]) {
    assert.ok(!texto.includes(segredo), `${contexto}: "${segredo}" apareceu na saída`);
  }
  const nomes = chavesDe(saida);
  for (const proibido of ['estrategia', 'premissas', 'estrategia_geral']) {
    assert.ok(!nomes.has(proibido), `${contexto}: o campo "${proibido}" apareceu na saída`);
  }
}

test('estratégia e premissas não saem em NENHUMA combinação de interruptores', () => {
  for (const ativo of [true, false]) {
    for (const situacao of [true, false]) {
      for (const objetivo of [true, false]) {
        const e = entrada({ portal_ativo: ativo, portal_mostrar_situacao: situacao, portal_mostrar_objetivo: objetivo });
        const contexto = `ativo=${ativo} situacao=${situacao} objetivo=${objetivo}`;
        semVazamento(montarJornadaPublica(e), contexto);
        // A prévia ignora o interruptor do portal, e tem que ser tão blindada quanto o portal.
        semVazamento(montarJornadaPublica(e, { ignorarToggle: true }), `${contexto} (prévia)`);
      }
    }
  }
});

test('mesmo uma coluna desconhecida na linha (SELECT * futuro) não atravessa', () => {
  const saida = montarJornadaPublica(entrada({ qualquer_coluna_nova: SEGREDO_EXTRA, outra: { dentro: SEGREDO_EXTRA } }));
  semVazamento(saida, 'colunas extras');
});

test('portal desligado: nada sai; a prévia monta mesmo assim', () => {
  const e = entrada({ portal_ativo: false });
  assert.equal(montarJornadaPublica(e), null);
  assert.notEqual(montarJornadaPublica(e, { ignorarToggle: true }), null);
});

test('sem planejamento: nada sai, nem na prévia', () => {
  assert.equal(montarJornadaPublica({ ...entrada(), planejamento: null }), null);
  assert.equal(montarJornadaPublica({ ...entrada(), planejamento: null }, { ignorarToggle: true }), null);
});

test('situação de hoje e "onde quer chegar" só saem se marcados, e cada um por si', () => {
  let j = montarJornadaPublica(entrada())!;
  assert.equal(j.situacao, null);
  assert.equal(j.cenarios['6_meses'].objetivo, null);

  j = montarJornadaPublica(entrada({ portal_mostrar_situacao: true }))!;
  assert.equal(j.situacao, 'Clínica com 3 unidades');
  assert.equal(j.cenarios['6_meses'].objetivo, null, 'marcar a situação não libera o objetivo');

  j = montarJornadaPublica(entrada({ portal_mostrar_objetivo: true }))!;
  assert.equal(j.situacao, null, 'marcar o objetivo não libera a situação');
  assert.equal(j.cenarios['6_meses'].objetivo, 'Dobrar os leads');
  assert.equal(j.cenarios['12_meses'].objetivo, 'Ser referência');
});

test('texto em branco (só espaços) vira nulo, não string vazia', () => {
  const j = montarJornadaPublica(entrada({ portal_mostrar_situacao: true, situacao_atual: '   ' }))!;
  assert.equal(j.situacao, null);
});

test('metas: só as 6 métricas do planejamento e só os horizontes de 6 e 12 meses', () => {
  const j = montarJornadaPublica(
    entrada({}, {
      metas: [
        { horizonte: '6_meses', chave_metrica: 'leads', valor_meta: '300' },
        { horizonte: '6_meses', chave_metrica: 'conversao', valor_meta: '10' },
        { horizonte: 'mes', chave_metrica: 'leads', valor_meta: '999' },
        { horizonte: '12_meses', chave_metrica: 'roas', valor_meta: 'abc' },
      ],
    })
  )!;
  assert.deepEqual(j.cenarios['6_meses'].metas, { leads: 300 });
  assert.deepEqual(j.cenarios['12_meses'].metas, {}, 'valor inválido não vira número');
});

test('realizado: só as métricas liberadas ao portal', () => {
  const j = montarJornadaPublica(
    entrada({}, {
      realizado: [
        { chave: 'leads', mes: '2026-04', valor: '118' },
        { chave: 'cliques', mes: '2026-04', valor: '5000' },
        { chave: 'cpl', mes: '2026-04', valor: '20' },
      ],
    })
  )!;
  assert.deepEqual(j.realizado.leads, { '2026-04': 118 });
  assert.equal('cliques' in j.realizado, false);
  assert.equal('cpl' in j.realizado, false);
});

test('números do ponto A viram número, e ausente vira nulo (não zero)', () => {
  const j = montarJornadaPublica(entrada({ leads_mes: '100', ticket_medio: null, taxa_conversao: '' }))!;
  assert.equal(j.atual.leads, 100);
  assert.equal(j.atual.ticket, null);
  assert.equal(j.atual.conversao, null);
});
