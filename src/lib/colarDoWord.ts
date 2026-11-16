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
    const temBlocoDentro = (el: Element) => [...el.children].some((c) => ehBloco(c))

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
      const partes = estiloDoTexto(cs, raiz)
      const alinha = cs.textAlign
      if (['left', 'center', 'right', 'justify'].includes(alinha)) partes.push(`text-align:${alinha}`)
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
          if (c.nodeType === Node.ELEMENT_NODE) return ehBloco(c as Element) ? bloco(c as Element) : `<p>${inline(c, cs)}</p>`
          return (c.textContent ?? '').trim() ? `<p>${esc(c.textContent ?? '')}</p>` : ''
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
          if (['left', 'center', 'right', 'justify'].includes(c.textAlign)) partes.push(`text-align:${c.textAlign}`)
          if (!transparente(c.backgroundColor)) partes.push(`background-color:${c.backgroundColor}`)
          if (ri === 0) partes.push(`width:${arredonda((td.getBoundingClientRect().width / totalPrimeira) * 100)}%`)
          const interior = temBlocoDentro(td) ? [...td.childNodes].map((n) => (n.nodeType === Node.ELEMENT_NODE ? (ehBloco(n as Element) ? bloco(n as Element) : `<p>${inline(n, c)}</p>`) : esc(n.textContent ?? ''))).join('') : filhosInline(td, c)
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
        return ehBloco(el) ? bloco(el) : `<p>${inline(el, raiz)}</p>`
      }
      return (c.textContent ?? '').trim() ? `<p>${esc(c.textContent ?? '')}</p>` : ''
    }).join('')
  } finally {
    frame.remove()
  }
}

/**
 * onPaste dos editores de contrato: se o que veio da área de transferência é HTML (Word, Docs, página), limpa e insere
 * mantendo o formato; texto puro segue o caminho normal do navegador.
 */
export function aoColarComoNoWord(e: React.ClipboardEvent<HTMLElement>) {
  const html = e.clipboardData?.getData('text/html') ?? ''
  if (!html.trim()) return
  const limpo = converterHtmlDoWord(html)
  if (!limpo.trim()) return
  e.preventDefault()
  document.execCommand('insertHTML', false, limpo)
}
