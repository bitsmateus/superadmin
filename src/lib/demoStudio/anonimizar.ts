/**
 * Anonimização de texto do Demo Studio (§4.7, §6.2). Pura, sem DOM: a extensão aplica isto em cada nó de
 * texto da página ao vivo antes do print, e o painel usa a mesma função na pré-visualização das regras.
 * Portado de docs/demo-studio/reference/capture/capture-reference.js, com duas mudanças:
 *  - é IDEMPOTENTE: um valor falso já gerado não é trocado de novo. Sem isso o telefone falso batia de
 *    novo na regra de telefone e, com o MutationObserver da extensão, a página entrava em loop;
 *  - a regra "procurar → substituir" sem regex troca o trecho onde aparecer (a referência só trocava
 *    quando o texto inteiro do nó era igual).
 * O mesmo valor real vira sempre o mesmo falso durante uma captura (as telas ficam coerentes entre si).
 */

export interface RegraDeAnonimizacao {
  find: string
  replace: string
  isRegex: boolean
}

export interface AnonimizacaoAutomatica {
  phone: boolean
  email: boolean
  cpf: boolean
  cnpj: boolean
  avatars: boolean
}

export const AUTOMATICA_PADRAO: AnonimizacaoAutomatica = { phone: true, email: true, cpf: true, cnpj: true, avatars: true }

export interface Anonimizador {
  texto: (s: string) => string
  /** Quantas trocas já foram feitas (o selo da extensão mostra). */
  trocas: () => number
}

const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function criarAnonimizador(regras: RegraDeAnonimizacao[], auto: AnonimizacaoAutomatica = AUTOMATICA_PADRAO): Anonimizador {
  const falsos = new Set<string>()
  const mapa = new Map<string, string>()
  const porTipo = new Map<string, number>()
  let trocas = 0

  /** Mesmo real → mesmo falso; e um falso nunca é trocado de novo. `n` conta por tipo (1º e-mail, 2º e-mail…). */
  const trocar = (tipo: string, real: string, gerar: (n: number) => string): string => {
    if (falsos.has(real)) return real
    let f = mapa.get(real)
    if (!f) {
      const n = porTipo.get(tipo) ?? 0
      porTipo.set(tipo, n + 1)
      f = gerar(n)
      mapa.set(real, f)
      falsos.add(f)
    }
    trocas++
    return f
  }

  const compiladas: [RegExp, string][] = []
  for (const r of regras) {
    if (!r.find) continue
    try {
      compiladas.push([new RegExp(r.isRegex ? r.find : escaparRegex(r.find), 'g'), r.replace])
    } catch {
      // Regex inválida no cadastro: ignora essa regra em vez de travar a captura.
    }
  }

  const automaticas: [RegExp, (m: string) => string][] = []
  if (auto.phone) {
    automaticas.push([/WABA\s*\d+\s*-\s*\d+/g, (m) => trocar('waba', m, () => 'WhatsApp Oficial')])
    // Telefone cru (5548999990000) e formatado ((48) 99999-0000).
    automaticas.push([/\b\d{10,13}\b/g, (m) => trocar('tel-cru', m, (n) => '55489' + String(91000000 + n * 137911).slice(0, 8))])
    automaticas.push([/\(?\b\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, (m) => trocar('tel', m, (n) => `(48) 99999-${String(1000 + n).slice(-4)}`)])
  }
  if (auto.email) automaticas.push([/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => trocar('email', m, (n) => (n ? `contato${n + 1}@exemplo.com.br` : 'contato@exemplo.com.br'))])
  if (auto.cpf) automaticas.push([/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, (m) => trocar('cpf', m, () => '000.000.000-00')])
  if (auto.cnpj) automaticas.push([/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, (m) => trocar('cnpj', m, () => '00.000.000/0001-00')])

  const texto = (entrada: string): string => {
    if (!entrada || !entrada.trim()) return entrada
    let s = entrada
    for (const [rx, sub] of compiladas) {
      rx.lastIndex = 0
      if (rx.test(s)) {
        rx.lastIndex = 0
        s = s.replace(rx, (m) => {
          // O substituto de uma regra também é "falso": não vira alvo de outra regra depois.
          const novo = m.replace(new RegExp(rx.source), sub)
          falsos.add(novo)
          trocas++
          return novo
        })
      }
    }
    for (const [rx, fn] of automaticas) s = s.replace(rx, fn)
    return s
  }

  return { texto, trocas: () => trocas }
}

/** Avatar neutro que substitui fotos de perfil externas pequenas (§4.7 "fotos de perfil"). */
export const AVATAR_NEUTRO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cbd5e1"/><circle cx="20" cy="15" r="7" fill="#f8fafc"/><path d="M6 38c2-9 8-13 14-13s12 4 14 13z" fill="#f8fafc"/></svg>')
