/**
 * Rateio do boi: a partir do custo da carcaça, distribui o preço entre os cortes.
 *
 * A ideia é a do açougue de verdade: o boi inteiro precisa render o custo + a margem. Cada corte
 * participa com um pedaço do peso (`participacao`) e vale mais ou menos que a média (`indice`) —
 * picanha ~2,5, músculo ~0,7. Em vez de multiplicar cada corte por um fator solto (que não fecha
 * conta nenhuma), resolvemos o preço médio `k` que faz a venda da carcaça inteira bater exatamente
 * na receita alvo, e o preço de cada corte é `k × indice`.
 */

export type Unidade = 'kg' | 'arroba' | 'peca';
export type Arredondamento = 'nenhum' | 'centavo90' | 'centavo99' | 'centavo50' | 'inteiro';

/** 1 arroba = 15 kg (padrão do boi no Brasil). */
export const KG_POR_ARROBA = 15;

export interface Corte {
  id: string;
  nome: string;
  /** Código do produto no sistema do mercado (Maxwork) — só pra exportar/conferir. */
  codigo?: string;
  /** % do peso da carcaça que esse corte representa. */
  participacao: number;
  /** Quanto o corte vale em relação à média (1 = na média). */
  indice: number;
  /** % que se perde limpando/aparando esse corte (reduz o peso vendável). */
  quebra?: number;
  /** Preço praticado hoje — base pra calcular os índices e pra comparar antes × depois. */
  precoAtual?: number;
  /** Preço travado: não recalcula, e o rateio redistribui o resto pra margem continuar fechando. */
  travado?: boolean;
  ativo?: boolean;
}

export interface BaseCalculo {
  unidade: Unidade;
  /** Valor digitado, na unidade escolhida. */
  custo: number;
  /** Só quando unidade = 'peca': quantos kg tem a peça comprada. */
  pesoPeca?: number;
  /** Markup sobre o custo, em %. 30 = vender por 1,30× o custo. */
  margem: number;
  arredondamento?: Arredondamento;
}

export interface CorteCalculado extends Corte {
  /** Peso vendável desse corte em 100 kg de carcaça (já descontada a quebra). */
  pesoVendavel: number;
  precoNovo: number;
  /** Preço antes de arredondar — só pra explicar a diferença. */
  precoExato: number;
  variacao: number | null;
  variacaoPct: number | null;
}

export interface Resultado {
  custoKg: number;
  cortes: CorteCalculado[];
  /** Preço médio do kg que fecha a conta (o `k` da explicação acima). */
  precoMedio: number;
  receitaAlvo: number;
  /** Receita de verdade depois do arredondamento — pode ficar um pouco acima/abaixo do alvo. */
  receitaReal: number;
  /** Margem real obtida (%), já com arredondamento e cortes travados. */
  margemReal: number;
  /** Soma das participações (%) — avisa quando não fecha ~100. */
  participacaoTotal: number;
  avisos: string[];
}

/** Converte o que foi digitado (arroba, peça ou kg) pro custo por quilo. */
export function custoPorKg(base: BaseCalculo): number {
  const custo = Number(base.custo) || 0;
  if (base.unidade === 'arroba') return custo / KG_POR_ARROBA;
  if (base.unidade === 'peca') {
    const peso = Number(base.pesoPeca) || 0;
    return peso > 0 ? custo / peso : 0;
  }
  return custo;
}

function arredondar(valor: number, modo: Arredondamento = 'nenhum'): number {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  if (modo === 'nenhum') return Math.round(valor * 100) / 100;
  if (modo === 'inteiro') return Math.max(1, Math.round(valor));
  const centavos = modo === 'centavo90' ? 0.9 : modo === 'centavo99' ? 0.99 : 0.5;
  // Fica no ",90/,99/,50" mais próximo, pra cima ou pra baixo (ex.: 22,40 → 22,50; 22,80 → 22,90).
  const baixo = Math.floor(valor) + centavos;
  const opcoes = [baixo - 1, baixo, baixo + 1].filter((v) => v > 0);
  return opcoes.reduce((melhor, v) => (Math.abs(v - valor) < Math.abs(melhor - valor) ? v : melhor), opcoes[0]);
}

const ativos = (cortes: Corte[]) => cortes.filter((c) => c.ativo !== false && Number(c.participacao) > 0);

/** Peso vendável do corte em 100 kg de carcaça (participação menos a quebra da limpeza). */
function pesoVendavel(c: Corte): number {
  const p = Number(c.participacao) || 0;
  const q = Math.min(95, Math.max(0, Number(c.quebra) || 0));
  return p * (1 - q / 100);
}

export function calcularRateio(base: BaseCalculo, cortes: Corte[]): Resultado {
  const avisos: string[] = [];
  const custoKg = custoPorKg(base);
  const lista = ativos(cortes);
  const participacaoTotal = lista.reduce((s, c) => s + (Number(c.participacao) || 0), 0);

  // Tudo calculado sobre 100 kg de carcaça — as participações já são percentuais.
  const custoTotal = custoKg * 100;
  const receitaAlvo = custoTotal * (1 + (Number(base.margem) || 0) / 100);

  const travados = lista.filter((c) => c.travado && Number(c.precoAtual) > 0);
  const livres = lista.filter((c) => !(c.travado && Number(c.precoAtual) > 0));
  const receitaTravada = travados.reduce((s, c) => s + pesoVendavel(c) * (Number(c.precoAtual) || 0), 0);
  const pesoIndice = livres.reduce((s, c) => s + pesoVendavel(c) * (Number(c.indice) || 0), 0);

  let precoMedio = 0;
  if (pesoIndice > 0) {
    precoMedio = Math.max(0, (receitaAlvo - receitaTravada) / pesoIndice);
    if (receitaAlvo - receitaTravada <= 0) {
      avisos.push('Os cortes travados já cobrem toda a receita alvo — destrave algum ou aumente a margem.');
    }
  } else if (lista.length > 0) {
    avisos.push('Nenhum corte livre para receber o rateio (todos travados ou sem índice).');
  }

  const calculados: CorteCalculado[] = lista.map((c) => {
    const peso = pesoVendavel(c);
    const travado = Boolean(c.travado && Number(c.precoAtual) > 0);
    const exato = travado ? Number(c.precoAtual) : precoMedio * (Number(c.indice) || 0);
    const novo = travado ? Number(c.precoAtual) : arredondar(exato, base.arredondamento);
    const atual = Number(c.precoAtual) || 0;
    return {
      ...c,
      pesoVendavel: peso,
      precoExato: Math.round(exato * 100) / 100,
      precoNovo: novo,
      variacao: atual > 0 ? Math.round((novo - atual) * 100) / 100 : null,
      variacaoPct: atual > 0 ? Math.round(((novo - atual) / atual) * 10000) / 100 : null,
    };
  });

  const receitaReal = calculados.reduce((s, c) => s + c.pesoVendavel * c.precoNovo, 0);
  const margemReal = custoTotal > 0 ? ((receitaReal - custoTotal) / custoTotal) * 100 : 0;

  if (participacaoTotal > 100.5) {
    avisos.push(`As participações somam ${participacaoTotal.toFixed(1)}% — passa de 100% do peso da carcaça.`);
  } else if (lista.length > 0 && participacaoTotal < 80) {
    avisos.push(
      `As participações somam só ${participacaoTotal.toFixed(1)}% — o que falta vira osso/perda e encarece os cortes.`,
    );
  }
  if (custoKg <= 0) avisos.push('Informe o custo da carcaça para calcular.');

  return {
    custoKg: Math.round(custoKg * 10000) / 10000,
    cortes: calculados,
    precoMedio: Math.round(precoMedio * 100) / 100,
    receitaAlvo: Math.round(receitaAlvo * 100) / 100,
    receitaReal: Math.round(receitaReal * 100) / 100,
    margemReal: Math.round(margemReal * 100) / 100,
    participacaoTotal: Math.round(participacaoTotal * 100) / 100,
    avisos,
  };
}

/**
 * Caminho inverso: a partir dos preços praticados HOJE (e do custo de hoje), descobre o índice de
 * cada corte e a margem que o mercado já pratica. É isso que evita ter que inventar número: cadastra
 * o que já se cobra e, daí em diante, só o preço do boi muda.
 */
export function derivarIndices(
  base: BaseCalculo,
  cortes: Corte[],
): { cortes: Corte[]; margem: number; precoMedio: number; erro?: string } {
  const custoKg = custoPorKg(base);
  const lista = ativos(cortes).filter((c) => Number(c.precoAtual) > 0);
  if (lista.length === 0) return { cortes, margem: base.margem, precoMedio: 0, erro: 'Preencha os preços atuais dos cortes.' };
  if (custoKg <= 0) return { cortes, margem: base.margem, precoMedio: 0, erro: 'Informe o custo atual da carcaça.' };

  const pesoTotal = lista.reduce((s, c) => s + pesoVendavel(c), 0);
  const receita = lista.reduce((s, c) => s + pesoVendavel(c) * (Number(c.precoAtual) || 0), 0);
  if (pesoTotal <= 0) return { cortes, margem: base.margem, precoMedio: 0, erro: 'Informe a participação (%) de cada corte.' };

  // Média ponderada pelo peso: índice 1,0 = corte que vale exatamente a média do boi.
  const precoMedio = receita / pesoTotal;
  const margem = ((receita - custoKg * 100) / (custoKg * 100)) * 100;

  return {
    cortes: cortes.map((c) => {
      const preco = Number(c.precoAtual) || 0;
      if (preco <= 0 || c.ativo === false) return c;
      return { ...c, indice: Math.round((preco / precoMedio) * 10000) / 10000 };
    }),
    margem: Math.round(margem * 100) / 100,
    precoMedio: Math.round(precoMedio * 100) / 100,
  };
}
