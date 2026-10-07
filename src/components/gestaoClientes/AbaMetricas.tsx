import * as React from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { LancamentoDoMes, doMes } from '@/components/gestaoClientes/LancamentoDoMes'
import { gestaoClientes, type GcMetrica } from '@/services/gestaoClientes'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, formatarMetrica, limitesDoMes, mesAtual, mesPorExtenso, somarMeses,
} from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/**
 * Métricas do cliente: escolhe o mês, lança (mesmo formulário da aba Relatórios) e vê o histórico mês a mês.
 * A META é o PLANO (aba Planejamento): cada campo mostra o que o plano esperava ao lado do que se lança.
 */
export function AbaMetricas({ clienteId }: { clienteId: string }) {
  const [metricas, setMetricas] = React.useState<GcMetrica[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [periodo, setPeriodo] = React.useState(mesAtual())

  const carregar = React.useCallback(async () => {
    try {
      setMetricas(await gestaoClientes.metricas(clienteId))
    } catch (err) {
      toast.error('Falha ao carregar as métricas: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const mesesLancados = Array.from(new Set(metricas.map((m) => String(m.periodo_inicio).slice(0, 7)))).sort((a, b) =>
    b.localeCompare(a),
  )

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando métricas…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setPeriodo((p) => somarMeses(p, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[160px] text-center text-sm font-semibold text-foreground">{mesPorExtenso(periodo)}</span>
        <Button variant="ghost" size="sm" onClick={() => setPeriodo((p) => somarMeses(p, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <LancamentoDoMes clienteId={clienteId} periodo={periodo} onSalvo={() => void carregar()} />

      {mesesLancados.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-line">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-foreground">
            Histórico mês a mês
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Mês</th>
                  {[...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => (
                    <th key={m.chave} className="px-3 py-2.5 text-right font-medium">
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mesesLancados.map((mes) => {
                  const v = doMes(metricas, limitesDoMes(mes).inicio)
                  return (
                    <tr key={mes} className={cn('border-t border-line', mes === periodo && 'bg-accent/[0.04]')}>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => setPeriodo(mes)}
                          className="text-foreground/85 hover:text-accent"
                        >
                          {mesPorExtenso(mes)}
                        </button>
                      </td>
                      {[...METRICAS_LANCADAS, ...METRICAS_DERIVADAS].map((m) => (
                        <td
                          key={m.chave}
                          className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-foreground/75"
                        >
                          {formatarMetrica(v[m.chave] ?? null, m.unidade)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
