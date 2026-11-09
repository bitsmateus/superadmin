import * as React from 'react'

/**
 * Visual novo (styles/visualNovo.css) em todas as telas internas — as que abrem dentro do Layout,
 * com o menu lateral. As páginas públicas que os clientes abrem (portal, NPS, relatórios, ficha,
 * demos…) ficam fora do Layout e seguem com o visual delas.
 *
 * Pra tirar uma tela específica do visual novo, inclua o caminho em ROTAS_SEM_VISUAL_NOVO.
 */
const ROTAS_SEM_VISUAL_NOVO: string[] = []

export function usaVisualNovo(pathname: string): boolean {
  return !ROTAS_SEM_VISUAL_NOVO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/** Liga/desliga <html data-skin="novo"> conforme a rota (antes de pintar, pra não piscar). */
export function useVisualNovo(pathname: string) {
  React.useLayoutEffect(() => {
    const root = document.documentElement
    if (usaVisualNovo(pathname)) root.dataset.skin = 'novo'
    else delete root.dataset.skin
  }, [pathname])

  // Saindo do Layout (login, páginas públicas): volta ao visual de sempre.
  React.useEffect(
    () => () => {
      delete document.documentElement.dataset.skin
    },
    [],
  )
}
