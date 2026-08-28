import puppeteer from 'puppeteer-core';

/**
 * Renderiza um HTML JÁ COMPLETO (documento inteiro, com <html>/<head>/<style> — ao contrário de
 * contractPdf.ts, que recebe só um fragmento e o envolve num template próprio) pra PDF via
 * Chromium headless — sem passar pelo diálogo de impressão do navegador. Usado pelo "Baixar
 * acessos" (ver server/src/routes/clients.ts), cujo HTML já vem pronto do front (renderAccessSheetHtml)
 * com seu próprio layout de página, incluindo as regras @media print que zeram a margem/sombra.
 */
export async function renderFullHtmlToPdf(html: string): Promise<Buffer> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
