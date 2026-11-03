/**
 * Variáveis nos textos das demos: `{{empresa}}`, `{{nome}}`, `{{vendedor}}`, com valor padrão quando
 * vazio (`{{empresa|sua empresa}}`). Sem dependências — roda no player, no editor e nos testes do servidor.
 */
export type Variaveis = Partial<Record<string, string>>

const PADRAO = /\{\{\s*([a-zA-Z_][\w]*)\s*(?:\|([^}]*))?\}\}/g

/** Troca cada `{{chave|padrão}}` pelo valor; sem valor e sem padrão, vira texto vazio. */
export function aplicarVariaveis(texto: string, vars: Variaveis): string {
  return texto.replace(PADRAO, (_m, chave: string, padrao?: string) => {
    const v = (vars[chave] ?? '').trim()
    return v || (padrao ?? '').trim()
  })
}

/**
 * Para a mensagem do WhatsApp: a frase que depende de uma variável vazia (sem padrão) sai inteira, em vez
 * de deixar "Sou  da ." no texto. Ex.: "Olá! Sou {{nome}}. Vi o tour." sem nome → "Olá! Vi o tour."
 */
export function aplicarVariaveisSemFrasesVazias(texto: string, vars: Variaveis): string {
  const frases = texto.split(/(?<=[.!?])\s+/)
  const ficam = frases.filter((frase) => {
    for (const m of frase.matchAll(PADRAO)) {
      const v = (vars[m[1]] ?? '').trim()
      if (!v && !(m[2] ?? '').trim()) return false
    }
    return true
  })
  return aplicarVariaveis(ficam.join(' '), vars).replace(/\s{2,}/g, ' ').trim()
}

/** Só os dígitos; número brasileiro sem DDI ganha o 55. */
export function normalizarWhatsapp(numero: string): string {
  const d = numero.replace(/\D/g, '')
  return d.length === 10 || d.length === 11 ? '55' + d : d
}

export function linkWhatsapp(numero: string, mensagem: string): string {
  const n = normalizarWhatsapp(numero)
  return `https://wa.me/${n}` + (mensagem ? `?text=${encodeURIComponent(mensagem)}` : '')
}

/** 5548936181649 → (48) 93618-1649. Número fora do padrão brasileiro volta como veio. */
export function formatarTelefone(numero: string): string {
  let d = numero.replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length !== 10 && d.length !== 11) return numero
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  const corte = resto.length - 4
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** Pedaços do texto do balão: `**negrito**` e quebras de linha, sem HTML nenhum. */
export type Trecho = { tipo: 'texto' | 'negrito'; valor: string } | { tipo: 'quebra' }

export function trechosDoTexto(texto: string): Trecho[] {
  const saida: Trecho[] = []
  texto.split('\n').forEach((linha, i) => {
    if (i > 0) saida.push({ tipo: 'quebra' })
    linha.split(/(\*\*[^*]+\*\*)/).forEach((p) => {
      if (!p) return
      if (p.startsWith('**') && p.endsWith('**') && p.length > 4) saida.push({ tipo: 'negrito', valor: p.slice(2, -2) })
      else saida.push({ tipo: 'texto', valor: p })
    })
  })
  return saida
}
