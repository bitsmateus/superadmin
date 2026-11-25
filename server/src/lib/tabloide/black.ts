import { esc, type DadosTabloide, type ItemTabloide } from './layout.js';

/**
 * Segundo estilo de vídeo, "Black Friday" (referência: Black 01): abertura com a logo, um produto por vez
 * (foto à esquerda, estrela laranja com o preço, nome ao lado), fundo escuro com brasas, fogo e faixas, e um
 * fechamento com a logo e os produtos. Tudo em HTML/CSS: o servidor pausa as animações e tira um print por quadro.
 */

export interface PaginaVideo {
  /** Documento HTML completo (1080×1920). */
  doc: string;
  /** Duração padrão, em segundos (a fala do locutor pode alongar). */
  duracao: number;
  /** Momentos (s, dentro da página) em que toca o "ding". */
  dings: number[];
}

export const MAX_PRODUTOS_BLACK = 8;
const DUR_INTRO = 4.4;
const DUR_PRODUTO = 4.4;
const DUR_FINAL = 4.2;

/** Quantas páginas o vídeo terá (abertura + produtos + fechamento). */
export const paginasDoBlack = (dados: DadosTabloide) => 2 + Math.min(dados.itens.length, MAX_PRODUTOS_BLACK);

const FONTES = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700;800;900&display=swap" rel="stylesheet">';

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1920px;overflow:hidden;background:#161414}
.pg{position:relative;width:1080px;height:1920px;overflow:hidden;font-family:Poppins,Arial,sans-serif;color:#fff;
  background:radial-gradient(120% 70% at 50% 30%,#3a3533 0%,#1f1c1b 60%,#141212 100%)}
@keyframes brasa{0%{transform:translate(0,0) scale(1);opacity:0}12%{opacity:.95}100%{transform:translate(50px,-1750px) scale(.4);opacity:0}}
.brasa{position:absolute;bottom:-30px;border-radius:50%;background:#ff8a1f;box-shadow:0 0 10px 3px rgba(255,120,20,.7);animation:brasa linear infinite}
@keyframes arde{0%{opacity:.7;transform:scaleY(.92)}100%{opacity:1;transform:scaleY(1.08)}}
.fogo{position:absolute;left:-15%;right:-15%;bottom:-8%;height:38%;transform-origin:50% 100%;
  background:radial-gradient(ellipse at 50% 100%,rgba(255,110,0,.95) 0%,rgba(255,90,0,.38) 42%,transparent 72%);filter:blur(16px);
  animation:arde 1.3s ease-in-out infinite alternate;animation-delay:calc(var(--t0,0s) * -1)}
.fogo.b{height:26%;opacity:.8;animation-duration:.9s;filter:blur(26px)}
@keyframes corre{to{transform:translateX(-50%)}}
.fita{position:absolute;left:-12%;width:124%;height:78px;background:#ff6a00;overflow:hidden;display:flex;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.45)}
.fita div{display:flex;white-space:nowrap;font-weight:900;font-size:36px;letter-spacing:2px;color:#1b1918;animation:corre 9s linear infinite;animation-delay:calc(var(--t0,0s) * -1)}
.fita span{padding:0 26px}
.fita.t1{top:34px;transform:rotate(-3.2deg)}
.fita.t2{top:6px;transform:rotate(2.4deg);background:#e85a00;opacity:.9}
.fita.b1{bottom:92px;transform:rotate(2.6deg)}
.fita.b2{bottom:44px;transform:rotate(-2.4deg);background:#e85a00}
.pct{position:absolute;font-weight:900;color:#ff7a00;text-shadow:0 0 28px rgba(255,110,0,.8),0 6px 0 #a83f00;line-height:1}
.pct.a{right:30px;top:300px;font-size:130px;transform:rotate(12deg)}
.pct.c{left:-10px;bottom:330px;font-size:300px;transform:rotate(-14deg)}
.logo{position:absolute;left:50%;top:140px;height:250px;max-width:620px;transform:translateX(-50%);object-fit:contain;filter:drop-shadow(0 10px 24px rgba(0,0,0,.6))}
.logo-txt{position:absolute;left:0;right:0;top:170px;text-align:center;font-weight:900;font-size:110px;line-height:1;color:#ff7a00;text-shadow:0 8px 0 #7a2c00}

/* produto */
@keyframes fotoIn{0%{transform:translateX(-130%) scale(.8);opacity:0}100%{transform:none;opacity:1}}
@keyframes estrelaIn{0%{transform:scale(0) rotate(-35deg);opacity:0}60%{transform:scale(1.14) rotate(4deg);opacity:1}100%{transform:none;opacity:1}}
@keyframes sobeIn{0%{transform:translateY(34px);opacity:0}100%{transform:none;opacity:1}}
@keyframes popIn{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.15);opacity:1}100%{transform:none;opacity:1}}
@keyframes respira{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes sai{to{opacity:0;transform:scale(.92)}}
.cena{position:absolute;inset:0;animation:sai .35s ease-in both;animation-delay:calc(var(--dur) - .35s)}
.foto{position:absolute;left:30px;top:650px;width:500px;height:580px;display:flex;align-items:center;justify-content:center;animation:fotoIn .65s cubic-bezier(.2,.9,.3,1.12) both}
.foto img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 22px 26px rgba(0,0,0,.55))}
.nome{position:absolute;left:560px;top:742px;width:470px;text-align:center;font-weight:600;font-size:38px;line-height:1.18;animation:sobeIn .5s ease-out .85s both}
.estrela{position:absolute;left:520px;top:850px;width:540px;height:460px;animation:estrelaIn .6s cubic-bezier(.2,.9,.3,1.1) .35s both}
.estrela svg{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(0 10px 22px rgba(255,100,0,.45));animation:respira 1.6s ease-in-out 1.2s infinite}
.estrela .txt{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
.oferta{font-weight:800;font-size:38px;letter-spacing:1px;animation:popIn .4s ease-out 1s both}
.preco{display:flex;align-items:flex-start;line-height:.9;animation:popIn .45s ease-out 1.05s both}
.preco .rs{font-weight:700;font-size:44px;margin-top:34px;margin-right:6px}
.preco .int{font-weight:900;font-size:168px;letter-spacing:-4px}
.preco .col{display:flex;flex-direction:column;justify-content:space-between;margin-top:18px;margin-left:4px}
.preco .cent{font-weight:800;font-size:64px}
.preco .un{font-weight:700;font-size:30px;margin-bottom:14px}

/* abertura / fechamento */
@keyframes aberturaLogo{0%{transform:translateX(-50%) translateY(420px) scale(.5);opacity:0}14%{transform:translateX(-50%) translateY(420px) scale(1.5);opacity:1}48%{transform:translateX(-50%) translateY(420px) scale(1.6);opacity:1}72%,100%{transform:translateX(-50%)}}
@keyframes cobre{0%,40%{opacity:1}62%,100%{opacity:0}}
@keyframes luz{0%{opacity:0;transform:scale(.4)}15%{opacity:.95;transform:scale(1)}40%,100%{opacity:0;transform:scale(1.6)}}
@keyframes textoIn{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.cobre{position:absolute;inset:0;background:radial-gradient(70% 50% at 50% 50%,#2a2523 0%,#0c0b0b 100%);animation:cobre 4.4s linear both}
.luz{position:absolute;left:50%;top:1010px;width:1100px;height:1100px;margin:-550px 0 0 -550px;background:radial-gradient(circle,rgba(255,170,60,.95) 0%,rgba(255,110,0,.35) 35%,transparent 65%);animation:luz 4.4s ease-out both;mix-blend-mode:screen}
.abre .logo{animation:aberturaLogo 4.4s cubic-bezier(.3,.8,.3,1) both;transform-origin:50% 0}
.abre .frase{position:absolute;left:0;right:0;top:520px;text-align:center;animation:textoIn .6s ease-out 3s both}
.frase b{display:block;font-weight:800;font-size:44px;letter-spacing:7px}
.frase i{display:block;font-style:normal;font-weight:600;font-size:40px;letter-spacing:3px;margin-top:34px;line-height:1.3}
.frase i em{font-style:normal;color:#ff7a00;font-weight:800}
@keyframes finalLogo{0%{transform:translateX(-50%) scale(.6);opacity:0}100%{transform:translateX(-50%) scale(1);opacity:1}}
.fim .logo{top:230px;height:400px;max-width:760px;animation:finalLogo .8s cubic-bezier(.2,.9,.3,1.15) both}
.fim .luz{top:560px;animation-duration:2.2s}
.pilha img{position:absolute;object-fit:contain;filter:drop-shadow(0 16px 20px rgba(0,0,0,.6));animation:sobeIn .6s ease-out both}
.val{position:absolute;left:0;right:0;top:1500px;text-align:center;font-weight:800;font-size:40px;letter-spacing:3px;animation:textoIn .6s ease-out 1.6s both}
`;

function fundo(titulo: string): string {
  const brasas = Array.from({ length: 34 }, (_, i) => {
    const left = (i * 37 + 11) % 100;
    const tam = 4 + ((i * 7) % 7);
    const dur = 5 + ((i * 13) % 5);
    const atraso = (i * 17) % 9;
    return `<i class="brasa" style="left:${left}%;width:${tam}px;height:${tam}px;animation-duration:${dur}s;animation-delay:calc(var(--t0,0s) * -1 - ${atraso}s)"></i>`;
  }).join('');
  const faixa = `<div>${Array.from({ length: 28 }, () => `<span>${esc(titulo)}</span><span>✱</span>`).join('')}</div>`;
  return (
    `<div class="fogo"></div><div class="fogo b"></div>${brasas}` +
    `<div class="fita t2">${faixa}</div><div class="fita t1">${faixa}</div>` +
    `<div class="fita b2">${faixa}</div><div class="fita b1">${faixa}</div>` +
    `<div class="pct a">%</div><div class="pct c">%</div>`
  );
}

/** Estrela de 22 pontas (elipse) no viewBox 540×460. */
function estrelaSvg(): string {
  const cx = 270;
  const cy = 230;
  const pts: string[] = [];
  const n = 22;
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const k = i % 2 === 0 ? 1 : 0.8;
    pts.push(`${(cx + 262 * k * Math.cos(a)).toFixed(1)},${(cy + 222 * k * Math.sin(a)).toFixed(1)}`);
  }
  return `<svg viewBox="0 0 540 460"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a10"/><stop offset="1" stop-color="#ff5200"/></linearGradient></defs><polygon points="${pts.join(' ')}" fill="url(#g)"/></svg>`;
}

const UNIDADE: Record<string, string> = { '': 'UND', un: 'UND', kg: 'KG', '100g': '100G', bandeja: 'BDJ' };

function logoHtml(logoUrl: string, titulo: string): string {
  return logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="">` : `<div class="logo-txt">${esc(titulo)}</div>`;
}

const doc = (corpo: string) => `<!doctype html><html><head><meta charset="utf-8">${FONTES}<style>${CSS}</style></head><body>${corpo}</body></html>`;

function paginaProduto(it: ItemTabloide, dados: DadosTabloide, logoUrl: string, titulo: string): PaginaVideo {
  const [inteiro, cent = ''] = it.preco.split(',');
  const nome = esc([it.nome, it.detalhe && `(${it.detalhe})`].filter(Boolean).join(' '));
  const foto = it.fotoUrl ? `<div class="foto"><img src="${esc(it.fotoUrl)}" alt=""></div>` : '';
  void dados;
  const corpo =
    `<div class="pg" style="--dur:${DUR_PRODUTO}s">${fundo(titulo)}${logoHtml(logoUrl, titulo)}` +
    `<div class="cena">${foto}<div class="nome">${nome}</div>` +
    `<div class="estrela">${estrelaSvg()}<div class="txt"><div class="oferta">OFERTA</div>` +
    `<div class="preco"><span class="rs">R$</span><span class="int">${esc(inteiro)}</span>` +
    `<span class="col"><span class="cent">${cent ? ',' + esc(cent) : ''}</span><span class="un">${UNIDADE[it.unidade.toLowerCase()] ?? esc(it.unidade.toUpperCase())}</span></span></div></div></div></div></div>`;
  return { doc: doc(corpo), duracao: DUR_PRODUTO, dings: [0.45, 1.05] };
}

/** Páginas do vídeo no estilo Black Friday: abertura, um produto por página e fechamento. */
export function paginasBlack(dados: DadosTabloide, logoUrl: string): PaginaVideo[] {
  const titulo = (dados.titulo || 'BLACK FRIDAY').toUpperCase();
  const itens = dados.itens.slice(0, MAX_PRODUTOS_BLACK);
  const linha1 = esc((dados.subtitulo || 'OFERTAS IMBATÍVEIS!').toUpperCase());

  const abertura = doc(
    `<div class="pg abre" style="--dur:${DUR_INTRO}s">${fundo(titulo)}<div class="cobre"></div>${logoHtml(logoUrl, titulo)}` +
      `<div class="frase"><b>${linha1}</b><i><em>DESCONTOS</em><br>EM TODOS OS SETORES</i></div>` +
      `<div class="luz"></div></div>`,
  );

  const lugares = [
    { x: 40, y: 1080, h: 360 }, { x: 640, y: 1070, h: 380 }, { x: 250, y: 1000, h: 420 },
    { x: 470, y: 1030, h: 400 }, { x: 140, y: 1180, h: 300 }, { x: 560, y: 1190, h: 300 },
  ];
  const pilha = itens
    .filter((i) => i.fotoUrl)
    .slice(0, lugares.length)
    .map((it, n) => `<img src="${esc(it.fotoUrl as string)}" alt="" style="left:${lugares[n].x}px;top:${lugares[n].y}px;height:${lugares[n].h}px;max-width:400px;animation-delay:${(0.5 + n * 0.18).toFixed(2)}s">`)
    .join('');
  const validade = dados.validade ? `<div class="val">${esc(dados.validade.toUpperCase())}</div>` : '';
  const fechamento = doc(
    `<div class="pg fim" style="--dur:${DUR_FINAL}s">${fundo(titulo)}${logoHtml(logoUrl, titulo)}<div class="luz"></div>` +
      `<div class="pilha">${pilha}</div>${validade}</div>`,
  );

  return [
    { doc: abertura, duracao: DUR_INTRO, dings: [0.5, 3.0] },
    ...itens.map((it) => paginaProduto(it, dados, logoUrl, titulo)),
    { doc: fechamento, duracao: DUR_FINAL, dings: [0.4] },
  ];
}
