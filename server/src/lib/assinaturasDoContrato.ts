/**
 * Onde cada parte assina no PDF do contrato (posições do Autentique):
 *  - RUBRICA em todas as páginas, menos na última;
 *  - ASSINATURA na última página, em cima da linha de cada parte (CONTRATANTE = primeira linha, CONTRATADA/NX = segunda).
 * x e y são porcentagens da página (origem no canto superior esquerdo), z é o número da página (começa em 1).
 */

export interface Posicao {
  x: string;
  y: string;
  z: number;
  angle: number;
  scale: number;
  element: 'SIGNATURE' | 'INITIALS';
}

/** Linha de assinatura (os "________" do contrato) achada na última página: centro dela em % da página. */
export interface LinhaDeAssinatura { xPct: number; yPct: number }

export interface PlanoDeAssinaturas {
  paginas: number;
  nx: Posicao[];
  cliente: Posicao[];
  /** As linhas de assinatura foram achadas no PDF (senão as assinaturas caem num lugar padrão da última página). */
  linhasAchadas: boolean;
}

const pct = (n: number) => Math.min(100, Math.max(0, n)).toFixed(1);
const posicao = (element: Posicao['element'], x: number, y: number, z: number, scale: number): Posicao => ({ x: pct(x), y: pct(y), z, angle: 0, scale, element });

// Rubricas na margem de baixo (a margem do PDF é de 20mm = 6,7% da altura), uma ao lado da outra, sem tocar o texto.
const RUBRICA_Y = 94.5;
const RUBRICA_X = { cliente: 70, nx: 83 };
const RUBRICA_ESCALA = 0.7;
// Caixa da assinatura: fica logo acima da linha, centralizada nela.
const ASSINATURA_LARGURA = 22;
const ASSINATURA_ALTURA = 6.5;

export function montarPosicoes(paginas: number, linhas: LinhaDeAssinatura[]): PlanoDeAssinaturas {
  const total = Math.max(1, Math.floor(paginas) || 1);
  const nx: Posicao[] = [];
  const cliente: Posicao[] = [];
  for (let p = 1; p < total; p++) {
    cliente.push(posicao('INITIALS', RUBRICA_X.cliente, RUBRICA_Y, p, RUBRICA_ESCALA));
    nx.push(posicao('INITIALS', RUBRICA_X.nx, RUBRICA_Y, p, RUBRICA_ESCALA));
  }
  const acima = (l: LinhaDeAssinatura, parte: 'cliente' | 'nx') =>
    posicao('SIGNATURE', Math.max(2, l.xPct - ASSINATURA_LARGURA / 2), Math.max(2, l.yPct - ASSINATURA_ALTURA), total, parte === 'nx' ? 0.9 : 0.9);
  const ordenadas = [...linhas].sort((a, b) => a.yPct - b.yPct);
  if (ordenadas.length >= 2) {
    cliente.push(acima(ordenadas[0], 'cliente'));
    nx.push(acima(ordenadas[ordenadas.length - 1], 'nx'));
    return { paginas: total, nx, cliente, linhasAchadas: true };
  }
  if (ordenadas.length === 1) {
    nx.push(acima(ordenadas[0], 'nx'));
    cliente.push(posicao('SIGNATURE', 10, Math.max(2, ordenadas[0].yPct - 20), total, 0.9));
    return { paginas: total, nx, cliente, linhasAchadas: true };
  }
  // Sem linhas no PDF: as duas assinaturas lado a lado na parte de baixo da última página.
  cliente.push(posicao('SIGNATURE', 8, 82, total, 0.9));
  nx.push(posicao('SIGNATURE', 52, 82, total, 0.9));
  return { paginas: total, nx, cliente, linhasAchadas: false };
}

/** Número de páginas e as linhas de assinatura ("____") da última página, lidos do próprio PDF. */
export async function lerPdfDoContrato(pdf: Buffer): Promise<{ paginas: number; linhas: LinhaDeAssinatura[] }> {
  // pdfjs-dist (build "legacy", roda no Node sem canvas): só lê texto e posição, não desenha nada.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.js')) as unknown as {
    getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> };
  };
  interface PdfDoc {
    numPages: number;
    getPage: (n: number) => Promise<{
      getViewport: (o: { scale: number }) => { width: number; height: number };
      getTextContent: () => Promise<{ items: { str?: string; width?: number; transform?: number[] }[] }>;
    }>;
    destroy: () => Promise<void>;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const pagina = await doc.getPage(doc.numPages);
    const vista = pagina.getViewport({ scale: 1 });
    const conteudo = await pagina.getTextContent();
    const linhas: LinhaDeAssinatura[] = [];
    for (const it of conteudo.items) {
      const texto = (it.str ?? '').trim();
      if (!/^[_—─-]{8,}$/.test(texto) || !it.transform) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      const largura = it.width ?? 0;
      linhas.push({ xPct: ((x + largura / 2) / vista.width) * 100, yPct: ((vista.height - y) / vista.height) * 100 });
    }
    return { paginas: doc.numPages, linhas };
  } finally {
    await doc.destroy();
  }
}

/** Lê o PDF e monta o plano (rubrica em todas menos a última, assinatura na última). Se a leitura falhar, usa o número de páginas
 * contado no texto do PDF e as posições padrão. */
export async function planoDeAssinaturas(pdf: Buffer): Promise<PlanoDeAssinaturas> {
  try {
    const { paginas, linhas } = await lerPdfDoContrato(pdf);
    return montarPosicoes(paginas, linhas);
  } catch (err) {
    console.warn('[contrato] não consegui ler as linhas de assinatura do PDF:', (err as Error).message);
    return montarPosicoes(contarPaginasPeloTexto(pdf), []);
  }
}

/** Contagem simples (sem biblioteca): objetos "/Type /Page" do PDF gerado pelo Chromium. */
export function contarPaginasPeloTexto(pdf: Buffer): number {
  const texto = pdf.toString('latin1');
  const n = (texto.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return Math.max(1, n);
}

/** Número de páginas que o contrato terá. */
export async function contarPaginas(pdf: Buffer): Promise<number> {
  try {
    return (await lerPdfDoContrato(pdf)).paginas;
  } catch {
    return contarPaginasPeloTexto(pdf);
  }
}
