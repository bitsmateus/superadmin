/** Converte um valor formatado em BRL (ex.: "R$ 1.234,56") de volta pra centavos inteiros. */
export function parseBRLCents(value: string): number {
  const digits = (value || '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

/** Só dígitos e, no máximo, uma vírgula com até 2 casas — sem "R$" nem separador de milhar,
 * pra não brigar com a posição do cursor enquanto a pessoa ainda tá digitando. */
export function sanitizeCurrencyRaw(input: string): string {
  let s = input.replace(/^R\$\s?/, '').replace(/\./g, '').replace(/[^\d,]/g, '')
  const firstComma = s.indexOf(',')
  if (firstComma !== -1) {
    s = s.slice(0, firstComma + 1) + s.slice(firstComma + 1).replace(/,/g, '')
  }
  const [intPart, decPart] = s.split(',')
  if (decPart !== undefined && decPart.length > 2) s = `${intPart},${decPart.slice(0, 2)}`
  return s
}

/** Digitou só a parte inteira (ex.: "250") = R$ 250,00 direto — não precisa completar com zeros.
 * Só entra centavo diferente se a pessoa mesmo digitar a vírgula (ex.: "299,9" = R$ 299,90). */
export function prettifyCurrencyRaw(raw: string): string {
  const [intPart, decPart] = raw.split(',')
  const intNumber = parseInt(intPart || '0', 10) || 0
  const cents = (decPart ?? '00').padEnd(2, '0').slice(0, 2)
  return `R$ ${intNumber.toLocaleString('pt-BR')},${cents}`
}

export function formatBRLCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Compacto pra caber no cabeçalho colorido do Kanban — só "R$" e os números, sem centavos. */
export function formatBRLCompact(cents: number): string {
  return `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`
}
