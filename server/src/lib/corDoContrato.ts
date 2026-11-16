/**
 * O contrato gerado não leva vermelho: as marcações do modelo (campos "<<...>>" em vermelho) viram preto, no texto e no PDF.
 * Mesma regra do front (src/lib/modeloDoContrato.ts, tirarVermelho).
 */
function ehVermelho(valor: string): boolean {
  const v = valor.trim().toLowerCase();
  if (v === 'red' || v === 'crimson' || v === 'firebrick' || v === 'darkred') return true;
  let r: number, g: number, b: number;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else if (rgb) {
    r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
  } else return false;
  return r >= 150 && g <= 100 && b <= 100 && r - Math.max(g, b) >= 80;
}

export function tirarVermelho(html: string): string {
  return html
    .replace(/((?:^|[;\s"'])color\s*:\s*)(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\)|[a-zA-Z]+)/g, (m, pre: string, cor: string) => (ehVermelho(cor) ? `${pre}#000000` : m))
    .replace(/(<font[^>]*\scolor\s*=\s*["']?)(#[0-9a-fA-F]{3,6}|[a-zA-Z]+)(["']?)/gi, (m, pre: string, cor: string, pos: string) => (ehVermelho(cor) ? `${pre}#000000${pos}` : m));
}
