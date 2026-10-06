import * as React from 'react'

/**
 * Marca o <body> enquanto uma tela do módulo "Clientes NX Digital" está aberta, pra o CSS do celular
 * (src/index.css, ".gc-nx") valer nela — inclusive nas janelas, que nascem fora da página (portal).
 * É escopado de propósito: o ajuste de fonte dos campos não pode mexer nas telas dos outros módulos.
 */
export function useModuloNxNoCelular() {
  React.useEffect(() => {
    document.body.classList.add('gc-nx')
    return () => document.body.classList.remove('gc-nx')
  }, [])
}
