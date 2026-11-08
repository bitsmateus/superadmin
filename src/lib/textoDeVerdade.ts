/**
 * Confere, sem IA, se um texto obrigatório foi escrito com palavras e não com pontos ou letras aleatórias pra bater o
 * mínimo ("..........", "asdfasdf", "kkkkkkkkkk", "teste teste teste"). Mesma regra no servidor, em server/src/lib/textoDeVerdade.ts.
 *
 * - só letras contam pro mínimo (pontos, espaços, números e símbolos não)
 * - pelo menos 2 palavras diferentes de 2+ letras, com vogal (ou abreviação comum: vc, msg, wpp…)
 * - quase nenhuma palavra sem vogal ou com 5+ consoantes seguidas ("sdfgh", "jkdhfjs")
 * - nenhuma letra 4 vezes seguidas numa palavra, nenhuma sequência do teclado (asdf, qwer…)
 * - pelo menos 5 letras diferentes no texto todo.
 */

const SIGLAS = new Set([
  'vc', 'vcs', 'tb', 'tbm', 'pq', 'hj', 'msg', 'msgs', 'wpp', 'zap', 'dps', 'qd', 'qdo', 'pfv', 'pf', 'blz', 'vlw', 'obg',
  'msm', 'cmg', 'ctg', 'td', 'tds', 'ngm', 'nd', 'sms', 'ctt', 'ctz', 'crm', 'mrr', 'cnpj', 'cpf', 'pdf', 'ddd', 'sdr', 'nx',
  'cel', 'tel', 'whats', 'ok', 'hrs', 'hr', 'min', 'sg', 'sx', 'qt', 'qtd', 'qnd', 'mt', 'mto', 'mts', 'pra', 'pro', 'ngc',
])
const SEQUENCIAS_DO_TECLADO = [
  // Trincas do teclado que não aparecem em palavra do português (ficaram de fora "ert", "rty", "uio"…: certo, aberto).
  'qwe', 'wer', 'asd', 'sdf', 'dfg', 'fgh', 'ghj', 'hjk', 'jkl', 'zxc', 'xcv', 'cvb', 'vbn', 'bnm', 'abcd',
]
const MINIMO_PALAVRAS = 2
const MINIMO_LETRAS_DIFERENTES = 5

const semAcento = (t: string) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Quantas letras o texto tem (é o que conta pro mínimo). */
export function contarLetras(texto: string): number {
  return (semAcento(texto).match(/[a-z]/g) ?? []).length
}

const palavraBoa = (p: string) => SIGLAS.has(p) || (/[aeiouy]/.test(p) && !/[^aeiouy]{5,}/.test(p))

export function textoDeVerdade(texto: string, minimoLetras: number): boolean {
  const s = semAcento(texto)
  if (contarLetras(s) < minimoLetras) return false
  const palavras = s.match(/[a-z]+/g) ?? []
  if (new Set(palavras.join('')).size < MINIMO_LETRAS_DIFERENTES) return false
  if (palavras.some((p) => /([a-z])\1{3,}/.test(p) || SEQUENCIAS_DO_TECLADO.some((q) => p.includes(q)))) return false
  const boas = new Set(palavras.filter((p) => p.length >= 2 && palavraBoa(p)))
  const ruins = palavras.filter((p) => p.length >= 3 && !palavraBoa(p)).length
  return boas.size >= MINIMO_PALAVRAS && ruins <= Math.floor(boas.size / 3)
}
