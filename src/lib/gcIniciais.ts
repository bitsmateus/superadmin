/** As iniciais de um nome de empresa: até duas letras, ignorando "de", "da", "ltda" e afins. */
export function iniciaisDe(nome: string): string {
  const ignorar = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'eireli', 'sa', 's/a'])
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p && !ignorar.has(p.toLowerCase()))
  return palavras
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}
