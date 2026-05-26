import * as React from 'react'

/**
 * Tema (claro/escuro). Persistido em localStorage; aplicado no <html>
 * via atributo data-theme.
 *
 * Default: 'dark' (mantém comportamento anterior pra usuários atuais).
 *
 * Uso:
 *   const [theme, setTheme] = useTheme()
 *   setTheme('light' | 'dark')
 *
 * Pra inicializar bem cedo (antes da hidratação React) chame
 * `applyStoredTheme()` em main.tsx. Isso evita flash de tema errado.
 */
export type Theme = 'dark' | 'light'

const LS_KEY = 'tenanthub_theme_v2'

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (raw === 'light' || raw === 'dark') return raw
  } catch {
    /* ignore */
  }
  return 'light'
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(LS_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

/** Chamar uma vez em main.tsx antes do React render. */
export function applyStoredTheme(): void {
  applyTheme(readStoredTheme())
}

const listeners = new Set<(t: Theme) => void>()
let current: Theme = readStoredTheme()

export function setThemeGlobal(theme: Theme): void {
  current = theme
  writeStoredTheme(theme)
  applyTheme(theme)
  for (const fn of listeners) fn(theme)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setLocal] = React.useState<Theme>(current)
  React.useEffect(() => {
    const fn = (t: Theme) => setLocal(t)
    listeners.add(fn)
    setLocal(current)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return [theme, setThemeGlobal]
}
