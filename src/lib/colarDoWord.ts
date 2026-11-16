import type * as React from 'react'

/**
 * Colar do Word (ou Google Docs) no editor do contrato mantendo o documento IGUAL: alinhamento (justificado, centralizado),
 * negrito/itálico/sublinhado, cor, tamanho, espaçamento entre linhas e parágrafos, recuo e tabelas.
 *
 * O HTML que o Word manda na área de transferência vem cheio de lixo (classes Mso*, mso-*, <o:p>, comentários) e boa parte
 * da aparência está numa folha de estilo no cabeçalho, não no parágrafo. Por isso o jeito aqui é "renderizar e ler": o HTML
 * colado é aberto num iframe escondido (sem scripts), o navegador resolve todos os estilos, e a gente escreve um HTML novo e
 * limpo, só com o que o contrato precisa, em estilos escritos no próprio elemento.
 */

const FONTES = ['Arial', 'Times New Roman', 'Courier New']
const BASE_PX = 16 // 12pt: o tamanho do texto do editor
const LISTA_DE_BLOCOS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'ul', 'ol', 'li', 'pre', 'tr', 'td', 'th'])
const IGNORAR = new Set(['script', 'style', 'meta', 'link', 'title', 'head', 'xml', 'img', 'svg', 'object', 'iframe', 'noscript'])

const arredonda = (n: number) => Math.round(n * 100) / 100
const pt = (px: number) => arredonda(px * 0.75)
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;')
const num = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

function fonteDe(cs: CSSStyleDeclaration): string {
  const primeira = (cs.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim().toLowerCase()
  // Fonte que o servidor (PDF) não tem vira Arial, pro PDF sair igual à tela.
  return FONTES.find((f) => f.toLowerCase() === primeira) ?? 'Arial'
}
const negrito = (cs: CSSStyleDeclaration) => parseInt(cs.fontWeight, 10) >= 600 || cs.fontWeight === 'bold'
const transparente = (c: string) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c)

/** O que o elemento tem de diferente do pai (texto corrido). */
function estiloDoTexto(cs: CSSStyleDeclaration, pai: CSSStyleDeclaration | null): string[] {
  const out: string[] = []
  if (!pai || fonteDe(cs) !== fonteDe(pai)) out.push(`font-family:${fonteDe(cs)}`)
  if (!pai || arredonda(num(cs.fontSize)) !== arredonda(num(pai.fontSize))) out.push(`font-size:${pt(num(cs.fontSize))}pt`)
  if (!pai || negrito(cs) !== negrito(pai)) out.push(`font-weight:${negrito(cs) ? 'bold' : 'normal'}`)
  if (!pai || (cs.fontStyle === 'italic') !== (pai.fontStyle === 'italic')) out.push(`font-style:${cs.fontStyle === 'italic' ? 'italic' : 'normal'}`)
  const sub = cs.textDecorationLine.includes('underline')
  const risc = cs.textDecorationLine.includes('line-through')
  if (sub || risc) out.push(`text-decoration:${[sub ? 'underline' : '', risc ? 'line-through' : ''].filter(Boolean).join(' ')}`)
  if (!pai || cs.color !== pai.color) out.push(`color:${cs.color}`)
  if (!transparente(cs.backgroundColor)) out.push(`background-color:${cs.backgroundColor}`)
  return out
}

/** align="center" do HTML antigo (LibreOffice, Word) volta do navegador como "-webkit-center". */
function alinhamento(cs: CSSStyleDeclaration): 'left' | 'center' | 'right' | 'justify' {
  const a = cs.textAlign.replace('-webkit-', '')
  return a === 'center' || a === 'right' || a === 'justify' ? a : a === 'end' ? 'right' : 'left'
}

function borda(cs: CSSStyleDeclaration, lado: 'top' | 'right' | 'bottom' | 'left'): string | null {
  const estilo = cs.getPropertyValue(`border-${lado}-style`)
  const larg = num(cs.getPropertyValue(`border-${lado}-width`))
  if (!estilo || estilo === 'none' || estilo === 'hidden' || larg <= 0) return null
  return `border-${lado}:${Math.max(0.5, pt(larg))}pt ${estilo} ${cs.getPropertyValue(`border-${lado}-color`)}`
}

export function converterHtmlDoWord(html: string): string {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin') // sem scripts: o HTML colado nunca executa nada
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;visibility:hidden'
  document.body.appendChild(frame)
  try {
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) return ''
    doc.open()
    // Mesmo texto-base do editor (Arial 12pt, preto) pra só escrever o que foge disso.
    doc.write(`<!doctype html><html><head><style>html,body{margin:0;padding:0;font-family:Arial;font-size:12pt;color:#000;line-height:normal}</style></head><body></body></html>`)
    doc.close()
    const caixa = doc.createElement('div')
    // O Word marca o trecho copiado com <!--StartFragment-->; o resto (cabeçalho, estilos) fica pra resolver as classes.
    const miolo = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i)
    const estilos = [...html.matchAll(/<style[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n')
    caixa.innerHTML = (estilos ? estilos : '') + (miolo ? miolo[1] : (html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html))
    doc.body.appendChild(caixa)
    const cstyle = (el: Element) => win.getComputedStyle(el)
    const raiz = cstyle(doc.body)

    const ehBloco = (el: Element) => LISTA_DE_BLOCOS.has(el.localName)
    const temBlocoDentro = (el: Element): boolean => [...el.children].some((c) => ehBloco(c) || temBlocoDentro(c))
    const ehBlocoOuContem = (el: Element) => ehBloco(el) || temBlocoDentro(el)

    const inline = (no: Node, pai: CSSStyleDeclaration): string => {
      if (no.nodeType === Node.TEXT_NODE) return esc((no.textContent ?? '').replace(/[\r\n]+\s*/g, ' '))
      if (no.nodeType !== Node.ELEMENT_NODE) return ''
      const el = no as Element
      const tag = el.localName
      if (IGNORAR.has(tag)) return ''
      if (tag === 'br') return '<br>'
      const cs = cstyle(el)
      const filhos = [...el.childNodes].map((c) => inline(c, cs)).join('')
      if (!filhos) return ''
      if (tag === 'sup' || tag === 'sub') return `<${tag}>${filhos}</${tag}>`
      const estilo = estiloDoTexto(cs, pai)
      return estilo.length ? `<span style="${estilo.join(';')}">${filhos}</span>` : filhos
    }

    const filhosInline = (el: Element, cs: CSSStyleDeclaration) => [...el.childNodes].map((c) => inline(c, cs)).join('')

    const estiloDoBloco = (el: Element, cs: CSSStyleDeclaration): string => {
      // Estado COMPLETO em todo parágrafo (negrito sim/não, alinhamento…): assim o que for colado nunca herda a formatação
      // de onde o cursor estava (um título em negrito e centralizado, por exemplo).
      const sub = cs.textDecorationLine.includes('underline')
      const risc = cs.textDecorationLine.includes('line-through')
      const partes = [
        `font-family:${fonteDe(cs)}`, `font-size:${pt(num(cs.fontSize))}pt`,
        `font-weight:${negrito(cs) ? 'bold' : 'normal'}`, `font-style:${cs.fontStyle === 'italic' ? 'italic' : 'normal'}`,
        `text-decoration:${[sub ? 'underline' : '', risc ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'}`,
        `color:${cs.color}`,
      ]
      if (!transparente(cs.backgroundColor)) partes.push(`background-color:${cs.backgroundColor}`)
      partes.push(`text-align:${alinhamento(cs)}`)
      const tamanho = num(cs.fontSize) || BASE_PX
      const altura = num(cs.lineHeight)
      if (altura > 0 && cs.lineHeight !== 'normal') partes.push(`line-height:${arredonda(altura / tamanho)}`)
      partes.push(
        `margin-top:${pt(num(cs.marginTop))}pt`, `margin-bottom:${pt(num(cs.marginBottom))}pt`,
        `margin-left:${pt(num(cs.marginLeft))}pt`, `margin-right:${pt(num(cs.marginRight))}pt`,
      )
      if (num(cs.textIndent)) partes.push(`text-indent:${pt(num(cs.textIndent))}pt`)
      void el
      return partes.join(';')
    }

    const bloco = (el: Element): string => {
      const tag = el.localName
      if (IGNORAR.has(tag)) return ''
      const cs = cstyle(el)
      if (tag === 'table') return tabela(el as HTMLTableElement, cs)
      if (tag === 'ul' || tag === 'ol') {
        const itens = [...el.children].map((c) => bloco(c)).join('')
        return `<${tag} style="margin-top:${pt(num(cs.marginTop))}pt;margin-bottom:${pt(num(cs.marginBottom))}pt;padding-left:${pt(num(cs.paddingLeft))}pt;list-style-type:${cs.listStyleType}">${itens}</${tag}>`
      }
      if (tag === 'li') {
        const dentro = temBlocoDentro(el) ? [...el.childNodes].map((c) => (c.nodeType === Node.ELEMENT_NODE ? bloco(c as Element) : inline(c, cs))).join('') : filhosInline(el, cs)
        return `<li style="${estiloDoBloco(el, cs)}">${dentro || '<br>'}</li>`
      }
      if (temBlocoDentro(el)) {
        // Envoltório (div WordSection1…): só desce, o que importa são os blocos de dentro.
        return [...el.childNodes].map((c) => {
          if (c.nodeType === Node.ELEMENT_NODE) return ehBlocoOuContem(c as Element) ? bloco(c as Element) : `<p style="${estiloDoBloco(c as Element, cs)}">${inline(c, cs)}</p>`
          return (c.textContent ?? '').trim() ? `<p style="${estiloDoBloco(el, cs)}">${esc(c.textContent ?? '')}</p>` : ''
        }).join('')
      }
      const filhos = [...el.childNodes].map((c) => inline(c, cs)).join('')
      const vazio = !filhos.replace(/<br>/g, '').replace(/&nbsp;| |\s/g, '')
      return `<p style="${estiloDoBloco(el, cs)}">${vazio ? (filhos.includes('nbsp') || filhos.includes(' ') ? '&nbsp;' : '<br>') : filhos}</p>`
    }

    const tabela = (t: HTMLTableElement, cs: CSSStyleDeclaration): string => {
      const larguraPai = caixa.getBoundingClientRect().width || 800
      const larg = t.getBoundingClientRect().width
      const largura = larg >= larguraPai * 0.95 ? '100%' : `${Math.round(larg * 0.75)}pt`
      const linhas = [...t.rows]
      const primeira = linhas[0] ? [...linhas[0].cells] : []
      const totalPrimeira = primeira.reduce((s, c) => s + c.getBoundingClientRect().width, 0) || 1
      const corpo = linhas.map((tr, ri) => {
        const cels = [...tr.cells].map((td) => {
          const c = cstyle(td)
          const partes = [
            ...estiloDoTexto(c, raiz),
            ...(['top', 'right', 'bottom', 'left'] as const).map((l) => borda(c, l)).filter((b): b is string => !!b),
            `padding:${pt(num(c.paddingTop))}pt ${pt(num(c.paddingRight))}pt ${pt(num(c.paddingBottom))}pt ${pt(num(c.paddingLeft))}pt`,
            `vertical-align:${c.verticalAlign === 'baseline' ? 'top' : c.verticalAlign}`,
          ]
          partes.push(`text-align:${alinhamento(c)}`)
          if (!transparente(c.backgroundColor)) partes.push(`background-color:${c.backgroundColor}`)
          if (ri === 0) partes.push(`width:${arredonda((td.getBoundingClientRect().width / totalPrimeira) * 100)}%`)
          const interior = temBlocoDentro(td) ? [...td.childNodes].map((n) => (n.nodeType === Node.ELEMENT_NODE ? (ehBlocoOuContem(n as Element) ? bloco(n as Element) : `<p style="${estiloDoBloco(n as Element, c)}">${inline(n, c)}</p>`) : esc(n.textContent ?? ''))).join('') : filhosInline(td, c)
          const attrs = `${td.colSpan > 1 ? ` colspan="${td.colSpan}"` : ''}${td.rowSpan > 1 ? ` rowspan="${td.rowSpan}"` : ''}`
          return `<${td.localName}${attrs} style="${partes.join(';')}">${interior || '<br>'}</${td.localName}>`
        }).join('')
        return cels ? `<tr>${cels}</tr>` : ''
      }).join('')
      void cs
      return `<table style="border-collapse:collapse;width:${largura};table-layout:fixed"><tbody>${corpo}</tbody></table>`
    }

    return [...caixa.childNodes].map((c) => {
      if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as Element
        if (IGNORAR.has(el.localName)) return ''
        return ehBlocoOuContem(el) ? bloco(el) : `<p style="${estiloDoBloco(el, raiz)}">${inline(el, raiz)}</p>`
      }
      return (c.textContent ?? '').trim() ? `<p style="${estiloDoBloco(caixa, raiz)}">${esc(c.textContent ?? '')}</p>` : ''
    }).join('')
  } finally {
    frame.remove()
  }
}

/** Texto puro -> parágrafos normais (Arial 12pt, esquerda, sem negrito). */
function htmlDoTextoPuro(texto: string): string {
  const base = 'font-family:Arial;font-size:12pt;font-weight:normal;font-style:normal;text-decoration:none;color:#000;text-align:left;margin-top:0pt;margin-bottom:0pt'
  return texto.split(/\r?\n/).map((l) => `<p style="${base}">${l.trim() ? esc(l) : '<br>'}</p>`).join('')
}

/** Põe os blocos no lugar do cursor, partindo o parágrafo onde ele está — sem passar pelo colar do navegador (que mistura o
 * formato colado com o do cursor: foi o que deixou tudo em negrito e centralizado). */
function inserirBlocos(editor: HTMLElement, html: string) {
  const molde = document.createElement('div')
  molde.innerHTML = html
  const nos = [...molde.childNodes]
  const sel = window.getSelection()
  const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
  if (!range || !editor.contains(range.commonAncestorContainer)) {
    editor.append(...nos)
  } else if (nos.length === 1 && nos[0] instanceof HTMLElement && nos[0].localName === 'p' && range.startContainer !== editor) {
    // Um parágrafo só (poucas palavras copiadas): entra no meio da frase, sem partir o parágrafo onde está o cursor.
    range.deleteContents()
    const dentro = document.createDocumentFragment()
    dentro.append(...nos[0].childNodes)
    const ultimo = dentro.lastChild
    range.insertNode(dentro)
    if (ultimo) { range.setStartAfter(ultimo); range.collapse(true); sel?.removeAllRanges(); sel?.addRange(range) }
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    return
  } else {
    range.deleteContents()
    let topo: Node = range.startContainer
    while (topo !== editor && topo.parentNode && topo.parentNode !== editor) topo = topo.parentNode
    if (topo === editor) {
      // Cursor direto no editor (vazio ou entre blocos).
      const ref = editor.childNodes[range.startOffset] ?? null
      for (const n of nos) editor.insertBefore(n, ref)
    } else {
      const resto = document.createRange()
      resto.setStart(range.startContainer, range.startOffset)
      resto.setEnd(topo, topo.childNodes.length)
      const parte = resto.extractContents()
      const metade = (topo as Element).cloneNode(false) as Element
      metade.appendChild(parte)
      const vazio = (n: Element) => !(n.textContent ?? '').trim() && !n.querySelector('br,img,table')
      const antes = topo as Element
      antes.after(...nos, metade)
      if (vazio(metade)) metade.remove()
      if (vazio(antes)) antes.remove()
    }
  }
  const fim = document.createRange()
  fim.selectNodeContents(editor)
  fim.collapse(false)
  sel?.removeAllRanges()
  sel?.addRange(fim)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * onPaste dos editores de contrato: o que vem do Word/Docs/página é limpo e inserido com a formatação dele (e só dele). Se
 * a limpeza falhar, entra o texto puro em parágrafos normais — nunca o colar padrão do navegador.
 */
export function aoColarComoNoWord(e: React.ClipboardEvent<HTMLElement>) {
  const html = e.clipboardData?.getData('text/html') ?? ''
  const puro = e.clipboardData?.getData('text/plain') ?? ''
  if (!html.trim() && !puro.trim()) return
  // Texto puro de uma linha só: o colar normal do navegador já faz o certo.
  if (!html.trim() && !puro.includes('\n')) return
  let limpo = ''
  if (html.trim()) {
    try { limpo = converterHtmlDoWord(html) } catch (err) { console.error('[colar] falha ao converter o HTML colado:', err) }
  }
  if (!limpo.trim()) limpo = htmlDoTextoPuro(puro)
  if (!limpo.trim()) return
  e.preventDefault()
  inserirBlocos(e.currentTarget, limpo)
}
