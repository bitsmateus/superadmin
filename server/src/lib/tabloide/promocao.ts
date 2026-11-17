import type { ItemRelatorio } from '../plaquinhas/relatorio.js';

/**
 * PDF de promoções do ERP → tabloides, um por seção ("tipo de produto": PRODUTOS LIMPEZA, BEBIDAS, HORTIFRUTI...).
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

const SEM_SECAO = 'OUTROS';

/** Modelo do tabloide pela seção: hortifruti e açougue têm arte própria; o resto usa "Ofertas da semana". */
export function modeloDaSecao(secao: string): string {
  const s = secao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
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

/**
 * Separa por seção (na ordem em que aparecem no relatório) e junta as variações.
 * `secaoPorProduto` completa a seção quando o relatório não traz (modelo em blocos), pelo código do produto no ERP.
 */
export function separarPorSecao(itens: ItemRelatorio[], secaoPorProduto: Map<string, string> = new Map()): SecaoPromocao[] {
  const porSecao = new Map<string, ItemRelatorio[]>();
  for (const i of itens) {
    const secao = (i.grupo || secaoPorProduto.get(i.produtoId) || SEM_SECAO).trim() || SEM_SECAO;
    const l = porSecao.get(secao) ?? [];
    l.push(i);
    porSecao.set(secao, l);
  }

  const secoes: SecaoPromocao[] = [];
  for (const [secao, lista] of porSecao) {
    // Agrupa mantendo a ordem do primeiro de cada grupo.
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
    secoes.push({
      secao,
      modeloId: modeloDaSecao(secao),
      validade: validadeDos(lista),
      itens: grupos.map((g) => {
        const nome = g.length > 1 ? comecoComum(g.map((x) => x.produto)) || g[0].produto : g[0].produto;
        return {
          nome,
          detalhe: g[0].peso,
          preco: g[0].preco,
          precoDe: g[0].precoDe,
          minUnidades: g[0].minUnidades,
          variacoes: g.map((x) => ({ nome: x.produto, ean: x.ean })),
        };
      }),
    });
  }
  return secoes;
}
