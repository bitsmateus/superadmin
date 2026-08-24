/**
 * Placeholders do modelo de contrato ficam guardados como entidades HTML — "&lt;&lt;Nome
 * Fantasia&gt;&gt;" — pra serem HTML válido dentro do próprio texto (o "<<...>>" visual do
 * documento original não pode ir cru, o navegador tentaria interpretar como tag). Essa regex casa
 * exatamente esse formato.
 */
const PLACEHOLDER_RE = /&lt;&lt;([^&]+?)&gt;&gt;/g

/** Nomes dos placeholders detectados no modelo, na ordem em que aparecem, sem repetir — cada nome
 * vira UM campo no formulário (preencher uma vez substitui TODAS as ocorrências). */
export function extractPlaceholders(html: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of html.matchAll(PLACEHOLDER_RE)) {
    const name = m[1].trim()
    if (!seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Substitui cada placeholder pelo valor preenchido em `campos`. Sem valor (ou vazio) = mantém o
 * token visível, pintado de vermelho — mesmo aviso visual do documento original de referência. */
export function applyPlaceholders(html: string, campos: Record<string, string>): string {
  return html.replace(PLACEHOLDER_RE, (full, rawName: string) => {
    const name = rawName.trim()
    const value = campos[name]?.trim()
    if (value) return escapeHtml(value)
    return `<span style="color:#dc2626;font-weight:600;">${full}</span>`
  })
}

/** Casamento EXATO (não parcial) entre o nome do placeholder normalizado e o campo da BrasilAPI —
 * evita, por exemplo, "Número" (endereço) confundir com "Número de telas". */
const CNPJ_FIELD_ALIASES: Record<string, string> = {
  'nome fantasia': 'nomeFantasia',
  'razao social': 'razaoSocial',
  'logradouro/rua': 'logradouro',
  'logradouro': 'logradouro',
  'rua': 'logradouro',
  'numero': 'numero',
  'complemento': 'complemento',
  'bairro': 'bairro',
  'cidade': 'municipio',
  'municipio': 'municipio',
  'estado': 'uf',
  'uf': 'uf',
  'cep': 'cep',
}

function normalize(s: string): string {
  const noAccents = s
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      return code < 0x0300 || code > 0x036f
    })
    .join('')
  return noAccents.toLowerCase().trim()
}

/** Pro placeholder detectado no modelo, devolve a chave correspondente na resposta da BrasilAPI
 * (ou undefined se não for um campo derivável do CNPJ — esses ficam sempre manuais). */
export function cnpjFieldFor(placeholderName: string): string | undefined {
  return CNPJ_FIELD_ALIASES[normalize(placeholderName)]
}
