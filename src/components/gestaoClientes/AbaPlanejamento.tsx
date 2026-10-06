import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { PlanejamentoCliente } from '@/components/gestaoClientes/PlanejamentoCliente'
import { gestaoClientes, type GcMetrica } from '@/services/gestaoClientes'

/**
 * Aba "Planejamento": ponto A, metas de 6 e 12 meses, cenários e projeção. É o mesmo editor que antes
 * morava no topo de "Métricas e metas" — agora com aba própria, sempre aberto. O histórico das
 * alterações não fica aqui: cada salvamento vira um evento em "Notas e histórico".
 */
export function AbaPlanejamento({
  clienteId,
  cliente,
  onMudou,
}: {
  clienteId: string
  /** Nome e segmento, pra os modelos de texto trocarem {cliente} e {segmento}. */
  cliente?: { nome_empresa?: string | null; segmento?: string | null }
  /** Depois de salvar, o detalhe do cliente recarrega (o histórico ganha o evento novo). */
  onMudou?: () => Promise<void> | void
}) {
  const [metricas, setMetricas] = React.useState<GcMetrica[] | null>(null)

  React.useEffect(() => {
    let cancelado = false
    gestaoClientes
      .metricas(clienteId)
      .then((m) => {
        if (!cancelado) setMetricas(m)
      })
      .catch((err: Error) => toast.error('Falha ao carregar as métricas: ' + err.message))
    return () => {
      cancelado = true
    }
  }, [clienteId])

  if (metricas === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando planejamento…
      </div>
    )
  }
  return (
    <PlanejamentoCliente
      clienteId={clienteId}
      metricas={metricas}
      cliente={cliente}
      recolhivel={false}
      onMetasMudaram={async () => {
        await onMudou?.()
      }}
    />
  )
}
