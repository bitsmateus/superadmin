import type { ItemRelatorio } from '../plaquinhas/relatorio.js';

/**
 * PDF de promoções do ERP → tabloides, um por tipo de produto. As seções do ERP (PRODUTOS LIMPEZA, BOMBONIERE,
 * HORTIFRUTI...) são agrupadas em categorias grandes (Mercearia, Bebidas, Limpeza...), e categoria com poucos
 * produtos vai pro tabloide geral — senão saía tabloide de 1 produto.
 *
 * Dentro de cada seção, variações do mesmo produto com o mesmo preço viram UM item com várias fotos (Coca-Cola e
 * Coca-Cola Zero, Suco FRU10 laranja/uva/limão...). Regra de "mesmo produto": mesmo começo de nome (as duas
 * primeiras palavras), mesmo peso/tamanho, mesmo preço e mesmo preço de.
 */

export interface VariacaoPromocao {
  /** Nome inteiro (já limpo) e EAN — a tela usa pra achar a foto no catálogo. */
  nome: string;
  ean: string;
}

export interface ItemPromocao {
  nome: string;
  detalhe: string;
  preco: string;
  precoDe: string;
  /** "a partir de X un" do relatório em blocos. */
  minUnidades: string;
  /** Bloco grande do tabloide (o mais caro de cada um). */
  destaque: boolean;
  /** 1 = produto sozinho; 2+ = variações juntas (uma foto de cada). */
  variacoes: VariacaoPromocao[];
}

export interface SecaoPromocao {
  secao: string;
  modeloId: string;
  validade: string;
  itens: ItemPromocao[];
}

/** Máximo de fotos juntas num item (mais que isso não cabe no card). */
export const MAX_VARIACOES = 4;

/** Cards por tabloide (1 em destaque + 7, como o encarte do mercado). */
export const CARDS_POR_TABLOIDE = 8;
export const GERAL = 'OFERTAS DA SEMANA';
/** Ordem das categorias no encarte. */
const ORDEM_CATEGORIAS = ['HORTIFRUTI', 'AÇOUGUE', 'MERCEARIA', 'BEBIDAS', 'FRIOS E LATICÍNIOS', 'LIMPEZA, HIGIENE E CASA'];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * As seções do ERP são muito picadas (ACHOCOLATADO, BOMBONIERE, PAES/BOLOS...) e davam tabloide de 1 produto.
 * Aqui elas viram categorias grandes, que é como o mercado separa o encarte.
 */
export function categoriaDa(secao: string): string {
  const s = semAcento(secao);
  if (/HORTI|FLV|FRUTA|VERDUR|LEGUM|FEIRA/.test(s)) return 'HORTIFRUTI';
  if (/ACOUGUE|CARNE|FRIGORIF|BOVIN|SUIN|FRANGO|AVES|PEIXE|LINGUI/.test(s)) return 'AÇOUGUE';
  if (/FRIOS|LATIC|QUEIJ|IOGUR|EMBUTID|LACTEO/.test(s)) return 'FRIOS E LATICÍNIOS';
  if (/BEBIDA|REFRIG|CERVEJ|SUCO|AGUA|VINHO|DESTIL|ENERG|CHA\b/.test(s)) return 'BEBIDAS';
  if (/LIMPEZA|HIGIENE|PERFUM|UTILIDADE|BAZAR|DESCART|PET\b|CASA|PAPEL/.test(s)) return 'LIMPEZA, HIGIENE E CASA';
  if (!s.trim()) return GERAL;
  return 'MERCEARIA';
}

/** Modelo do tabloide pela categoria: hortifruti e açougue têm arte própria; o resto usa "Ofertas da semana". */
export function modeloDaSecao(secao: string): string {
  const s = semAcento(secao);
  if (/HORTI|FLV|FRUTA|VERDUR|LEGUM|FEIRA/.test(s)) return 'hortifruti';
  if (/ACOUGUE|CARNE|FRIGORIF|BOVIN|SUIN|FRANGO|AVES/.test(s)) return 'acougue';
  return 'semana';
}

const dataCurta = (d: string) => d.slice(0, 5); // dd/mm/aaaa → dd/mm
const emNumero = (d: string) => Number(d.slice(6) + d.slice(3, 5) + d.slice(0, 2));

/** "Válido de 16/11 a 30/11" a partir das datas dos itens (fim vazio = promoção sem data pra acabar). */
export function validadeDos(itens: ItemRelatorio[]): string {
  const inicios = itens.map((i) => i.inicio).filter((d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d));
  const fins = itens.map((i) => i.fim).filter((d) => /^\d{2}\/\d{2}\/\d{4}$/.test(d));
  if (!fins.length) return '';
  const fim = fins.reduce((a, b) => (emNumero(b) > emNumero(a) ? b : a));
  const inicio = inicios.length ? inicios.reduce((a, b) => (emNumero(b) < emNumero(a) ? b : a)) : '';
  // Promoção que começou há tempo (ex.: 2016) não faz sentido no "de": fica só o "até".
  if (!inicio || Number(inicio.slice(6)) < Number(fim.slice(6)) - 1) return `Válido até ${dataCurta(fim)}`;
  return inicio === fim ? `Válido só ${dataCurta(fim)}` : `Válido de ${dataCurta(inicio)} a ${dataCurta(fim)}`;
}

const palavras = (nome: string) => nome.toUpperCase().split(/\s+/).filter(Boolean);

/** Chave de "mesmo produto": 2 primeiras palavras + peso + preços. null = nome curto demais pra juntar com segurança. */
function chaveDeJuntar(i: ItemRelatorio): string | null {
  const p = palavras(i.produto);
  if (p.length < 2 || p[0].length < 2 || p[1].length < 2) return null;
  return [p[0], p[1], i.peso.toUpperCase(), i.preco, i.precoDe, i.minUnidades].join('|');
}

/** Palavras do começo que todos os nomes têm em comum ("SUCO FRU10 LARANJA" + "SUCO FRU10 UVA" → "SUCO FRU10"). */
function comecoComum(nomes: string[]): string {
  const listas = nomes.map(palavras);
  const comum: string[] = [];
  for (let n = 0; n < listas[0].length; n++) {
    const w = listas[0][n];
    if (listas.every((l) => l[n] === w)) comum.push(w);
    else break;
  }
  return comum.join(' ');
}

/** Dinheiro "1.234,56" → número (pra achar o mais caro). */
const valor = (v: string) => Number(v.replace(/\./g, '').replace(',', '.')) || 0;

/** Junta as variações (mesmo começo de nome, peso e preço) de uma lista, mantendo a ordem do primeiro de cada. */
function cardsDe(lista: ItemRelatorio[]): { card: ItemPromocao; origem: ItemRelatorio[] }[] {
  const grupos: ItemRelatorio[][] = [];
  const indice = new Map<string, number>();
  for (const i of lista) {
    const k = chaveDeJuntar(i);
    const pos = k ? indice.get(k) : undefined;
    if (pos !== undefined && grupos[pos].length < MAX_VARIACOES) {
      grupos[pos].push(i);
    } else {
      if (k && pos === undefined) indice.set(k, grupos.length);
      grupos.push([i]);
    }
  }
  return grupos.map((g) => ({
    origem: g,
    card: {
      nome: g.length > 1 ? comecoComum(g.map((x) => x.produto)) || g[0].produto : g[0].produto,
      detalhe: g[0].peso,
      preco: g[0].preco,
      precoDe: g[0].precoDe,
      minUnidades: g[0].minUnidades,
      destaque: false,
      variacoes: g.map((x) => ({ nome: x.produto, ean: x.ean })),
    },
  }));
}

/** Divide em partes do mesmo tamanho, nenhuma maior que `max` (10 cards → 5 + 5, não 8 + 2). */
function emPartes<T>(lista: T[], max: number): T[][] {
  if (!lista.length) return [];
  const n = Math.ceil(lista.length / max);
  const tam = Math.ceil(lista.length / n);
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += tam) out.push(lista.slice(i, i + tam));
  return out;
}

/** Nome do tabloide pelas categorias dele: "MERCEARIA" ou "MERCEARIA + BEBIDAS". */
const nomeDas = (cats: string[]) => (cats.length ? cats.join(' + ') : GERAL);

/**
 * Monta os tabloides do relatório, no jeito do encarte do mercado: até CARDS_POR_TABLOIDE cards em cada, com o
 * mais caro em destaque. Hortifruti e açougue saem separados (têm arte própria); o resto vai em ordem de categoria
 * (mercearia, bebidas, frios, limpeza…) e é dividido em tabloides cheios — categorias pequenas se juntam.
 * `secaoPorProduto` completa a seção quando o relatório não traz (modelo em blocos), pelo código do produto no ERP.
 */
export function separarPorSecao(itens: ItemRelatorio[], secaoPorProduto: Map<string, string> = new Map()): SecaoPromocao[] {
  const porCategoria = new Map<string, ItemRelatorio[]>();
  for (const i of itens) {
    const categoria = categoriaDa(i.grupo || secaoPorProduto.get(i.produtoId) || '');
    const l = porCategoria.get(categoria) ?? [];
    l.push(i);
    porCategoria.set(categoria, l);
  }

  type Card = { card: ItemPromocao; origem: ItemRelatorio[]; categoria: string };
  const blocos: { especial: boolean; cards: Card[] }[] = [];
  const resto: Card[] = [];
  for (const cat of [...ORDEM_CATEGORIAS, ...porCategoria.keys()].filter((c, n, l) => l.indexOf(c) === n && porCategoria.has(c))) {
    const cards = cardsDe(porCategoria.get(cat)!).map((c) => ({ ...c, categoria: cat }));
    if (cat === 'HORTIFRUTI' || cat === 'AÇOUGUE') blocos.push({ especial: true, cards });
    else resto.push(...cards);
  }
  if (resto.length) blocos.push({ especial: false, cards: resto });

  const tabloides: SecaoPromocao[] = [];
  for (const b of blocos) {
    const partes = emPartes(b.cards, CARDS_POR_TABLOIDE);
    partes.forEach((parte) => {
      const cats = [...new Set(parte.map((c) => c.categoria))];
      const base = nomeDas(cats);
      const itensDoTabloide = parte.map((c) => ({ ...c.card }));
      // O mais caro vira o destaque (bloco grande), como no encarte — só quando tem produto suficiente.
      if (itensDoTabloide.length >= 4) {
        const caro = itensDoTabloide.reduce((m, c, k) => (valor(c.preco) > valor(itensDoTabloide[m].preco) ? k : m), 0);
        itensDoTabloide[caro].destaque = true;
      }
      tabloides.push({
        secao: base,
        modeloId: modeloDaSecao(cats.length === 1 ? cats[0] : ''),
        validade: validadeDos(parte.flatMap((c) => c.origem)),
        itens: itensDoTabloide,
      });
    });
  }
  // Nome repetido (categoria grande dividida) ganha número: MERCEARIA 1, MERCEARIA 2.
  const total = new Map<string, number>();
  for (const t of tabloides) total.set(t.secao, (total.get(t.secao) ?? 0) + 1);
  const visto = new Map<string, number>();
  for (const t of tabloides) {
    if ((total.get(t.secao) ?? 0) < 2) continue;
    const n = (visto.get(t.secao) ?? 0) + 1;
    visto.set(t.secao, n);
    t.secao = `${t.secao} ${n}`;
  }
  return tabloides;
}
