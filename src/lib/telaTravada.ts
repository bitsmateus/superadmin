import * as React from 'react'

/**
 * Trava o app inteiro (dentro de #root) enquanto houver um popup obrigatório aberto (resultado da reunião, retorno da
 * proposta, lembrete das notificações): sem clique, Tab nem navegação por trás, e o ESC não fecha nada que esteja por
 * baixo. Guarda QUAIS estão abertos: resolver um não destrava a tela enquanto outro continua, e o lembrete das
 * notificações (que é o menos urgente) consegue esperar os outros saírem antes de aparecer.
 */
const abertos = new Set<string>()
const ouvintes = new Set<() => void>()

function travaEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault() }
}

function aplicar() {
  const root = document.getElementById('root')
  if (root) root.inert = abertos.size > 0
  window.removeEventListener('keydown', travaEsc, true)
  if (abertos.size > 0) window.addEventListener('keydown', travaEsc, true)
  ouvintes.forEach((f) => f())
}

export function useTelaTravada(ativo: boolean, id = 'popup') {
  const chave = React.useId()
  const meu = `${id}:${chave}`
  React.useEffect(() => {
    if (!ativo) return
    abertos.add(meu)
    aplicar()
    return () => { abertos.delete(meu); aplicar() }
  }, [ativo, meu])
}

/** Tem algum popup obrigatório aberto que não começa com `prefixoDoMeu`? (pro lembrete esperar os outros) */
export function useOutroPopupObrigatorio(prefixoDoMeu: string): boolean {
  const ler = React.useCallback(() => [...abertos].some((a) => !a.startsWith(`${prefixoDoMeu}:`)), [prefixoDoMeu])
  return React.useSyncExternalStore(
    React.useCallback((avisar: () => void) => { ouvintes.add(avisar); return () => { ouvintes.delete(avisar) } }, []),
    ler,
    () => false,
  )
}
