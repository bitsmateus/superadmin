import sharp from 'sharp';
import { chaveComHash, storage } from './storage.js';

/** Upload manual: 12 MB antes da conversão (a extensão tem o próprio limite de 4 MB, §6.3). */
export const MAX_BYTES_IMAGEM = 12 * 1024 * 1024;
const LARGURA_MINIATURA = 480;

export interface FrameProcessado {
  imagePath: string;
  thumbPath: string;
  /** px CSS */
  width: number;
  height: number;
  pixelRatio: number;
}

/**
 * Converte a captura para WebP q78 (mantendo a resolução, 2x em retina) e gera a miniatura de 480px.
 * width/height voltam em px CSS: pixels da imagem ÷ pixel ratio. Sem pixel ratio informado, 2 quando
 * a imagem tem ≥ 2560px de largura (captura de tela retina), senão 1.
 * WebP que já chega pronto (seed, extensão) é guardado como veio, pra não perder qualidade recomprimindo.
 */
export async function processarImagem(buf: Buffer, pixelRatio?: number): Promise<FrameProcessado> {
  if (buf.length > MAX_BYTES_IMAGEM) throw new ErroImagem('Imagem maior que 12 MB.');
  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    throw new ErroImagem('Arquivo não é uma imagem válida (use PNG, JPG ou WebP).');
  }
  if (!meta.width || !meta.height || !['png', 'jpeg', 'webp'].includes(meta.format ?? '')) {
    throw new ErroImagem('Formato não suportado (use PNG, JPG ou WebP).');
  }
  if (meta.width > 8000 || meta.height > 8000) throw new ErroImagem('Imagem grande demais (máx. 8000px).');

  const pr = pixelRatio && pixelRatio > 0 && pixelRatio <= 4 ? pixelRatio : meta.width >= 2560 ? 2 : 1;
  const imagem = meta.format === 'webp' ? buf : await sharp(buf).webp({ quality: 78 }).toBuffer();
  const miniatura = await sharp(buf).resize({ width: LARGURA_MINIATURA, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();

  const imagePath = chaveComHash('frames', imagem, 'webp');
  const thumbPath = chaveComHash('thumbs', miniatura, 'webp');
  await storage.put(imagePath, imagem);
  await storage.put(thumbPath, miniatura);
  return {
    imagePath,
    thumbPath,
    width: Math.round(meta.width / pr),
    height: Math.round(meta.height / pr),
    pixelRatio: pr,
  };
}

export interface Mascara {
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'blur' | 'cover';
  text?: string;
}

const escaparXml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]!));

/**
 * "Assa" as máscaras na imagem (§4.2): gera uma WebP nova com o desfoque/cobertura gravados nos pixels.
 * É o que vai para a versão publicada — sobreposição só no navegador deixaria o dado real na imagem pública.
 * O desfoque reduz a região a ~1/14 e amplia de volta com blur: não dá para reverter e ler o texto.
 * Coordenadas em px CSS do frame; convertidas para pixels da imagem pelo pixel ratio.
 */
export async function assarMascaras(imagePath: string, mascaras: Mascara[], pixelRatio: number): Promise<string> {
  if (!mascaras.length) return imagePath;
  const original = await storage.ler(imagePath);
  if (!original) throw new Error(`Imagem não encontrada no storage: ${imagePath}`);
  const meta = await sharp(original).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const camadas: sharp.OverlayOptions[] = [];
  for (const m of mascaras) {
    const left = Math.max(0, Math.min(Math.round(m.x * pixelRatio), W - 1));
    const top = Math.max(0, Math.min(Math.round(m.y * pixelRatio), H - 1));
    const width = Math.max(1, Math.min(Math.round(m.w * pixelRatio), W - left));
    const height = Math.max(1, Math.min(Math.round(m.h * pixelRatio), H - top));
    if (m.type === 'blur') {
      // Reduz a ~1 pixel a cada 24 px CSS (até título grande vira mancha), amplia com blur forte e passa um
      // véu claro por cima para cortar o contraste do que sobrar.
      const fator = 24 * pixelRatio;
      const pequeno = await sharp(original)
        .extract({ left, top, width, height })
        .resize(Math.max(1, Math.round(width / fator)), Math.max(1, Math.round(height / fator)), { fit: 'fill' })
        .toBuffer();
      const borrado = await sharp(pequeno).resize(width, height, { fit: 'fill', kernel: 'cubic' }).blur(Math.max(3, 8 * pixelRatio)).toBuffer();
      camadas.push({ input: borrado, left, top });
      camadas.push({
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#e2e8f0" fill-opacity="0.55"/></svg>`),
        left,
        top,
      });
    } else {
      const fonte = Math.round(Math.min(height * 0.45, 15 * pixelRatio));
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" rx="${Math.round(4 * pixelRatio)}" fill="#e2e8f0"/>
        ${m.text ? `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fonte}" fill="#475569">${escaparXml(m.text)}</text>` : ''}
      </svg>`;
      camadas.push({ input: Buffer.from(svg), left, top });
    }
  }
  const final = await sharp(original).composite(camadas).webp({ quality: 78 }).toBuffer();
  const chave = chaveComHash('frames', final, 'webp');
  await storage.put(chave, final);
  return chave;
}

/** Erro "do usuário" (vira 400 com a mensagem), diferente de falha do servidor. */
export class ErroImagem extends Error {}

/** `data:image/png;base64,....` → Buffer. */
export function bufferDoDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new ErroImagem('Envie a imagem como data URL (data:image/...;base64,...).');
  return Buffer.from(m[1], 'base64');
}
