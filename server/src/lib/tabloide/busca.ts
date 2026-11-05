/** Busca de produto pelo nome do jeito que o mercado digita ("coca 2l" acha "Refrigerante Coca-Cola 2L"). */

export function normalizar(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d)[,.](\d)/g, '$1p$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)\s+(kg|g|gr|l|lt|ml|un)\b/g, '$1$2')
    .replace(/(\d)(gr)\b/g, '$1g')
    .replace(/(\d)(lt)\b/g, '$1l')
    .trim();
}

const PALAVRAS_VAZIAS = new Set(['de', 'da', 'do', 'com', 'e', 'em', 'kg', 'un', 'tipo', 'pct', 'cx']);
const tokens = (s: string) => normalizar(s).split(' ').filter((t) => t && !PALAVRAS_VAZIAS.has(t));

/** 0..1: quanto o nome digitado parece com o produto do catálogo. */
export function semelhanca(digitado: string, produto: string): number {
  const a = tokens(digitado);
  const b = tokens(produto);
  if (!a.length || !b.length) return 0;
  const casa = (x: string, lista: string[]) => {
    let melhor = 0;
    for (const y of lista) {
      if (x === y) return 1;
      const curto = x.length <= y.length ? x : y;
      const longo = x.length <= y.length ? y : x;
      if (curto.length >= 3 && longo.startsWith(curto)) melhor = Math.max(melhor, 0.75);
    }
    return melhor;
  };
  const ab = a.reduce((s, t) => s + casa(t, b), 0) / a.length;
  const ba = b.reduce((s, t) => s + casa(t, a), 0) / b.length;
  let nota = ab * 0.7 + ba * 0.3;
  // Medida (2l, 500g, 1kg…): igual = quase certeza; diferente = produto diferente (Coca 2L ≠ Coca 350ml).
  const medida = (l: string[]) => l.find((t) => /^\d+(p\d+)?(kg|g|l|ml)$/.test(t));
  const ma = medida(a);
  const mb = medida(b);
  if (ma && mb) nota = ma === mb ? nota + 0.1 : nota * 0.5;
  return Math.min(1, nota);
}
