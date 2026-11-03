/**
 * Content script da captura (§6.2). Injetado sob demanda via chrome.scripting na aba ativa quando a pessoa
 * clica em "Iniciar captura" — nunca fica rodando em todas as páginas.
 *  1. anonimiza a página ao vivo (regras do workspace + automáticas) e mantém assim com MutationObserver;
 *  2. a cada clique (pointerdown, fase de captura) registra o retângulo do elemento e pede o print ao
 *     service worker ANTES da página mudar;
 *  3. no modo Imagem + HTML, guarda também um snapshot limpo do DOM.
 * Nada de cookie, token ou script da página sai daqui: o snapshot tira script, iframe, atributos on* e href.
 */
import { AVATAR_NEUTRO, criarAnonimizador, type Anonimizador } from '../../src/lib/demoStudio/anonimizar'
import type { Clique, ConfigDoConteudo, DadosDaTela, MsgParaConteudo, MsgParaSw } from './tipos'

declare global {
  interface Window { __nxDemoCapture?: boolean }
}

if (!window.__nxDemoCapture) {
  window.__nxDemoCapture = true
  iniciar()
}

function iniciar() {
  let config: ConfigDoConteudo | null = null
  let anon: Anonimizador | null = null
  let observador: MutationObserver | null = null
  let ocupado = false
  const selo = criarSelo()

  /* ---------------------------------------------------------------- anonimização ao vivo */

  const anonimizarNo = (raiz: Node) => {
    if (!anon) return
    if (raiz.nodeType === Node.TEXT_NODE) {
      const v = anon.texto(raiz.textContent ?? '')
      if (v !== raiz.textContent) raiz.textContent = v
      return
    }
    if (!(raiz instanceof Element) || raiz === selo.host) return
    const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = andar.nextNode())) {
      const v = anon.texto(n.textContent ?? '')
      if (v !== n.textContent) n.textContent = v
    }
    raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((e) => {
      const v = anon!.texto(e.value)
      if (v !== e.value) e.value = v
      const p = anon!.texto(e.placeholder)
      if (p !== e.placeholder) e.placeholder = p
    })
    raiz.querySelectorAll<HTMLElement>('[title]').forEach((e) => {
      const v = anon!.texto(e.title)
      if (v !== e.title) e.title = v
    })
    if (config?.auto.avatars) {
      // Foto de perfil vinda de outro domínio (WhatsApp, Google) e pequena vira avatar neutro.
      raiz.querySelectorAll('img').forEach((im) => {
        if (im.src && !im.src.startsWith(location.origin) && !im.src.startsWith('data:') && im.getBoundingClientRect().width <= 64) im.src = AVATAR_NEUTRO
      })
    }
  }

  const ligarAnonimizacao = () => {
    if (!config?.anonimizar) return
    anon = criarAnonimizador(config.regras, config.auto)
    anonimizarNo(document.body)
    document.title = anon.texto(document.title)
    // O SPA renderiza o tempo todo: tudo o que entrar ou mudar passa pela anonimização de novo. Como a
    // anonimização é idempotente, nossa própria troca não dispara um novo ciclo.
    observador = new MutationObserver((mut) => {
      for (const m of mut) {
        if (m.type === 'characterData') anonimizarNo(m.target)
        m.addedNodes.forEach((n) => anonimizarNo(n))
      }
    })
    observador.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  /* ---------------------------------------------------------------- captura */

  const enviarTela = async (click: Clique | null) => {
    if (ocupado || !config) return
    ocupado = true
    try {
      const dados: DadosDaTela = {
        click,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        url: location.href,
        title: anon ? anon.texto(document.title) : document.title,
        html: config.modo === 'html' ? snapshotDoDom(anon) : undefined,
      }
      // O selo não pode sair no print: some por um quadro e volta depois da resposta.
      selo.host.style.visibility = 'hidden'
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const resp = (await chrome.runtime.sendMessage({ tipo: 'tela', dados } satisfies MsgParaSw)) as { total?: number; aviso?: string } | undefined
      if (resp?.total !== undefined) selo.atualizar(resp.total, resp.aviso)
    } catch {
      selo.atualizar(config.total, 'Falhou — clique de novo')
    } finally {
      selo.host.style.visibility = 'visible'
      ocupado = false
    }
  }

  const aoApertar = (e: PointerEvent) => {
    if (!config || e.button !== 0 || !e.isTrusted) return
    if (e.composedPath().includes(selo.host)) return
    void enviarTela(cliqueDe(e))
  }

  /* ---------------------------------------------------------------- mensagens */

  chrome.runtime.onMessage.addListener((msg: MsgParaConteudo, _remetente, responder) => {
    if (msg.tipo === 'config') {
      // Já configurado nesta página (ex.: evento de navegação de SPA): só atualiza o contador.
      if (config) {
        selo.atualizar(msg.config.total)
        responder({ ok: true })
        return undefined
      }
      config = msg.config
      ligarAnonimizacao()
      selo.mostrar(config.total)
      document.addEventListener('pointerdown', aoApertar, true)
      if (config.modo === 'html') {
        chrome.runtime.sendMessage({ tipo: 'css', css: cssDaPagina() } satisfies MsgParaSw).catch(() => undefined)
      }
      responder({ ok: true })
    } else if (msg.tipo === 'capturarAgora') {
      enviarTela(null).then(() => responder({ ok: true }))
      return true
    } else if (msg.tipo === 'total') {
      selo.atualizar(msg.total, msg.aviso)
    } else if (msg.tipo === 'parar') {
      document.removeEventListener('pointerdown', aoApertar, true)
      observador?.disconnect()
      selo.host.remove()
      config = null
      window.__nxDemoCapture = false
      responder({ ok: true })
    }
    return undefined
  })
}

/* ------------------------------------------------------------------ peças */

const CLICAVEIS = 'a, button, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="link"], input, select, textarea, label, summary, [tabindex]:not([tabindex="-1"])'

/**
 * Retângulo do clique: o elemento clicável mais próximo. Se ele for enorme (um container), vira uma caixa de
 * 160×48 em volta do ponto — destaque do tamanho da tela inteira não ajuda o visitante.
 */
function cliqueDe(e: PointerEvent): Clique {
  const alvo = (e.target as Element | null)
  const el = (alvo?.closest?.(CLICAVEIS) ?? alvo) as Element | null
  const r = el?.getBoundingClientRect()
  const grande = !r || r.width * r.height > window.innerWidth * window.innerHeight * 0.35 || r.width < 2 || r.height < 2
  const caixa = grande
    ? { x: e.clientX - 80, y: e.clientY - 24, w: 160, h: 48 }
    : { x: r!.left, y: r!.top, w: r!.width, h: r!.height }
  return {
    ...caixa,
    selector: el ? seletor(el) : undefined,
    text: ((el as HTMLElement | null)?.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || undefined,
  }
}

/** Seletor CSS estável e curto (id, senão tag + classes + posição, até 4 níveis). */
function seletor(el: Element): string {
  const partes: string[] = []
  let atual: Element | null = el
  for (let i = 0; atual && i < 4 && atual !== document.body; i++) {
    if (atual.id && !/\d{3,}/.test(atual.id)) {
      partes.unshift(`#${CSS.escape(atual.id)}`)
      break
    }
    const classes = [...atual.classList].filter((c) => !/\d{3,}|^(q-|v-|css-)[a-z0-9]{5,}/i.test(c)).slice(0, 2)
    let p = atual.tagName.toLowerCase() + classes.map((c) => `.${CSS.escape(c)}`).join('')
    const irmaos = atual.parentElement ? [...atual.parentElement.children].filter((c) => c.tagName === atual!.tagName) : []
    if (irmaos.length > 1) p += `:nth-of-type(${irmaos.indexOf(atual) + 1})`
    partes.unshift(p)
    atual = atual.parentElement
  }
  return partes.join(' > ')
}

const ATRIBUTOS = new Set(['class', 'style', 'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'points', 'src', 'transform', 'opacity',
  'fill-opacity', 'stroke-opacity', 'stroke-dasharray', 'xmlns', 'type', 'placeholder', 'value', 'checked', 'disabled', 'colspan',
  'rowspan', 'offset', 'stop-color', 'gradientTransform', 'id', 'clip-path', 'fill-rule', 'clip-rule', 'preserveAspectRatio',
  'font-size', 'text-anchor', 'dominant-baseline', 'alt', 'data-state', 'aria-selected', 'aria-checked', 'aria-expanded',
  'data-orientation', 'data-side'])

/**
 * Snapshot do DOM (modo Imagem + HTML), portado de reference/capture/capture-reference.js. A página já está
 * anonimizada, então o clone também. Imagens ficam com URL absoluta (sem embutir) para o envio não pesar.
 */
function snapshotDoDom(anon: Anonimizador | null): string {
  const vivos = [...document.body.querySelectorAll('input, textarea')] as (HTMLInputElement | HTMLTextAreaElement)[]
  const telas = [...document.body.querySelectorAll('canvas')].map((c) => { try { return c.toDataURL('image/png') } catch { return '' } })
  const clone = document.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, noscript, iframe, object, embed, [data-sonner-toaster], nx-demo-selo').forEach((e) => e.remove())
  ;[...clone.querySelectorAll('canvas')].forEach((c, i) => {
    const img = document.createElement('img')
    img.src = telas[i] || ''
    img.setAttribute('style', (c.getAttribute('style') || '') + `;width:${c.style.width || c.width + 'px'};height:${c.style.height || c.height + 'px'}`)
    img.className = c.className
    c.replaceWith(img)
  })
  ;[...clone.querySelectorAll('input, textarea')].forEach((e, i) => { if (vivos[i]?.value) e.setAttribute('value', vivos[i].value) })
  clone.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) if (!ATRIBUTOS.has(a.name)) el.removeAttribute(a.name)
    if (el.tagName === 'IMG') {
      const s = el.getAttribute('src')
      if (s && !s.startsWith('data:')) { try { el.setAttribute('src', new URL(s, location.href).href) } catch { el.removeAttribute('src') } }
    }
  })
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    url: location.origin + location.pathname,
    title: anon ? anon.texto(document.title) : document.title,
    htmlClass: document.documentElement.className,
    htmlStyle: document.documentElement.getAttribute('style') || '',
    bodyClass: document.body.className,
    body: clone.innerHTML,
  })
}

/** CSS da página (uma vez por captura; o servidor deduplica por hash). Folhas de outro domínio ficam de fora. */
function cssDaPagina(): string {
  let css = ''
  for (const s of [...document.styleSheets]) {
    if (s.href && !s.href.startsWith(location.origin)) continue
    try { for (const r of [...s.cssRules]) css += r.cssText + '\n' } catch { /* folha protegida */ }
  }
  return css
}

/** Selo discreto "Gravando · N telas" no canto, em shadow DOM (o CSS da página não mexe nele). */
function criarSelo() {
  const host = document.createElement('nx-demo-selo')
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none'
  const raiz = host.attachShadow({ mode: 'closed' })
  raiz.innerHTML = `<style>
    .s{font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;background:#0f1b2d;border-radius:999px;padding:8px 12px;display:flex;gap:8px;align-items:center;box-shadow:0 8px 24px -8px rgba(0,0,0,.5);opacity:.92}
    .p{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:b 1.2s infinite}
    .a{color:#fbbf24;font-weight:500}
    @keyframes b{50%{opacity:.3}}
  </style><div class="s"><span class="p"></span><span class="t">Gravando</span><span class="a"></span></div>`
  const t = raiz.querySelector('.t')!
  const a = raiz.querySelector('.a')!
  return {
    host,
    mostrar(total: number) {
      document.documentElement.appendChild(host)
      this.atualizar(total)
    },
    atualizar(total: number, aviso?: string) {
      t.textContent = `Gravando · ${total} ${total === 1 ? 'tela' : 'telas'}`
      a.textContent = aviso ?? ''
    },
  }
}
