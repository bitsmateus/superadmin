/**
 * Abre uma janela pronta pra impressão com o contrato — o usuário salva como PDF pelo diálogo de
 * impressão do navegador. Mesmo mecanismo de `src/lib/accessSheet.ts` (evita dependência de PDF,
 * mantém o layout em HTML/CSS puro).
 */
export function openContractSheet(html: string, title: string, autoPrint = true): boolean {
  const full = renderContractSheetHtml(html, title)
  // NOTE: noopener/noreferrer fazem window.open devolver null — omitido de propósito, precisamos
  // escrever no document da janela nova.
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(full)
  w.document.close()
  // autoPrint=false ("Ver PDF"): só abre a prévia, sem forçar o diálogo de impressão — a pessoa
  // ainda pode clicar no botão flutuante se quiser imprimir/salvar dali.
  if (autoPrint) {
    w.setTimeout(() => {
      try { w.focus(); w.print() } catch { /* ignore */ }
    }, 250)
  }
  return true
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderContractSheetHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: "Times New Roman", Georgia, serif;
    background: #E2E8F0;
    color: #111;
    margin: 0;
    padding: 40px 20px;
  }
  .page {
    max-width: 800px;
    margin: 0 auto;
    background: #fff;
    padding: 56px 64px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.12);
    font-size: 11.5pt;
  }
  .print-btn {
    position: fixed; top: 16px; right: 16px;
    background: #4F8EF7; color: #fff; border: none;
    padding: 10px 20px; border-radius: 8px; cursor: pointer;
    font-size: 13px; font-weight: 700; font-family: sans-serif;
    box-shadow: 0 4px 14px rgba(79,142,247,0.45);
  }
  .print-btn:hover { background: #3b7de8; }
  @media print {
    .print-btn { display: none; }
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; max-width: 100%; padding: 0; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">⬇&nbsp; Salvar como PDF</button>
<div class="page">${bodyHtml}</div>
</body>
</html>`
}
