import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, MessageCircle } from 'lucide-react'
import { engeApi, type EngeCanais, type EngeEmpreendimento, type EngeEnvio, type EngeGarantia } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'

export const CHAVE_TUDO = ['engeenvio', 'tudo'] as const

export function useEngeTudo() {
  return useQuery({ queryKey: CHAVE_TUDO, queryFn: engeApi.tudo, staleTime: 15_000 })
}

export function useEngeConfig() {
  return useQuery({ queryKey: ['engeenvio', 'config'], queryFn: engeApi.config })
}

/** Canais padrão de um aviso novo: e-mail sempre; WhatsApp quando a NX está configurada. */
export function useCanaisPadrao(): EngeCanais {
  const { data } = useEngeConfig()
  return { email: true, whatsapp: Boolean(data?.nxOk) }
}

export function useModelos() {
  return useQuery({ queryKey: ['engeenvio', 'modelos'], queryFn: engeApi.modelos })
}

export function useReguas() {
  return useQuery({ queryKey: ['engeenvio', 'reguas'], queryFn: engeApi.reguas })
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

/** Liga/desliga e-mail e WhatsApp de um aviso. */
export function CanaisToggle({
  valor,
  onChange,
  idBase,
  compacto,
}: {
  valor: EngeCanais
  onChange: (v: EngeCanais) => void
  idBase: string
  compacto?: boolean
}) {
  const item = (chave: keyof EngeCanais, rotulo: string, Icone: typeof Mail) => {
    const on = valor[chave]
    return (
      <button
        id={`${idBase}-${chave}`}
        type="button"
        aria-pressed={on}
        title={on ? `${rotulo}: vai sair` : `${rotulo}: não vai sair`}
        onClick={() => {
          const novo = { ...valor, [chave]: !on }
          if (novo.email || novo.whatsapp) onChange(novo)
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border font-medium transition-colors',
          compacto ? 'h-8 px-2 text-xs' : 'h-8 px-2.5 text-xs',
          on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/50 line-through hover:text-foreground',
        )}
      >
        <Icone className="h-3.5 w-3.5" />
        {rotulo}
      </button>
    )
  }
  return (
    <span className="inline-flex gap-1">
      {item('email', 'E-mail', Mail)}
      {item('whatsapp', 'WhatsApp', MessageCircle)}
    </span>
  )
}
