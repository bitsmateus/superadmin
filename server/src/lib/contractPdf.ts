import puppeteer from 'puppeteer-core';

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
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #000;
    margin: 0;
    font-size: 12pt;
    line-height: 1.5;
  }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

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
