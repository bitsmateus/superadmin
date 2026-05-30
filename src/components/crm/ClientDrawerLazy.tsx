import * as React from 'react'
import type { ClientDrawerProps } from './ClientDrawer'

// Carrega o ClientDrawer (e todas as abas: Overview, Briefing, Delivery,
// Follow-up, Contract, Finance) só quando um cliente é aberto pela primeira
// vez — tirando ~100KB do bundle inicial de quem nunca abre um cliente.
const ClientDrawerInner = React.lazy(() =>
  import('./ClientDrawer').then((m) => ({ default: m.ClientDrawer })),
)

export function ClientDrawer(props: ClientDrawerProps) {
  // Só baixa o chunk depois que o usuário abre algum cliente.
  const [everOpened, setEverOpened] = React.useState(false)
  React.useEffect(() => {
    if (props.clientId) setEverOpened(true)
  }, [props.clientId])

  if (!everOpened) return null
  return (
    <React.Suspense fallback={null}>
      <ClientDrawerInner {...props} />
    </React.Suspense>
  )
}
