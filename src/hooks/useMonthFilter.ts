import * as React from 'react'

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function currentMonthId(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function addMonthsToId(id: string, n: number): string {
  const [y, m] = id.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
export function monthLabelPt(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return `${MONTH_NAMES[m - 1] ?? id}/${y}`
}
export function monthIdBounds(id: string): { from: string; to: string } {
  const [y, m] = id.split('-').map(Number)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
}
export function withinBounds(iso: string | null | undefined, bounds: { from: string; to: string }): boolean {
  if (!iso) return false
  const d = iso.slice(0, 10)
  if (bounds.from && d < bounds.from) return false
  if (bounds.to && d > bounds.to) return false
  return true
}

/** Estado do filtro de período (mês/personalizado) de UMA lista — usado no Painel do Mês, na aba
 * Contrato e nas Métricas por SDR: pills de mês (nasce com o mês atual) + "Adicionar mês" (mês
 * seguinte ao último pill) + "Personalizado" com data de/até livre. Detecta sozinho quando o
 * calendário real vira de mês (checagem periódica + ao focar a aba) e adiciona o pill do mês
 * atual, sem tirar nem trocar o mês que a pessoa estava vendo. */
export function useMonthFilter(extraInitialMonths: string[] = []) {
  const [months, setMonths] = React.useState<string[]>(() => {
    const base = [...extraInitialMonths, currentMonthId()]
    return Array.from(new Set(base)).sort()
  })
  const [selected, setSelected] = React.useState<string>(() => currentMonthId())
  const [customMode, setCustomMode] = React.useState(false)
  const [customFrom, setCustomFrom] = React.useState('')
  const [customTo, setCustomTo] = React.useState('')

  React.useEffect(() => {
    const checkRollover = () => {
      const now = currentMonthId()
      setMonths((prev) => (prev.includes(now) ? prev : [...prev, now]))
    }
    const interval = window.setInterval(checkRollover, 5 * 60 * 1000)
    window.addEventListener('focus', checkRollover)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', checkRollover)
    }
  }, [])

  const addMonth = () => {
    const next = addMonthsToId(months[months.length - 1] ?? currentMonthId(), 1)
    setMonths((prev) => (prev.includes(next) ? prev : [...prev, next]))
    setSelected(next)
    setCustomMode(false)
  }

  const bounds = customMode ? { from: customFrom, to: customTo } : monthIdBounds(selected)

  return { months, selected, setSelected, addMonth, customMode, setCustomMode, customFrom, setCustomFrom, customTo, setCustomTo, bounds }
}
export type MonthFilter = ReturnType<typeof useMonthFilter>
