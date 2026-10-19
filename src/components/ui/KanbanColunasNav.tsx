import * as React from 'react'
import { cn } from '@/lib/utils'

export interface KanbanColunaNav {
  key: string
  label: string
  count: number
  /** Cor da bolinha ao lado do nome (opcional). */
  color?: string
}

/**
 * Atalhos das colunas do kanban — só no celular. Cada coluna ocupa quase a tela inteira, então
 * esta faixa mostra onde você está e leva direto pra qualquer coluna com um toque (sem precisar
 * deslizar várias vezes). As colunas dentro de `scrollRef` precisam ter `data-kanban-col={key}`.
 */
export function KanbanColunasNav({
  colunas,
  scrollRef,
}: {
  colunas: KanbanColunaNav[]
  scrollRef: React.RefObject<HTMLElement>
}) {
  const [ativa, setAtiva] = React.useState(colunas[0]?.key ?? '')
  const navRef = React.useRef<HTMLDivElement>(null)

  // Coluna "ativa" = a que está mais perto do centro da área rolável.
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const medir = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const caixa = el.getBoundingClientRect()
        const centro = caixa.left + caixa.width / 2
        let melhor = ''
        let dist = Infinity
        el.querySelectorAll<HTMLElement>('[data-kanban-col]').forEach((c) => {
          const r = c.getBoundingClientRect()
          const d = Math.abs(r.left + r.width / 2 - centro)
          if (d < dist) { dist = d; melhor = c.dataset.kanbanCol ?? '' }
        })
        setAtiva(melhor)
      })
    }
    medir()
    el.addEventListener('scroll', medir, { passive: true })
    window.addEventListener('resize', medir)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', medir)
      window.removeEventListener('resize', medir)
    }
  }, [scrollRef, colunas.length])

  // Mantém o atalho da coluna ativa visível na faixa.
  React.useEffect(() => {
    const nav = navRef.current
    const chip = nav?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(ativa)}"]`)
    if (!nav || !chip) return
    const n = nav.getBoundingClientRect()
    const c = chip.getBoundingClientRect()
    if (c.left < n.left || c.right > n.right) {
      nav.scrollTo({ left: nav.scrollLeft + (c.left - n.left) - (n.width - c.width) / 2, behavior: 'smooth' })
    }
  }, [ativa])

  const irPara = (key: string) => {
    const el = scrollRef.current
    const col = el?.querySelector<HTMLElement>(`[data-kanban-col="${CSS.escape(key)}"]`)
    if (!el || !col) return
    const caixa = el.getBoundingClientRect()
    const r = col.getBoundingClientRect()
    el.scrollTo({ left: el.scrollLeft + (r.left - caixa.left) - (caixa.width - r.width) / 2, behavior: 'smooth' })
  }

  if (colunas.length < 2) return null

  return (
    <div ref={navRef} className="no-scrollbar -mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 sm:hidden">
      {colunas.map((c) => (
        <button
          key={c.key || '__none__'}
          type="button"
          data-chip={c.key}
          onClick={() => irPara(c.key)}
          className={cn(
            'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors',
            ativa === c.key ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-foreground/55',
          )}
        >
          {c.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />}
          {c.label}
          <span className="tabular-nums opacity-70">{c.count}</span>
        </button>
      ))}
    </div>
  )
}
