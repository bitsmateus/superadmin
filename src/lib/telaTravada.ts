import * as React from 'react'

/**
 * Trava o app inteiro (dentro de #root) enquanto houver um popup obrigatório aberto (resultado da reunião, retorno da
 * proposta): sem clique, Tab nem navegação por trás, e o ESC não fecha nada que esteja por baixo. Conta quantos estão
 * abertos: com dois ao mesmo tempo, resolver um não destrava a tela enquanto o outro continua.
 */
let abertos = 0

function travaEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault() }
}

function aplicar() {
  const root = document.getElementById('root')
  if (root) root.inert = abertos > 0
  window.removeEventListener('keydown', travaEsc, true)
  if (abertos > 0) window.addEventListener('keydown', travaEsc, true)
}

export function useTelaTravada(ativo: boolean) {
  React.useEffect(() => {
    if (!ativo) return
    abertos++
    aplicar()
    return () => { abertos--; aplicar() }
  }, [ativo])
}
