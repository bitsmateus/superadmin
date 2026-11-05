import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { documentoCompleto, documentoDaPagina, montarPaginas, type DadosTabloide } from './layout.js';

/**
 * Gera os arquivos do tabloide no Chromium (o mesmo HTML da prévia): PNG por página, PDF com todas
 * as páginas e o vídeo pro Reels/Story (animação quadro a quadro + ffmpeg).
 *
 * Uma geração por vez: o Chromium come memória e o servidor é um só.
 */

let fila: Promise<unknown> = Promise.resolve();
function naFila<T>(fn: () => Promise<T>): Promise<T> {
  const r = fila.then(fn, fn);
  fila = r.catch(() => undefined);
  return r;
}

const HOSTS_OK = /^(data:|about:|https:\/\/fonts\.(googleapis|gstatic)\.com\/)/;

async function comNavegador<T>(fn: (b: Browser) => Promise<T>): Promise<T> {
  return naFila(async () => {
    const browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    });
    try {
      return await fn(browser);
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
}

/** Abre uma aba que só carrega as fontes do Google e o que veio embutido (data:). */
async function novaAba(browser: Browser, w: number, h: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (HOSTS_OK.test(req.url())) void req.continue();
    else void req.abort();
  });
  return page;
}

async function carregar(page: Page, html: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'load', timeout: 20_000 }).catch(() => undefined);
  await page.evaluate('document.fonts.ready').catch(() => undefined);
}

export async function renderizarImagens(dados: DadosTabloide, logoUrl: string): Promise<Buffer[]> {
  const paginas = montarPaginas(dados, logoUrl);
  return comNavegador(async (browser) => {
    const page = await novaAba(browser, paginas[0].w, paginas[0].h);
    const saida: Buffer[] = [];
    for (const p of paginas) {
      await carregar(page, documentoDaPagina(dados, p));
      saida.push(Buffer.from(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: p.w, height: p.h } })));
    }
    return saida;
  });
}

export async function renderizarPdf(dados: DadosTabloide, logoUrl: string): Promise<Buffer> {
  const paginas = montarPaginas(dados, logoUrl);
  const { w, h } = paginas[0];
  return comNavegador(async (browser) => {
    const page = await novaAba(browser, w, h);
    await carregar(page, documentoCompleto(dados, paginas));
    // A4 de verdade (210×297 mm): o layout é feito em 1240 px de largura e encolhido na impressão.
    const a4 = dados.formato === 'a4';
    const pdf = await page.pdf({
      width: a4 ? '210mm' : `${w}px`,
      height: a4 ? '297mm' : `${h}px`,
      scale: a4 ? 793.7 / w : 1,
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  });
}

function caminhoFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (p) return p;
  } catch {
    /* sem o pacote: tenta o do sistema */
  }
  return 'ffmpeg';
}

const FPS = 30;
export const MAX_PAGINAS_VIDEO = 4;

/**
 * Vídeo vertical (1080×1920) pro Reels/Story: cada página entra animada (cabeçalho desce, produtos
 * pulam um a um, preço pulsa) e segura uns segundos. A animação é CSS; aqui ela é pausada e
 * posicionada no tempo exato de cada quadro, então o vídeo sai liso mesmo num servidor lento.
 */
export async function renderizarVideo(
  dados: DadosTabloide,
  logoUrl: string,
  progresso: (fracao: number) => void = () => undefined,
): Promise<Buffer> {
  const paginas = montarPaginas({ ...dados, formato: 'story' }, logoUrl, { animado: true }).slice(0, MAX_PAGINAS_VIDEO);
  const totalQuadros = paginas.reduce((s, p) => s + Math.round(p.duracao * FPS), 0);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tabloide-'));
  const arquivo = path.join(dir, 'video.mp4');
  try {
    const ff = spawn(caminhoFfmpeg(), [
      '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-profile:v', 'high', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-r', String(FPS), arquivo,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let erroFf = '';
    ff.stderr.on('data', (d: Buffer) => {
      erroFf = (erroFf + d.toString()).slice(-2000);
    });
    const terminou = new Promise<void>((resolve, reject) => {
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}: ${erroFf.slice(-400)}`))));
    });
    let erroEntrada: Error | null = null;
    ff.stdin.on('error', (e: Error) => {
      erroEntrada = e;
    });
    const escrever = (buf: Buffer) =>
      new Promise<void>((resolve, reject) => {
        if (erroEntrada) return reject(erroEntrada);
        if (ff.stdin.write(buf)) resolve();
        else ff.stdin.once('drain', () => resolve());
      });

    await comNavegador(async (browser) => {
      const page = await novaAba(browser, 1080, 1920);
      let feitos = 0;
      for (const p of paginas) {
        await carregar(page, documentoDaPagina({ ...dados, formato: 'story' }, p));
        await page.evaluate('document.getAnimations().forEach(a => a.pause())');
        const quadros = Math.round(p.duracao * FPS);
        for (let f = 0; f < quadros; f++) {
          const ms = Math.round((f / FPS) * 1000);
          await page.evaluate(`document.getAnimations().forEach(a => { a.currentTime = ${ms} })`);
          const jpg = await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1920 } });
          await escrever(Buffer.from(jpg));
          feitos++;
          if (feitos % 15 === 0) progresso(feitos / totalQuadros);
        }
      }
    });
    ff.stdin.end();
    await terminou;
    progresso(1);
    return await fs.readFile(arquivo);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
