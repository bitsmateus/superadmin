/** Tira toda tag HTML e devolve só o texto — usado pra checar "tem conteúdo de verdade"
 * e pra montar prévias em texto puro (linha do tempo, editar nota). */
export function stripHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  return (template.content.textContent ?? '').trim()
}

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DIV', 'SPAN', 'BR', 'P', 'A', 'UL', 'OL', 'LI'])

/** Sanitização mínima antes de renderizar HTML salvo (dangerouslySetInnerHTML): tira tag fora
 * da allowlist (mantendo o texto de dentro), atributos "on*" e links "javascript:". Mantém
 * "style" pra preservar o alinhamento centralizado feito pelo editor. */
export function sanitizeHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement
      if (!ALLOWED_TAGS.has(el.tagName)) {
        while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el)
        el.parentNode?.removeChild(el)
        continue
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) { el.removeAttribute(attr.name); continue }
        if (name === 'href' && /^\s*javascript:/i.test(attr.value)) { el.removeAttribute(attr.name); continue }
        if (name !== 'style' && name !== 'href') el.removeAttribute(attr.name)
      }
      walk(el)
    }
  }
  walk(template.content)
  return template.innerHTML
}
