/**
 * REFERÊNCIA — lógica de captura e anonimização usada na Fase 1 (rodada via console no app.nxsystems.com.br).
 * Serve de base para o content script da extensão (docs/ESPECIFICACAO.md §6).
 * Não é código de produção: portar para TypeScript, modularizar e cobrir com testes.
 */

/* ------------------------------------------------------------------ */
/* 1. Snapshot do DOM (modo HTML)                                       */
/* ------------------------------------------------------------------ */
const KEEP_ATTRS = new Set(['class','style','viewBox','d','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin',
  'cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','width','height','points','src','transform','opacity','fill-opacity',
  'stroke-opacity','stroke-dasharray','xmlns','type','placeholder','value','checked','disabled','colspan','rowspan','offset',
  'stop-color','gradientTransform','id','href','xlink:href','clip-path','fill-rule','clip-rule','preserveAspectRatio',
  'font-size','text-anchor','dominant-baseline','alt','data-state','aria-selected','aria-checked','aria-expanded',
  'data-orientation','data-side']);

async function snapshotDom() {
  const live = document.body;
  // guarda posição de rolagem dos elementos roláveis
  const marked = [];
  live.querySelectorAll('*').forEach(el => {
    if (el.scrollTop > 0 || el.scrollLeft > 0) { el.setAttribute('data-nxst', el.scrollTop + ',' + el.scrollLeft); marked.push(el); }
  });
  const canvasPngs = [...live.querySelectorAll('canvas')].map(c => { try { return c.toDataURL('image/png'); } catch { return ''; } });
  const inputValues = [...live.querySelectorAll('input,textarea')].map(e => e.value);

  const clone = live.cloneNode(true);
  marked.forEach(el => el.removeAttribute('data-nxst'));

  // remove o que não deve ir para a demo
  clone.querySelectorAll('script,noscript,iframe,[data-sonner-toaster]').forEach(e => e.remove());
  // canvas -> img (gráficos)
  [...clone.querySelectorAll('canvas')].forEach((c, k) => {
    const img = document.createElement('img');
    img.src = canvasPngs[k] || '';
    img.setAttribute('style', (c.getAttribute('style') || '') + `;width:${c.style.width || c.width + 'px'};height:${c.style.height || c.height + 'px'}`);
    img.className = c.className; c.replaceWith(img);
  });
  // valores digitados viram atributo
  [...clone.querySelectorAll('input,textarea')].forEach((e, k) => { if (inputValues[k]) e.setAttribute('value', inputValues[k]); });
  // limpa atributos (remove on*, data-* de framework etc.)
  clone.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) if (!KEEP_ATTRS.has(a.name) && a.name !== 'data-nxst') el.removeAttribute(a.name);
    if (el.tagName === 'A') el.removeAttribute('href');
  });
  // imagens do mesmo domínio viram data URI; externas ficam marcadas
  for (const im of clone.querySelectorAll('img')) {
    const s = im.getAttribute('src') || ''; if (!s || s.startsWith('data:')) continue;
    const abs = new URL(s, location.href);
    if (abs.origin === location.origin) {
      try { const b = await (await fetch(abs)).blob(); im.setAttribute('src', await blobToDataUrl(b)); } catch {}
    } else { im.setAttribute('src', abs.href); im.setAttribute('data-ext', '1'); }
  }
  return {
    width: innerWidth, height: innerHeight, url: location.href, title: document.title,
    htmlClass: document.documentElement.className,
    htmlStyle: document.documentElement.getAttribute('style') || '',   // ATENÇÃO: contém aspas — sempre escapar ao montar HTML
    bodyClass: document.body.className,
    body: clone.innerHTML,
  };
}

/* CSS da página: capturar uma vez por sessão e deduplicar por hash no servidor */
async function collectCss() {
  let css = '';
  for (const s of document.styleSheets) {
    if (s.href && !s.href.startsWith(location.origin)) continue;
    try { for (const r of s.cssRules) css += r.cssText + '\n'; } catch {}
  }
  // fontes e imagens referenciadas no CSS viram data URI
  const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]).filter(u => !u.startsWith('data:')))];
  for (const u of urls) {
    try {
      const abs = new URL(u, location.origin + '/_next/static/css/');
      if (abs.origin !== location.origin) continue;
      css = css.split(u).join(await blobToDataUrl(await (await fetch(abs)).blob()));
    } catch {}
  }
  return css;
}

/* ------------------------------------------------------------------ */
/* 2. Anonimização (aplicar NA PÁGINA AO VIVO antes do screenshot)     */
/* ------------------------------------------------------------------ */
const FIRST = ['Ana','Carlos','Juliana','Pedro','Fernanda','Rafael','Beatriz','Lucas','Camila','Diego','Patrícia','Marcos','Larissa','Thiago','Renata','Bruno','Aline','Gustavo','Vanessa','Felipe'];
const LAST  = ['Souza','Lima','Rocha','Alves','Dias','Costa','Nunes','Martins','Ferreira','Ramos','Gomes','Vieira','Pires','Melo','Cardoso','Teixeira','Barros','Reis','Lopes','Moura'];
const BIZ   = ['Auto Center','Pet Shop Amigo','Clínica Sorriso','Imobiliária Lar','Ótica Visão','Academia Fit','Studio Bella','Construtora Base','Escola Futuro','Contabilidade Prime'];

function createAnonymizer(rules /* [{find, replace, isRegex}] vindas do workspace */) {
  const phoneMap = new Map(), nameMap = new Map(); let ni = 0;
  const fakePhone = p => { if (!phoneMap.has(p)) phoneMap.set(p, '55489' + String(91000000 + phoneMap.size * 137911).slice(0, 8)); return phoneMap.get(p); };
  const fakeName = orig => {
    if (nameMap.has(orig)) return nameMap.get(orig);
    const i = ni++; let n = FIRST[i % FIRST.length] + ' ' + LAST[(i * 7) % LAST.length];
    if (/[-|\/]/.test(orig)) n += ' - ' + BIZ[i % BIZ.length];
    nameMap.set(orig, n); return n;
  };
  const AUTO = [
    [/WABA\s*\d+\s*-\s*\d+/g, () => 'WhatsApp Oficial'],
    [/\b\d{10,13}\b/g, m => fakePhone(m)],                                  // telefones crus
    [/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, m => '(48) 99999-' + String(1000 + phoneMap.size).slice(-4)], // telefones formatados
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, () => 'contato@exemplo.com.br'],           // e-mails
    [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, () => '000.000.000-00'],              // CPF
    [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, () => '00.000.000/0001-00'],   // CNPJ
  ];
  function textOf(s) {
    for (const r of rules) {
      if (r.isRegex) s = s.replace(new RegExp(r.find, 'g'), r.replace);
      else if (s.trim() === r.find) s = s.replace(r.find, r.replace);
    }
    for (const [rx, fn] of AUTO) s = s.replace(rx, fn);
    return s;
  }
  function apply(root = document.body) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const v = textOf(n.textContent); if (v !== n.textContent) n.textContent = v; }
    root.querySelectorAll('input,textarea').forEach(e => { const v = textOf(e.value); if (v !== e.value) e.value = v; });
    // fotos de perfil externas viram avatar neutro
    root.querySelectorAll('img').forEach(im => { if (im.src && !im.src.startsWith(location.origin) && !im.src.startsWith('data:') && im.width <= 64) im.src = AVATAR; });
  }
  return { apply, fakeName, fakePhone, textOf };
}
const AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cbd5e1"/><circle cx="20" cy="15" r="7" fill="#f8fafc"/><path d="M6 38c2-9 8-13 14-13s12 4 14 13z" fill="#f8fafc"/></svg>');

/* Durante a captura: manter a página anonimizada mesmo quando o SPA renderiza conteúdo novo */
function keepAnonymized(anon) {
  anon.apply();
  const mo = new MutationObserver(muts => { for (const m of muts) m.addedNodes.forEach(n => n.nodeType === 1 ? anon.apply(n) : n.nodeType === 3 && (n.textContent = anon.textOf(n.textContent))); });
  mo.observe(document.body, { childList: true, subtree: true, characterData: false });
  return () => mo.disconnect();
}

/* ------------------------------------------------------------------ */
/* 3. Lições aprendidas na Fase 1                                       */
/* ------------------------------------------------------------------ */
// - Base64 grande não sai pelo console/automação: exportar por upload direto para a API (fetch POST multipart).
// - htmlStyle tem aspas ("Inter"): sempre usar html.escape / setAttribute, nunca concatenar em style="...".
// - Avatares que contêm o nome inteiro (contato sem foto) precisam virar iniciais; só em elementos circulares <= 48px,
//   senão chips/etiquetas (rounded-full) também viram iniciais.
// - Listas longas (kanban com 200+ cards) devem ser cortadas para os primeiros N itens visíveis antes de salvar.
// - Para o player, IMAGEM (screenshot 2x em WebP) é o formato padrão: funciona em qualquer celular e no app do Claude.
//   O snapshot HTML fica guardado para edição de texto/alta fidelidade no futuro.

function blobToDataUrl(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
