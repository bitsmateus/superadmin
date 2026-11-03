/**
 * PDF das artes do Social media de um cliente, no formato de apresentação da NX (16:9): capa
 * "Social media" com o período e, depois, uma página por imagem — a arte dentro de um quadro de post
 * do Instagram à esquerda, o título e o texto do que foi feito à direita. Desenhado em HTML e impresso
 * pelo Chromium (lib/htmlPdf.ts).
 */

export interface ItemPdfSocial {
  titulo: string;
  texto: string;
  /** Data URL da imagem (só imagens entram no PDF). */
  imagem: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "NX DIGITAL" em branco, desenhado (o projeto não tem o arquivo da logo). */
const LOGO_NX = `<svg class="logo" viewBox="0 0 216 124" xmlns="http://www.w3.org/2000/svg" aria-label="NX Digital">
  <g fill="#fff">
    <path d="M0 100V14Q0 0 14 0H31L73 57V0H99V100H70L26 41V100Z"/>
    <path d="M110 0H141L216 100H185Z"/>
    <path d="M185 0H216L141 100H110Z"/>
  </g>
  <text x="163" y="122" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="3" text-anchor="middle">DIGITAL</text>
</svg>`;

const ICONES_POST = `<svg viewBox="0 0 70 22" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round">
  <path d="M11 19s-8-4.6-8-10a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 19 9c0 5.4-8 10-8 10z"/>
  <path d="M37 18.5a8 8 0 1 1 3-2.6L41 20z"/>
  <path d="M51 4l16 0-6.5 15-2.5-6.5-7-2.5z"/>
</svg><svg viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#262626" stroke-width="2" stroke-linejoin="round">
  <path d="M5 3h12v16l-6-4-6 4z"/>
</svg>`;

export function montarHtmlSocialPdf(opcoes: { cliente: string; periodo: string; itens: ItemPdfSocial[] }): string {
  const { cliente, periodo, itens } = opcoes;
  const paginas = itens.map((it) => {
    const texto = it.texto.trim();
    const tamanho = texto.length > 520 ? 17 : texto.length > 300 ? 20 : 24;
    return `<section class="pagina arte">
  <div class="faixa"></div>
  <div class="circulo c1"></div><div class="circulo c2"></div>
  ${LOGO_NX}
  <div class="post">
    <div class="post-topo"><span class="avatar"></span><span class="barras"><i style="width:90px"></i><i style="width:40px"></i></span><span class="pontos">•••</span></div>
    <div class="post-img"><img src="${it.imagem}" alt=""></div>
    <div class="post-acoes">${ICONES_POST}</div>
    <div class="post-base"><i style="width:48px"></i><i style="width:160px;background:#5aa8ff"></i><i style="width:110px"></i></div>
  </div>
  <div class="conteudo">
    <h2>${esc(it.titulo)}</h2>
    ${texto ? `<p style="font-size:${tamanho}px">${esc(texto)}</p>` : ''}
  </div>
</section>`;
  });

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,500;1,600&family=Poppins:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page { size: 1280px 720px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Poppins, Arial, Helvetica, sans-serif; color: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pagina { position: relative; width: 1280px; height: 720px; overflow: hidden; page-break-after: always;
    background: linear-gradient(110deg, #141a5e 0%, #1450c8 38%, #1b8ef0 72%, #1c8fe8 100%); }
  .pagina:last-child { page-break-after: auto; }
  .logo { position: absolute; left: 44px; top: 40px; width: 132px; z-index: 3; }
  .serif { font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-style: italic; }

  .capa .bolha { position: absolute; right: -120px; top: -40px; width: 900px; height: 820px; border-radius: 46% 54% 40% 60% / 55% 45% 55% 45%;
    background: radial-gradient(circle at 40% 40%, rgba(30,140,240,.9), rgba(20,110,220,.25) 70%); }
  .capa .titulo { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; z-index: 2; }
  .capa h1 { font-family: 'Playfair Display', Georgia, serif; font-style: italic; font-weight: 500; font-size: 96px; letter-spacing: .5px; }
  .capa .sub { font-size: 22px; opacity: .85; }

  .arte .faixa { position: absolute; left: 0; top: 0; bottom: 0; width: 258px; background: linear-gradient(180deg, #0b1f86, #0d3cc0); }
  .arte .circulo { position: absolute; border: 2px solid rgba(10,20,110,.85); border-radius: 50%; }
  .arte .c1 { right: -110px; top: -150px; width: 330px; height: 330px; }
  .arte .c2 { left: -140px; bottom: -170px; width: 330px; height: 330px; border-color: rgba(120,200,255,.7); }
  .post { position: absolute; left: 120px; top: 126px; width: 310px; background: #fff; border-radius: 16px; overflow: hidden; z-index: 2;
    box-shadow: 0 18px 40px rgba(0,0,30,.35); }
  .post-topo { display: flex; align-items: center; gap: 10px; padding: 12px 14px; }
  .avatar { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #5aa8ff; }
  .barras { display: flex; flex-direction: column; gap: 5px; flex: 1; }
  .barras i, .post-base i { display: block; height: 7px; border-radius: 4px; background: #c9c9c9; }
  .pontos { color: #777; font-size: 12px; letter-spacing: 1px; }
  .post-img { width: 310px; height: 388px; background: #eee; }
  .post-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .post-acoes { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px 6px; }
  .post-acoes svg { height: 22px; width: auto; display: block; }
  .post-base { display: flex; flex-direction: column; gap: 7px; padding: 6px 14px 16px; }
  .conteudo { position: absolute; left: 500px; right: 90px; top: 58px; bottom: 50px; z-index: 2; }
  .conteudo h2 { font-family: 'Playfair Display', Georgia, serif; font-style: italic; font-weight: 500; font-size: 52px; line-height: 1.1;
    text-align: center; margin-bottom: 34px; }
  .conteudo p { line-height: 1.45; white-space: pre-line; }
</style></head><body>
<section class="pagina capa">
  <div class="bolha"></div>
  ${LOGO_NX}
  <div class="titulo"><h1>Social media</h1><p class="sub">${esc(cliente)}${periodo ? ` · ${esc(periodo)}` : ''}</p></div>
</section>
${paginas.join('\n')}
</body></html>`;
}
