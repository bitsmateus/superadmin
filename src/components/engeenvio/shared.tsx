import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { engeApi, type EngeEmpreendimento, type EngeEnvio, type EngeGarantia } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'

export const CHAVE_TUDO = ['engeenvio', 'tudo'] as const

export function useEngeTudo() {
  return useQuery({ queryKey: CHAVE_TUDO, queryFn: engeApi.tudo, staleTime: 15_000 })
}

export function useRecarregar() {
  const qc = useQueryClient()
  return React.useCallback(() => qc.invalidateQueries({ queryKey: CHAVE_TUDO }), [qc])
}

/** Índices pra cruzar garantia ↔ empreendimento ↔ avisos sem varrer as listas toda hora. */
export function useIndices(dados?: { empreendimentos: EngeEmpreendimento[]; garantias: EngeGarantia[]; envios: EngeEnvio[] }) {
  return React.useMemo(() => {
    const empPorId = new Map((dados?.empreendimentos ?? []).map((e) => [e.id, e]))
    const garPorId = new Map((dados?.garantias ?? []).map((g) => [g.id, g]))
    const enviosPorGar = new Map<string, EngeEnvio[]>()
    for (const e of dados?.envios ?? []) {
      const lista = enviosPorGar.get(e.garantiaId) ?? []
      lista.push(e)
      enviosPorGar.set(e.garantiaId, lista)
    }
    return { empPorId, garPorId, enviosPorGar }
  }, [dados])
}

export function Cartao({ titulo, acao, children, className }: { titulo?: React.ReactNode; acao?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border border-line bg-card', className)}>
      {(titulo || acao) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {titulo && <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>}
          {acao}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: number; detalhe: string; tom: 'danger' | 'warning' | 'info' | 'success' }) {
  const cor = { danger: 'text-danger', warning: 'text-warning', info: 'text-accent', success: 'text-success' }[tom]
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">{rotulo}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', cor)}>{valor}</p>
      <p className="text-xs text-foreground/50">{detalhe}</p>
    </div>
  )
}

export const th = 'whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-foreground/50'
export const td = 'px-4 py-3 align-middle text-sm text-foreground'

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-foreground/50">{children}</p>
}
