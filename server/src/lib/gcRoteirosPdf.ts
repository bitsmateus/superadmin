import type { IdeiasConteudo } from './gcIa.js';

/**
 * PDF dos roteiros de vídeo gerados pela IA na aba Conteúdo (A4, um roteiro atrás do outro, sem
 * quebrar um roteiro no meio da página). Desenhado em HTML e impresso pelo Chromium (lib/htmlPdf.ts).
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const quebras = (s: string) => esc(s).replace(/\n/g, '<br>');

type Roteiro = IdeiasConteudo['roteiros_video'][number];

export function montarHtmlRoteirosPdf(opcoes: { cliente: string; geradoEm: string; tema?: string; roteiros: Roteiro[] }): string {
  const { cliente, geradoEm, tema, roteiros } = opcoes;
  const cards = roteiros
    .map((r, i) => {
      const chips = [r.duracao, r.objetivo].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('');
      return `<article class="roteiro">
  <header><span class="num">${i + 1}</span><h2>${esc(r.titulo)}</h2>${chips}</header>
  ${r.gancho ? `<div class="gancho"><b>Gancho:</b> ${quebras(r.gancho)}</div>` : ''}
  ${r.cenas.length ? `<h3>Cenas</h3><ol>${r.cenas.map((c) => `<li>${quebras(c)}</li>`).join('')}</ol>` : ''}
  ${r.cta ? `<h3>CTA</h3><p>${quebras(r.cta)}</p>` : ''}
  ${r.legenda ? `<h3>Legenda</h3><p class="legenda">${quebras(r.legenda)}</p>` : ''}
</article>`;
    })
    .join('\n');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Roteiros de vídeo — ${esc(cliente)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12.5px; line-height: 1.5; }
  .capa { border-bottom: 3px solid #2f6fe4; padding-bottom: 12px; margin-bottom: 18px; }
  .capa .marca { font-size: 11px; font-weight: 700; letter-spacing: 3px; color: #2f6fe4; }
  .capa h1 { margin: 6px 0 2px; font-size: 26px; }
  .capa .sub { color: #555; font-size: 13px; }
  .roteiro { break-inside: avoid; page-break-inside: avoid; border: 1px solid #dfe3ea; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
  .roteiro header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #2f6fe4; color: #fff; font-weight: 700; font-size: 12px; }
  h2 { margin: 0; font-size: 16px; flex: 1 1 auto; }
  .chip { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; background: #eef2f8; color: #45536b; border-radius: 4px; padding: 2px 6px; }
  .gancho { background: #eaf1fe; border-radius: 6px; padding: 8px 10px; margin: 6px 0 4px; }
  h3 { margin: 10px 0 3px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
  ol { margin: 0; padding-left: 20px; } li { margin-bottom: 3px; }
  p { margin: 0; } .legenda { color: #444; }
  .rodape { margin-top: 18px; font-size: 10px; color: #888; text-align: center; }
</style></head><body>
<div class="capa">
  <div class="marca">NX DIGITAL</div>
  <h1>Roteiros de vídeo — ${esc(cliente)}</h1>
  <div class="sub">${roteiros.length} ${roteiros.length === 1 ? 'roteiro' : 'roteiros'} · gerado em ${esc(geradoEm)}${tema ? ` · tema: ${esc(tema)}` : ''}</div>
</div>
${cards}
<div class="rodape">NX Digital · roteiros gerados com IA a partir dos posts e anúncios do cliente</div>
</body></html>`;
}

/** Nome do arquivo: "Roteiros - Fibruz.pdf" (sem caracteres que o sistema de arquivos recusa). */
export function nomeArquivoRoteiros(cliente: string): string {
  const limpo = cliente.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'cliente';
  return `Roteiros - ${limpo}.pdf`;
}
