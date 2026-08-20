/** Converte um valor formatado em BRL (ex.: "R$ 1.234,56") de volta pra centavos inteiros. */
export function parseBRLCents(value: string): number {
  const digits = (value || '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function formatBRLCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Compacto pra caber no cabeçalho colorido do Kanban — só "R$" e os números, sem centavos. */
export function formatBRLCompact(cents: number): string {
  return `R$ ${Math.round(cents / 100).toLocaleString('pt-BR')}`
}
