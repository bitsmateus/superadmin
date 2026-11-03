/** Datas do Demo Studio: dd/MM/yyyy HH:mm no fuso de São Paulo (convenção do módulo). */
const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const DIA_SP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Hoje (ou `d`) como aaaa-mm-dd no fuso de São Paulo. */
export function diaSP(d: Date = new Date()): string {
  return DIA_SP.format(d)
}

/** aaaa-mm-dd menos N dias (conta no calendário, sem fuso). */
export function menosDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d - n))
  return t.toISOString().slice(0, 10)
}

/** 2026-11-03 → 03/11 */
export function diaCurto(dia: string): string {
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

/** 75000 → "1min 15s" */
export function duracao(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  return s % 60 ? `${min}min ${s % 60}s` : `${min}min`
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

/** Só a hora: 14:05:09 */
export function hora(valor: string | Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(valor))
}

export function dataHora(valor: string | number | Date | null | undefined): string {
  if (!valor) return '—'
  const d = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(d.getTime())) return '—'
  return FORMATO.format(d).replace(',', '')
}
