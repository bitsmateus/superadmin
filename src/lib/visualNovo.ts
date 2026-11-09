import * as React from 'react'

/**
 * Telas que já usam o visual novo (styles/visualNovo.css): o menu Suporte. As outras seguem com o
 * visual de sempre até chegar a vez delas — é só incluir o caminho aqui.
 * `/visao/<id>` são as cópias ("Duplicar") de itens do Suporte; `/tarefas` é a aba dentro do Pipeline.
 */
const ROTAS_VISUAL_NOVO = [
  '/pipeline',
  '/tarefas',
  '/clients',
  '/followups',
  '/agenda',
  '/canais',
  '/tenants',
  '/comunicados',
  '/visao',
]

export function usaVisualNovo(pathname: string): boolean {
  return ROTAS_VISUAL_NOVO.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/** Liga/desliga <html data-skin="novo"> conforme a rota (antes de pintar, pra não piscar). */
export function useVisualNovo(pathname: string) {
  React.useLayoutEffect(() => {
    const root = document.documentElement
    if (usaVisualNovo(pathname)) root.dataset.skin = 'novo'
    else delete root.dataset.skin
  }, [pathname])

  React.useEffect(
    () => () => {
      delete document.documentElement.dataset.skin
    },
    [],
  )
}
