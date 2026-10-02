/**
 * O dia de um carimbo de data/hora no fuso de quem está olhando.
 *
 * O banco guarda tudo em UTC. Cortar os 10 primeiros caracteres do ISO ("2026-10-01T02:30:00Z")
 * dá o dia em UTC — e um lead criado às 23h30 do dia 30/09 no Brasil vira "01/10". No virar do
 * mês isso joga a lead pra leva errada: em outubro de 2026 eram 2 leads de setembro contados como
 * de outubro, e 92 leads no dia errado desde agosto.
 *
 * Data pura ("2026-10-01", como o campo Fechamento) volta como está: não tem hora, não tem fuso.
 */
export function diaLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  // Sem hora no texto não há o que converter.
  if (!iso.includes('T')) return iso.slice(0, 10)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}
