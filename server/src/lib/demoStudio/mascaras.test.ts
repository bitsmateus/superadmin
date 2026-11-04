import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

// O storage lê STORAGE_DIR ao carregar o módulo: aponta para uma pasta temporária antes de importar.
const dir = path.join(os.tmpdir(), `ds-mascaras-${process.pid}`);
process.env.STORAGE_DIR = dir;

test('máscara de desfoque e de cobertura ficam gravadas só na região marcada', async () => {
  const sharp = (await import('sharp')).default;
  const { storage } = await import('./storage.js');
  const { assarMascaras } = await import('./images.js');
  // Tela 2x de 200×100 px CSS: metade esquerda listrada (texto "legível"), direita lisa.
  const listras = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#ffffff"/>` +
      Array.from({ length: 20 }, (_, i) => `<rect x="${i * 10}" y="0" width="5" height="200" fill="#000000"/>`).join('') +
      `</svg>`
  );
  const original = await sharp(listras).webp({ lossless: true }).toBuffer();
  await storage.put('frames/teste.webp', original);

  const chave = await assarMascaras('frames/teste.webp', [
    { x: 0, y: 0, w: 100, h: 100, type: 'blur' },
    { x: 150, y: 20, w: 40, h: 30, type: 'cover', text: 'Oculto <x>' },
  ], 2);
  assert.notEqual(chave, 'frames/teste.webp');
  const assada = await storage.ler(chave);
  assert.ok(assada);

  const px = async (buf: Buffer, x: number, y: number) => {
    const { data } = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return data[0];
  };
  // Na região desfocada as listras pretas/brancas viram cinza: nenhum pixel fica perto de 0 ou de 255.
  const amostras = await Promise.all([10, 30, 50, 70, 90, 110, 130, 150, 170].map((x) => px(assada!, x, 100)));
  assert.ok(amostras.every((v) => v > 40 && v < 215), `desfoque fraco: ${amostras}`);
  // Fora da máscara a listra continua nítida (x=250 em px de imagem cai na metade sem listras, branco).
  assert.ok((await px(assada!, 250, 150)) > 240);
  // Cobertura: cor #e2e8f0 (226) no meio da caixa.
  assert.ok(Math.abs((await px(assada!, 310, 45)) - 226) < 12);
  // Sem máscara, a mesma imagem volta.
  assert.equal(await assarMascaras('frames/teste.webp', [], 2), 'frames/teste.webp');
  await fs.rm(dir, { recursive: true, force: true });
});

test('página de preview escapa o texto e não entra em loop de refresh', async () => {
  const { paginaOg } = await import('../../routes/demoStudioOg.js');
  const html = paginaOg({ titulo: 'Tour <script>"x"', descricao: 'a & b', url: 'https://demo.x/d/a', imagem: 'https://api.x/img.jpg', marca: 'NX' });
  assert.ok(!html.includes('<script>"x"'));
  assert.ok(html.includes('Tour &lt;script&gt;&quot;x&quot;'));
  assert.ok(html.includes('content="https://api.x/img.jpg"'));
  assert.ok(html.includes('url=https://demo.x/d/a?nxv=1'));
  assert.ok(paginaOg({ titulo: 't', descricao: 'd', url: 'https://demo.x/l/abc?utm=1', imagem: null, marca: 'NX' }).includes('?utm=1&amp;nxv=1'));
});
