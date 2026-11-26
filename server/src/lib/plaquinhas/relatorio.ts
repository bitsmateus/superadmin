/**
 * Leitura dos relatórios de promoção do ERP (MAX WORK) pra gerar plaquinhas em massa — /mercadonunes/plaquinhas.
 *
 * Dois modelos de PDF, reconhecidos sozinhos:
 *  - "Itens em Promoção" (tabela): uma linha por produto — `34 16/11/2026 30/11/2026 1 96547 <EAN> NOME custo venda promo margem SIM`.
 *    O "venda" é o preço de (cheio) e o "promo" o preço novo.
 *  - "Promoção de Produto" (blocos): `Código: 4 - NOME  Ativo: SIM ... Qtd. p/ ativar: 12,00  Valor promoção: 2,79` + linha `DESCONTO <produto> <barras> <descrição> <qtde>`.
 *    Aqui "Qtd. p/ ativar" vira o "a partir de X unidades" da plaquinha. Não traz preço de.
 *
 * O ERP troca os acentos por "?" (Se??o, N?O) — por isso os padrões aceitam qualquer caractere no lugar deles.
 * Produto inativo (Ativo = NÃO) é ignorado: não está em promoção de verdade.
 */

export interface ItemRelatorio {
  /** Código do produto no ERP — é a chave pra "fica sempre um só". */
  produtoId: string;
  ean: string;
  grupo: string;
  /** Texto original do relatório. */
  nomeOriginal: string;
  produto: string;
  peso: string;
  preco: string; // "4,99"
  precoDe: string; // "" quando não tem
  minUnidades: string; // "" quando não tem
  inicio: string; // dd/mm/aaaa
  fim: string; // "" quando é "sem fim" (ano 2090+)
}

export interface ResultadoRelatorio {
  modelo: 'tabela' | 'blocos' | 'produtos' | 'etiquetas' | 'previa';
  itens: ItemRelatorio[];
  /** Linhas inativas (Ativo = NÃO) que ficaram de fora. */
  inativos: number;
  /** Itens repetidos no mesmo arquivo (mesmo produto) — fica só o primeiro. */
  repetidos: number;
  /** Promoções cuja data final já passou — não geram plaquinha. */
  vencidos: number;
}

// ── PDF → linhas de texto ──────────────────────────────────────────────────

interface PdfDoc {
  numPages: number;
  getPage: (n: number) => Promise<{
    getTextContent: () => Promise<{ items: { str?: string; transform?: number[] }[] }>;
  }>;
  destroy: () => Promise<void>;
}

/** Texto do PDF, uma string por linha visual (itens com o mesmo Y, da esquerda pra direita). */
export async function linhasDoPdf(pdf: Buffer): Promise<string[]> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.js')) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  const linhas: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const pagina = await doc.getPage(n);
      const conteudo = await pagina.getTextContent();
      const porY = new Map<number, { x: number; s: string }[]>();
      for (const it of conteudo.items) {
        const s = it.str ?? '';
        if (!s.trim() || !it.transform) continue;
        const y = Math.round(it.transform[5] / 2) * 2; // tolera 1pt de diferença na mesma linha
        const l = porY.get(y) ?? [];
        l.push({ x: it.transform[4], s });
        porY.set(y, l);
      }
      for (const y of [...porY.keys()].sort((a, b) => b - a)) {
        linhas.push(
          porY
            .get(y)!
            .sort((a, b) => a.x - b.x)
            .map((p) => p.s.trim())
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        );
      }
    }
  } finally {
    await doc.destroy();
  }
  return linhas;
}

// ── Limpeza do nome do produto ─────────────────────────────────────────────

const ABREV: Record<string, string> = {
  BISC: 'BISCOITO', REFRIG: 'REFRIGERANTE', CERV: 'CERVEJA', CHOC: 'CHOCOLATE', BEB: 'BEBIDA', LACT: 'LÁCTEA',
  DESOD: 'DESODORANTE', PAP: 'PAPEL', HIG: 'HIGIÊNICO', AERO: 'AEROSSOL', TRAD: 'TRADICIONAL', PARBO: 'PARBOILIZADO',
  ANT: 'ANTARCTICA', ANTARCT: 'ANTARCTICA', LN: 'LONG NECK', LT: 'LATA', SABAO: 'SABÃO', ACHOC: 'ACHOCOLATADO',
  REFR: 'REFRIGERANTE', ENERG: 'ENERGÉTICO', AGUA: 'ÁGUA', TONICA: 'TÔNICA', GUARANA: 'GUARANÁ', MOLHO: 'MOLHO',
  CX: 'CAIXA', FAM: 'FAMILIAR', INTEG: 'INTEGRAL', SORV: 'SORVETE', MAC: 'MACARRÃO', MACARR: 'MACARRÃO',
};
const RE_PESO = /^\d+(?:[.,]\d+)?(?:KG|GR|G|ML|LTS|LT|L|UN|UND)(?:\/\d+(?:[.,]\d+)?(?:KG|GR|G|ML|LTS|LT|L|UN|UND))?$/i;

/** "BISC.COOKIES BAUDUCCO 96G/100G" → { produto: "BISCOITO COOKIES BAUDUCCO", peso: "96G/100G" }. */
export function limparNome(bruto: string): { produto: string; peso: string } {
  const tokens = bruto
    .toUpperCase()
    .replace(/\./g, '. ')
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ''))
    .filter(Boolean);
  let peso = '';
  const resto: string[] = [];
  for (const t of tokens) {
    if (!peso && RE_PESO.test(t)) peso = t;
    else resto.push(t);
  }
  // Código solto no fim ("COPO NADIR PAULISTA 250ML 7002") não vai na placa.
  if (peso && resto.length > 1 && /^\d{4,}$/.test(resto[resto.length - 1])) resto.pop();
  const unido = resto.map((t) => ABREV[t] ?? t).join(' ').replace(/SABÃO PO\b/, 'SABÃO EM PÓ');
  return { produto: unido.trim(), peso };
}

// ── Leitura dos dois modelos ───────────────────────────────────────────────

const NUM = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}`;
const RE_TABELA = new RegExp(
  String.raw`^\d+\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})\s+\d+\s+(\d+)\s+(\d{6,14})\s+(.+?)\s*(${NUM})\s+(${NUM})\s+(${NUM})\s+(${NUM})\s+(SIM|N.?O)$`,
  'i',
);
const RE_SECAO = /^Se.{1,3}o:\s*(.+)$/i;
// O nome da promoção às vezes cola no "Ativo:" ("...Consulte eAtivo: SIM"), por isso \s* e não \s+.
const RE_BLOCO = /^C.digo:\s*(\d+)\s*-\s*(.+?)\s*Ativo:\s*(SIM|N.?O)\b(?:.*?Gerar Pre.{1,3}os:\s*(SIM|N.?O))?/i;
// "Produtos por Promoção": `produto EAN NOME vlr.venda vlr.promo início fim`.
const RE_PRODUTOS = new RegExp(
  String.raw`^(\d+)\s+(\d{6,14})\s+(.+?)\s+(${NUM})\s+(${NUM})\s+(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})$`,
);

// "Etiqueta de Gôndola": `produto EAN NOME STATUS grupo qtdEtiq PROMO(SIM|NÃO) dataPreço preço qtdDif/saldo`.
const RE_ETIQUETA = new RegExp(
  String.raw`^(\d+)\s+(\d{1,14})\s+(.+?)\s+[A-Za-z]{5,}\s+\d+\s+\d+\s+(?:SIM|N.?O)\s+(\d{2}/\d{2}/\d{4})\s+(${NUM})\s+${NUM}$`,
  'i',
);

// "Prévia dos Produtos - Seção": estoque inteiro da seção, `produto EAN NOME TE QE ___ venda ___ ...números... PROMO(SIM|NAO)`.
// O nome às vezes cola na unidade ("...220GUN 1"). Só o que está com PROMO = SIM vira oferta.
const RE_PREVIA = new RegExp(
  String.raw`^(\d+)\s+(\d{1,14})\s+(.+?)\s*[A-Z]{2}\s+\d+(?:,\d+)?\s+_{3,}\s+(${NUM})\s+_{3,}.*?\s(SIM|N.?O)$`,
);

const semMilhar =(v: string) => v.replace(/\./g, '');
const dinheiro = (v: string) => {
  const n = Number(semMilhar(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const emDate = (d: string) => new Date(Number(d.slice(6)), Number(d.slice(3, 5)) - 1, Number(d.slice(0, 2)));
const fimUtil = (d: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(d) && Number(d.slice(6)) < 2090 ? d : '');

export function lerRelatorio(linhas: string[], hoje: Date = new Date()): ResultadoRelatorio {
  const itens: ItemRelatorio[] = [];
  let inativos = 0;
  let repetidos = 0;
  let vencidos = 0;
  const vistos = new Set<string>();
  const comecoDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const juntar = (i: ItemRelatorio) => {
    if (i.fim && emDate(i.fim) < comecoDoDia) {
      vencidos++;
      return;
    }
    if (vistos.has(i.produtoId)) {
      repetidos++;
      return;
    }
    vistos.add(i.produtoId);
    itens.push(i);
  };

  const ehBlocos = linhas.some((l) => RE_BLOCO.test(l));
  if (!ehBlocos && linhas.some((l) => RE_PREVIA.test(l))) {
    let grupo = '';
    for (const l of linhas) {
      const s = RE_SECAO.exec(l);
      if (s) {
        grupo = s[1].replace(/^[\d.]+\s*-\s*/, '').trim();
        continue;
      }
      const m = RE_PREVIA.exec(l);
      if (!m || m[5] !== 'SIM') continue;
      const preco = dinheiro(m[4]);
      if (!Number.isFinite(preco) || preco <= 0) continue;
      const { produto, peso } = limparNome(m[3]);
      juntar({ produtoId: m[1], ean: m[2], grupo, nomeOriginal: m[3].trim(), produto, peso, preco: m[4], precoDe: '', minUnidades: '', inicio: '', fim: '' });
    }
    return { modelo: 'previa', itens, inativos, repetidos, vencidos };
  }
  if (!ehBlocos && linhas.some((l) => RE_ETIQUETA.test(l))) {
    for (const l of linhas) {
      const m = RE_ETIQUETA.exec(l);
      if (!m) continue;
      const preco = dinheiro(m[5]);
      if (!Number.isFinite(preco) || preco <= 0) continue;
      const { produto, peso } = limparNome(m[3]);
      juntar({ produtoId: m[1], ean: m[2], grupo: '', nomeOriginal: m[3].trim(), produto, peso, preco: m[5], precoDe: '', minUnidades: '', inicio: m[4], fim: '' });
    }
    return { modelo: 'etiquetas', itens, inativos, repetidos, vencidos };
  }
  if (!ehBlocos && linhas.some((l) => RE_PRODUTOS.test(l))) {
    for (const l of linhas) {
      const m = RE_PRODUTOS.exec(l);
      if (!m) continue;
      const venda = dinheiro(m[4]);
      const promo = dinheiro(m[5]);
      if (!Number.isFinite(promo) || promo <= 0) continue;
      const { produto, peso } = limparNome(m[3]);
      juntar({
        produtoId: m[1], ean: m[2], grupo: '', nomeOriginal: m[3].trim(), produto, peso,
        preco: m[5], precoDe: Number.isFinite(venda) && venda > promo ? m[4] : '',
        minUnidades: '', inicio: m[6], fim: fimUtil(m[7]),
      });
    }
    return { modelo: 'produtos', itens, inativos, repetidos, vencidos };
  }
  if (!ehBlocos) {
    let grupo = '';
    for (const l of linhas) {
      const s = RE_SECAO.exec(l);
      if (s) {
        grupo = s[1].replace(/^[\d.]+\s*-\s*/, '').trim();
        continue;
      }
      const m = RE_TABELA.exec(l);
      if (!m) continue;
      if (!/^SIM$/i.test(m[10])) {
        inativos++;
        continue;
      }
      // Colunas: custo (6), venda = preço de (7), promoção = preço novo (8), margem (9).
      const venda = dinheiro(m[7]);
      const promo = dinheiro(m[8]);
      if (!Number.isFinite(promo) || promo <= 0) continue;
      const { produto, peso } = limparNome(m[5]);
      juntar({
        produtoId: m[3], ean: m[4], grupo, nomeOriginal: m[5].trim(), produto, peso,
        preco: m[8], precoDe: Number.isFinite(venda) && venda > promo ? m[7] : '',
        minUnidades: '', inicio: m[1], fim: fimUtil(m[2]),
      });
    }
    return { modelo: 'tabela', itens, inativos, repetidos, vencidos };
  }

  // Blocos: cada "Código: N - NOME ..." abre uma promoção que vai até o próximo "Código:".
  interface Bloco { nome: string; ativo: boolean; inicio: string; fim: string; qtd: string; valor: string; produtoId: string; ean: string; descri: string }
  let atual: Bloco | null = null;
  const fechar = () => {
    const b = atual;
    atual = null;
    if (!b) return;
    if (!b.ativo) {
      inativos++;
      return;
    }
    const promo = dinheiro(b.valor);
    if (!Number.isFinite(promo) || promo <= 0 || !b.produtoId) return;
    const qtd = Number(semMilhar(b.qtd).replace(',', '.'));
    // A descrição do produto é mais completa que o nome da promoção ("GUAR ANT" × "GUARANA ANT.").
    const nome = b.descri || b.nome;
    const { produto, peso } = limparNome(nome);
    juntar({
      produtoId: b.produtoId, ean: b.ean, grupo: '', nomeOriginal: nome.trim(), produto, peso,
      preco: b.valor, precoDe: '', minUnidades: Number.isFinite(qtd) && qtd > 1 ? String(Math.round(qtd)) : '',
      inicio: b.inicio, fim: fimUtil(b.fim),
    });
  };
  for (const l of linhas) {
    const h = RE_BLOCO.exec(l);
    if (h) {
      fechar();
      // "Gerar Preços: NÃO" (reembolso do fornecedor etc.) não muda o preço no caixa: não vira plaquinha.
      atual = { nome: h[2].trim(), ativo: /^SIM$/i.test(h[3]) && !(h[4] && !/^SIM$/i.test(h[4])), inicio: '', fim: '', qtd: '', valor: '', produtoId: '', ean: '', descri: '' };
      continue;
    }
    if (!atual) continue;
    const ini = /Data do In.cio:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(l);
    if (ini) atual.inicio = ini[1];
    const fim = /Data do Fim:\s*(\d{2}\/\d{2}\/\d{4})/i.exec(l);
    if (fim) atual.fim = fim[1];
    const q = /Qtd\.\s*p\/\s*ativar:\s*([\d.,]+)/i.exec(l);
    if (q) atual.qtd = q[1];
    const v = /Valor promo.{0,4}o:\s*([\d.]+,\d{2})/i.exec(l);
    if (v) atual.valor = v[1];
    const d = /^DESCONTO\s+(\d+)\s+(\d+)\s+(.+?)(?:\s+[\d.,]+)?$/i.exec(l);
    if (d && !atual.produtoId) {
      atual.produtoId = d[1];
      atual.ean = d[2];
      atual.descri = d[3];
    }
  }
  fechar();
  return { modelo: 'blocos', itens, inativos, repetidos, vencidos };
}

export async function lerPdfDePromocao(pdf: Buffer): Promise<ResultadoRelatorio> {
  return lerRelatorio(await linhasDoPdf(pdf));
}
