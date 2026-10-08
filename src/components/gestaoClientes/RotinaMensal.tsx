import * as React from 'react'
import { AlertTriangle, Check, RefreshCcw } from 'lucide-react'
import type { GcItemRotina } from '@/services/gestaoClientes'
import { mesPorExtenso } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

function prazoBr(prazo: string | null): string {
  return prazo ? String(prazo).slice(0, 10).split('-').reverse().join('/') : 'sem prazo'
}

/**
 * Rotina mensal do cliente: o que nasce sozinho todo mês, com prazo (relatório até o dia 5,
 * alinhamento até o dia 10 do mês seguinte). Agrupada pelo mês que fechou.
 *
 * Os itens NÃO se marcam à mão: "Publicar o relatório" marca quando o relatório do mês é publicado e
 * "Alinhamento" marca quando uma nota de Reunião/alinhamento é registrada. Por isso o botão "Registrar
 * alinhamento" mora aqui.
 */
export function RotinaMensal({
  clienteId,
  itens,
  onMudou,
}: {
  clienteId: string
  itens: GcItemRotina[]
  onMudou: () => Promise<void> | void
}) {
  const porMes = new Map<string, GcItemRotina[]>()
  for (const i of itens) {
    const chave = String(i.mes_referencia).slice(0, 7)
    porMes.set(chave, [...(porMes.get(chave) ?? []), i])
  }

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <RefreshCcw className="h-4 w-4 text-accent" /> Rotina mensal
        </h2>
      </div>
      {itens.length === 0 && (
        <p className="text-sm text-foreground/45">Os itens do mês aparecem aqui quando o mês fecha.</p>
      )}
      <div className="space-y-3">
        {[...porMes.entries()].map(([mes, doMes]) => (
          <div key={mes}>
            <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground/40">
              Referente a {mesPorExtenso(mes).toLowerCase()}
            </p>
            <ul className="space-y-1">
              {doMes.map((i) => (
                <li key={i.id} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      'grid h-4 w-4 shrink-0 place-items-center rounded border',
                      i.concluido ? 'border-success bg-success text-white' : i.atrasado ? 'border-danger' : 'border-line',
                    )}
                    title="Marca sozinho"
                    aria-label={i.concluido ? 'Feito' : 'Pendente'}
                  >
                    {i.concluido && <Check className="h-3 w-3" />}
                  </span>
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      i.concluido ? 'text-foreground/45 line-through' : i.atrasado ? 'text-danger' : 'text-foreground/85',
                    )}
                  >
                    {i.titulo}
                  </span>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1 text-xs',
                      i.atrasado ? 'text-danger' : 'text-foreground/45',
                    )}
                  >
                    {i.atrasado && <AlertTriangle className="h-3 w-3" />}
                    {i.concluido ? 'feito' : `até ${prazoBr(i.prazo)}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
