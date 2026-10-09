import * as React from 'react'

/** "agora", "35 min", "5 h", "3 d", "2 sem", "4 meses" — há quanto tempo o cartão está na coluna. */
export function tempoDesde(iso: string | null | undefined, agora = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const min = Math.max(0, Math.floor((agora - t) / 60000))
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  if (d < 14) return `${d} d`
  if (d < 60) return `${Math.floor(d / 7)} sem`
  return `${Math.floor(d / 30)} meses`
}

/** Dias inteiros desde a data (pra pintar de alerta o que está parado há muito tempo). */
export function diasDesde(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86400000)
}

/** Liga/desliga "mostrar tempo na coluna", lembrando a escolha por quadro neste navegador. */
export function useMostrarTempo(chave: string): [boolean, () => void] {
  const k = `kanban-tempo:${chave}`
  const [ligado, setLigado] = React.useState(() => {
    try {
      return localStorage.getItem(k) === '1'
    } catch {
      return false
    }
  })
  const alternar = React.useCallback(() => {
    setLigado((v) => {
      try {
        localStorage.setItem(k, v ? '0' : '1')
      } catch {
        /* sem storage: vale só nesta sessão */
      }
      return !v
    })
  }, [k])
  return [ligado, alternar]
}
