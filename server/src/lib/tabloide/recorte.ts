import sharp from 'sharp';

/**
 * Foto de produto pro tabloide: tira o fundo e enquadra.
 *
 * O recorte padrão roda aqui no servidor, sem custo: a maioria das fotos de produto (das bases de
 * código de barras ou tiradas no mercado em cima de uma folha) tem fundo liso, então um
 * "balde de tinta" a partir das bordas resolve — tudo que encosta na borda e tem a cor do fundo vira
 * transparente, com a beirada suavizada. Quando o fundo não é liso (foto na prateleira), o recorte
 * automático não arrisca: devolve a foto inteira e avisa. Se REMOVEBG_API_KEY estiver configurada,
 * esses casos (ou quando pedirem "recorte avançado") vão pro remove.bg, que recorta qualquer fundo.
 */

export type ModoRecorte = 'auto' | 'sem' | 'removebg';

export interface FotoProcessada {
  /** WebP com transparência, enquadrado, no máximo 800px. É o que entra no tabloide. */
  foto: Buffer;
  /** A foto como chegou (no máximo 1200px) — pra dar pra refazer o recorte depois. */
  original: Buffer;
  fundoRemovido: boolean;
  aviso: string | null;
}

const MAX_FOTO = 800;

export const removeBgDisponivel = (): boolean => !!process.env.REMOVEBG_API_KEY;

export async function prepararFoto(entrada: Buffer, modo: ModoRecorte = 'auto'): Promise<FotoProcessada> {
  const original = await sharp(entrada, { failOn: 'none' })
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();

  if (modo === 'sem') {
    return { foto: await enquadrar(original, false), original, fundoRemovido: false, aviso: null };
  }
  if (modo === 'removebg') {
    const recortada = await removeBg(original);
    return { foto: await enquadrar(recortada, true), original, fundoRemovido: true, aviso: null };
  }

  const r = await baldeDeTinta(original);
  if (r.ok) return { foto: await enquadrar(r.png, true), original, fundoRemovido: r.removeu, aviso: null };
  if (removeBgDisponivel()) {
    try {
      const recortada = await removeBg(original);
      return { foto: await enquadrar(recortada, true), original, fundoRemovido: true, aviso: null };
    } catch (err) {
      return { foto: await enquadrar(original, false), original, fundoRemovido: false, aviso: (err as Error).message };
    }
  }
  return {
    foto: await enquadrar(original, false),
    original,
    fundoRemovido: false,
    aviso: 'O fundo da foto não é liso, então ficou com fundo. Para sair recortado, fotografe o produto em cima de uma folha branca.',
  };
}

/** Corta a sobra transparente (com uma folga) e reduz pra no máximo 800px. */
async function enquadrar(img: Buffer, cortarTransparente: boolean): Promise<Buffer> {
  let base = sharp(img).ensureAlpha();
  if (cortarTransparente) {
    const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0 && y1 > y0) {
      const folga = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
      const left = Math.max(0, x0 - folga);
      const top = Math.max(0, y0 - folga);
      base = sharp(img).ensureAlpha().extract({
        left,
        top,
        width: Math.min(w - left, x1 - x0 + 1 + folga * 2),
        height: Math.min(h - top, y1 - y0 + 1 + folga * 2),
      });
    }
  }
  const png = await base.png().toBuffer();
  return sharp(png).resize(MAX_FOTO, MAX_FOTO, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
}

/**
 * Tira o fundo liso a partir das bordas. Devolve ok=false quando o fundo não é uniforme (aí recortar
 * comeria pedaço do produto).
 */
export async function baldeDeTinta(img: Buffer): Promise<{ ok: boolean; removeu: boolean; png: Buffer }> {
  const { data, info } = await sharp(img)
    .ensureAlpha()
    .resize(MAX_FOTO, MAX_FOTO, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const px = Buffer.from(data);
  const total = w * h;

  // Já veio recortada (PNG transparente)? Mantém.
  let bordaTransparente = 0;
  let nBorda = 0;
  const borda: number[] = [];
  for (let x = 0; x < w; x++) borda.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) borda.push(y * w, y * w + w - 1);
  for (const i of borda) {
    nBorda++;
    if (px[i * 4 + 3] < 40) bordaTransparente++;
  }
  if (bordaTransparente / nBorda > 0.6) {
    return { ok: true, removeu: true, png: await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() };
  }

  // Cor do fundo = mediana das bordas.
  const canal = (c: number) => {
    const v = borda.map((i) => px[i * 4 + c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const fundo = [canal(0), canal(1), canal(2)];
  const dist = (i: number, ref: number[]) => {
    const r = px[i * 4] - ref[0];
    const g = px[i * 4 + 1] - ref[1];
    const b = px[i * 4 + 2] - ref[2];
    return Math.sqrt(r * r + g * g + b * b);
  };
  const TOL = 40;
  const uniformes = borda.filter((i) => dist(i, fundo) < TOL * 1.2).length;
  if (uniformes / nBorda < 0.55) return { ok: false, removeu: false, png: img };

  // Inunda a partir das bordas. Aceita o pixel se ele é parecido com o fundo, ou parecido com o
  // vizinho de fundo e ainda razoavelmente perto do fundo (sombra suave / degradê de estúdio).
  const ehFundo = new Uint8Array(total);
  const fila = new Int32Array(total);
  let ini = 0;
  let fim = 0;
  for (const i of borda) {
    if (!ehFundo[i] && dist(i, fundo) < TOL) {
      ehFundo[i] = 1;
      fila[fim++] = i;
    }
  }
  while (ini < fim) {
    const i = fila[ini++];
    const x = i % w;
    const viz = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    const ref = [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
    for (const j of viz) {
      if (j < 0 || j >= total || ehFundo[j]) continue;
      const dFundo = dist(j, fundo);
      if (dFundo < TOL || (dist(j, ref) < 9 && dFundo < TOL * 2)) {
        ehFundo[j] = 1;
        fila[fim++] = j;
      }
    }
  }
  const removidos = fim;
  if (removidos / total < 0.03) return { ok: true, removeu: false, png: await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer() };
  if (removidos / total > 0.97) return { ok: false, removeu: false, png: img };

  // Aplica: fundo transparente; beirada (pixel do produto encostado no fundo) meio transparente
  // conforme a cor dele se parece com o fundo — tira o serrilhado e o "halo" branco.
  for (let i = 0; i < total; i++) {
    if (ehFundo[i]) {
      px[i * 4 + 3] = 0;
      continue;
    }
    const x = i % w;
    const naBeira =
      (x > 0 && ehFundo[i - 1]) || (x < w - 1 && ehFundo[i + 1]) || (i - w >= 0 && ehFundo[i - w]) || (i + w < total && ehFundo[i + w]);
    if (naBeira) {
      const d = dist(i, fundo);
      const a = Math.max(0, Math.min(1, (d - TOL * 0.5) / (TOL * 1.6)));
      px[i * 4 + 3] = Math.round(px[i * 4 + 3] * Math.max(0.35, a));
    }
  }
  const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { ok: true, removeu: true, png };
}

/** Recorte pelo remove.bg (pago por imagem; só com REMOVEBG_API_KEY). */
async function removeBg(img: Buffer): Promise<Buffer> {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) throw new Error('Recorte avançado não configurado (falta REMOVEBG_API_KEY no servidor).');
  const jpg = await sharp(img).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  const form = new FormData();
  form.append('image_file', new Blob([jpg], { type: 'image/jpeg' }), 'foto.jpg');
  form.append('size', 'auto');
  form.append('format', 'png');
  const res = await fetch('https://api.remove.bg/v1.0/removebg', { method: 'POST', headers: { 'X-Api-Key': key }, body: form });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(res.status === 402 ? 'Os créditos do remove.bg acabaram.' : `remove.bg recusou a foto (${res.status}): ${t.slice(0, 160)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
