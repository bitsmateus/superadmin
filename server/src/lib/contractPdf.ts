import puppeteer from 'puppeteer-core';
import { tirarVermelho } from './corDoContrato.js';

/**
 * Gera o PDF do contrato de verdade, renderizado no servidor via Chromium headless — sem passar
 * pelo diálogo de impressão do navegador, então sem o cabeçalho/rodapé (data, "about:blank",
 * número de página) que o Chrome sempre adiciona nesse diálogo e que nenhuma página web consegue
 * desligar sozinha. `puppeteer-core` (sem Chromium embutido, ~300MB a menos) usa o Chromium do
 * sistema — ver PUPPETEER_EXECUTABLE_PATH no Dockerfile.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  tr { break-inside: avoid; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    margin: 0;
    font-size: 12pt;
    line-height: 1.5;
  }
</style>
</head>
<body>${tirarVermelho(bodyHtml)}</body>
</html>`;
}

/** Roda dentro da página (Chromium): quebras de página que não deixam nada "cortado". Em texto (String.raw) pra o
 * transpilador não injetar nada que só existe no Node. */
const MANTER_JUNTO = String.raw`(() => {
  const norm = (t) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const blocos = Array.from(document.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6'));
  const textos = blocos.map((el) => norm(el.textContent));
  blocos.forEach((el, i) => {
    if (/^titulo [ivxlcdm0-9]+/.test(textos[i]) || /^h[1-6]$/i.test(el.tagName)) el.style.breakAfter = 'avoid';
  });
  // Fecho: da data ("Cidade, 16 de novembro de 2026") ou do primeiro "CONTRATANTE" sozinho até o fim.
  let ini = textos.findIndex((t) => /^[a-z ]+, \d{1,2} de [a-z]+ de \d{4}/.test(t));
  const c = textos.findIndex((t) => t === 'contratante');
  if (ini < 0 || (c >= 0 && ini > c)) ini = c;
  if (ini >= 0) {
    for (let i = ini; i < blocos.length; i++) {
      blocos[i].style.breakInside = 'avoid';
      if (i < blocos.length - 1) blocos[i].style.breakAfter = 'avoid';
    }
  }
})()`;

export async function renderContractPdf(bodyHtml: string, title: string): Promise<Buffer> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(bodyHtml, title), { waitUntil: 'domcontentloaded' });
    // Quebras de página que não deixam nada "cortado": título nunca fica sozinho no pé da página (vai junto com a cláusula
    // seguinte) e o fecho (data, CONTRATANTE, CONTRATADA, linhas de assinatura) fica inteiro na mesma página.
    await page.evaluate(MANTER_JUNTO);
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
