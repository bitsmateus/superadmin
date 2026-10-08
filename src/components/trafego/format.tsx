import * as React from 'react'
import { cn } from '@/lib/utils'
import type { LinhaTrafego } from '@/services/trafego'

export const brl = (v: number | null | undefined): string =>
  v == null ? '—' : `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(v))}`

export const num = (v: number | null | undefined): string =>
  v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v)

export function diaCurto(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

/** Mínimos pra dar veredito (regra do documento): abaixo disso o item está só "em teste". */
export const MIN_GASTO = 300
export const MIN_LEADS = 15

export type Selo = 'vendendo' | 'cansando' | 'em teste' | null

export function seloDe(l: LinhaTrafego): Selo {
  if (l.gasto < MIN_GASTO || l.leads < MIN_LEADS) return 'em teste'
  if (l.frequencia >= 3) return 'cansando'
  if (l.vendas > 0 || l.reunioes > 0) return 'vendendo'
  return null
}

const SELO_CLASSE: Record<Exclude<Selo, null>, string> = {
  vendendo: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  cansando: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'em teste': 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
}

export function SeloBadge({ selo }: { selo: Selo }) {
  if (!selo) return null
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', SELO_CLASSE[selo])}>{selo}</span>
}

export function Painel({ title, action, children, className }: {
  title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-card', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-foreground/40">{children}</p>
}

/** Carrega dados de uma Promise e refaz quando `deps` muda. `recarregar` força de novo. */
export function useCarregar<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [dados, setDados] = React.useState<T | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    fn()
      .then((d) => { if (vivo) { setDados(d); setErro(null) } })
      .catch((e: Error) => { if (vivo) setErro(e.message) })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { dados, erro, carregando, recarregar: () => setTick((t) => t + 1) }
}

export function Estado({ carregando, erro, children }: { carregando: boolean; erro: string | null; children: React.ReactNode }) {
  if (erro) return <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>
  if (carregando) return <Vazio>Carregando…</Vazio>
  return <>{children}</>
}
