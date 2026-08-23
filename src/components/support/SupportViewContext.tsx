import * as React from 'react'

/**
 * Visão salva que a tela deve usar ao abrir.
 *
 * O item de origem do menu (rota fixa: /pipeline, /tickets…) renderiza a tela SEM provider, então
 * `useSupportViewValue` devolve o padrão de sempre e nada muda pra quem não usa cópias. Uma cópia
 * abre em /visao/<id> com o provider preenchido, e cada tela semeia seus filtros a partir dele.
 */
export interface SupportViewContextValue {
  /** Id da entrada de menu (a cópia). */
  pageId: string
  /** Nome da cópia — a tela pode exibir no lugar do título fixo. */
  pageName: string
  /** Chave da tela de origem ('pipeline', 'tickets'…). */
  sourceKey: string
  config: Record<string, string>
}

const SupportViewContext = React.createContext<SupportViewContextValue | null>(null)

export function SupportViewProvider({
  value,
  children,
}: {
  value: SupportViewContextValue
  children: React.ReactNode
}) {
  return <SupportViewContext.Provider value={value}>{children}</SupportViewContext.Provider>
}

/** null quando a tela foi aberta pela rota fixa (item de origem), não por uma cópia. */
export function useSupportView(): SupportViewContextValue | null {
  return React.useContext(SupportViewContext)
}

/**
 * Valor inicial de um filtro: o que a cópia salvou, ou o padrão da tela.
 *
 * Use em `React.useState(useSupportViewValue('statusFilter', 'active'))` — o valor é lido só na
 * montagem, de propósito: depois disso o filtro é do usuário, e trocar de cópia remonta a tela
 * (a rota muda), então o novo padrão entra sozinho.
 */
export function useSupportViewValue<T extends string>(key: string, fallback: T): T {
  const view = React.useContext(SupportViewContext)
  const saved = view?.config[key]
  return (saved as T | undefined) ?? fallback
}

/**
 * Mesma ideia, para campo de texto livre (busca).
 *
 * Existe à parte porque `useSupportViewValue('search', '')` faz o TS inferir o literal `""` como
 * tipo do estado, e aí `setSearch('abc')` não compila. Aqui o retorno é `string` de saída.
 */
export function useSupportViewText(key: string, fallback = ''): string {
  const view = React.useContext(SupportViewContext)
  return view?.config[key] ?? fallback
}
