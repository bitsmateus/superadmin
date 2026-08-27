const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL'])

/** Tira toda tag HTML e devolve só o texto — usado pra checar "tem conteúdo de verdade", montar
 * prévias em texto puro (linha do tempo) e preencher a caixa de "Editar" uma atualização.
 *
 * IMPORTANTE: usa `.textContent`? NÃO — `.textContent` simplesmente concatena o texto de dentro de
 * cada `<div>`/`<p>` sem NENHUM separador ("linha1" + "linha2" vira "linha1linha2"), então editar
 * uma atualização com várias linhas (o editor salva cada linha como um `<div>` próprio) e salvar de
 * volta esmagava tudo numa linha só, destruindo a formatação original pra sempre. Aqui insere "\n"
 * depois de `<br>` e de cada elemento em bloco, preservando a quebra de linha de verdade. */
export function stripHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  let out = ''
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent ?? ''
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement
        if (el.tagName === 'BR') { out += '\n'; continue }
        walk(el)
        if (BLOCK_TAGS.has(el.tagName) && !out.endsWith('\n')) out += '\n'
      }
    }
  }
  walk(template.content)
  return out.replace(/\n{3,}/g, '\n\n').trim()
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
