/**
 * Nova demanda do suporte (pedido de 23/11): a demanda é de um cliente que já existe (escolhido por busca) ou de "Outro" (descrito à mão),
 * e a demanda criada vira uma nota na aba "Notas internas" daquele cliente.
 */

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const soDigitos = (s: string) => s.replace(/\D/g, '')

/** O mínimo que a busca precisa saber de um cliente (o Client do Pipeline tem tudo isso). */
export interface ClienteBuscavel {
  id: string
  name: string
  company?: string
  email?: string
  phone?: string
  cnpj?: string
  fichaCadastro?: { cnpj?: string }
}

/**
 * Busca por nome, empresa, e-mail, CNPJ ou telefone (com ou sem pontuação). Quem COMEÇA com o que foi digitado vem primeiro.
 * Menos de 2 caracteres não busca nada (evita despejar a lista inteira).
 */
export function buscarClientes<T extends ClienteBuscavel>(clientes: T[], termo: string, limite = 8): T[] {
  const t = semAcento(termo).trim()
  const d = soDigitos(termo)
  if (t.length < 2) return []
  const achados: { c: T; nota: number }[] = []
  for (const c of clientes) {
    const textos = [c.name, c.company, c.email].map((x) => semAcento(x ?? '')).filter(Boolean)
    const numeros = [c.phone, c.cnpj, c.fichaCadastro?.cnpj].map((x) => soDigitos(x ?? '')).filter(Boolean)
    let nota = -1
    if (textos.some((x) => x.startsWith(t))) nota = 3
    else if (textos.some((x) => x.split(/\s+/).some((p) => p.startsWith(t)))) nota = 2
    else if (textos.some((x) => x.includes(t))) nota = 1
    // Número só conta se foram digitados dígitos suficientes (3+), senão "1" casaria com todo mundo.
    if (d.length >= 3 && numeros.some((n) => n.includes(d))) nota = Math.max(nota, numeros.some((n) => n.startsWith(d)) ? 3 : 2)
    if (nota >= 0) achados.push({ c, nota })
  }
  return achados
    .sort((a, b) => b.nota - a.nota || a.c.name.localeCompare(b.c.name, 'pt-BR'))
    .slice(0, limite)
    .map((a) => a.c)
}

const FILEIRAS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '0123456789']
const VOGAIS = /[aeiouáéíóúâêôãõàü]/i

/**
 * "Outro": o que é essa demanda. Devolve '' se a descrição vale, ou o motivo de não valer. Pede pelo menos 3 letras e recusa o que
 * parece digitado sem pensar: só número, letra repetida ("aaaa"), palavra repetida ("oi oi"), teclas em sequência ("asdf", "qwer"),
 * palavra sem vogal ("kjhgf") e bloco repetido ("asdasd").
 */
export function descricaoDeOutroOk(texto: string): string {
  const t = texto.trim().replace(/\s+/g, ' ')
  const letras = (t.match(/\p{L}/gu) ?? []).length
  if (letras < 3) return 'Descreva com pelo menos 3 letras (não vale só número ou símbolo).'
  const baixo = semAcento(t)
  if (/(\p{L})\1{2,}/u.test(baixo)) return 'Escreva uma descrição de verdade: tem letras repetidas demais.'
  const palavras = t.split(/[^\p{L}]+/u).filter(Boolean)
  if (palavras.length >= 2 && new Set(palavras.map((p) => semAcento(p))).size === 1) return 'Escreva uma descrição de verdade: a mesma palavra repetida não vale.'
  const seq = baixo.replace(/[^a-z0-9]/g, '')
  for (const f of FILEIRAS) {
    const inv = [...f].reverse().join('')
    for (let i = 0; i + 4 <= f.length; i++) {
      if (seq.includes(f.slice(i, i + 4)) || seq.includes(inv.slice(i, i + 4))) return 'Escreva uma descrição de verdade: letras em sequência do teclado não valem.'
    }
  }
  for (const p of palavras) {
    const b = semAcento(p)
    if (!VOGAIS.test(p) && (p.length >= 4 || (p.length === 3 && p !== p.toUpperCase()))) return `"${p}" não parece uma palavra. Escreva uma descrição de verdade.`
    if (b.length >= 6 && /^(.{2,3})\1+$/.test(b)) return `"${p}" não parece uma palavra. Escreva uma descrição de verdade.`
  }
  return ''
}

/** "2026-11-25T17:00" ou "2026-11-25" -> "25/11/2026 às 17:00" / "25/11/2026". */
export function finalizarPorExtenso(valor: string): string {
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return valor.trim()
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` às ${m[4]}:${m[5]}` : ''}`
}

/** A nota que aparece em "Notas internas" do cliente quando uma demanda é criada pra ele. */
export function textoDaNotaDeDemanda(d: { criador: string; telefone: string; pelaGrupo: boolean; tipo: string; finalizar: string; demanda: string }): string {
  const contato = d.pelaGrupo ? 'Grupo do WhatsApp' : d.telefone.trim() || 'não informado'
  const linhas = [
    `📌 DEMANDA CRIADA — ${d.tipo}`,
    `Criada por: ${d.criador || 'Alguém'}`,
    `Veio por: ${contato}`,
    `Tipo: ${d.tipo}`,
    `Finalizar até: ${finalizarPorExtenso(d.finalizar)}`,
  ]
  const texto = d.demanda.trim()
  if (texto) linhas.push(`O que fazer: ${texto}`)
  return linhas.join('\n')
}

/** Tipo "SUPORTE COMUM": atendimento do dia a dia — não é entrega, não gera comissão e não entra em "entregas feitas". */
export function ehTipoSuporteComum(tipo: string | null | undefined): boolean {
  return (tipo ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'suportecomum'
}
