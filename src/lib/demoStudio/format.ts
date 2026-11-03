/** Datas do Demo Studio: dd/MM/yyyy HH:mm no fuso de São Paulo (convenção do módulo). */
const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function dataHora(valor: string | number | Date | null | undefined): string {
  if (!valor) return '—'
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return FORMATO.format(d).replace(',', '')
}
