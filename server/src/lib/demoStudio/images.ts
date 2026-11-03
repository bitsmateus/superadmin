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

/** Erro "do usuário" (vira 400 com a mensagem), diferente de falha do servidor. */
export class ErroImagem extends Error {}

/** `data:image/png;base64,....` → Buffer. */
export function bufferDoDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new ErroImagem('Envie a imagem como data URL (data:image/...;base64,...).');
  return Buffer.from(m[1], 'base64');
}
