import * as React from 'react'
import { LINK_NOVIDADES } from '@/api/comunicados'

/**
 * As novidades da plataforma moram no site de ajuda (ajuda.nxsystems.com.br/novidades). Este /novidades
 * do painel só existiu por uns dias — fica redirecionando pra lá pra nenhum link já enviado quebrar.
 */
export function NovidadesPublicPage() {
  React.useEffect(() => {
    window.location.replace(LINK_NOVIDADES)
  }, [])
  return null
}
