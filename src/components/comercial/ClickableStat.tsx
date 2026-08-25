import * as React from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

/** Número clicável (total/agendadas/no-show/vendas, etc.) — abre o lead direto se só tiver 1, ou
 * uma lista pra escolher qual se tiver mais de 1. Usado em qualquer painel de métricas por SDR
 * (Dashboard Comercial, Dashboard do SDR de cada aba). A lista abre num portal com posição
 * calculada (não `absolute` centralizado no próprio botão) — senão, num pill perto da borda
 * esquerda do card (ex.: "Agendadas", a primeira de várias colunas), a lista de 256px centralizada
 * embaixo dele estourava pra fora da tela / ficava atrás da barra lateral, cortando o texto. */
export function ClickableStat({
  matches,
  boards,
  onOpenLead,
  children,
}: {
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  children: (onClick: () => void, ref: React.RefObject<HTMLButtonElement>) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(popRef, open, () => setOpen(false))

  const boardName = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? ''

  const POP_WIDTH = 256

  const handleClick = () => {
    if (matches.length === 0) return
    if (matches.length === 1) { onOpenLead(matches[0].id); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - POP_WIDTH / 2, 8),
        window.innerWidth - POP_WIDTH - 8,
      )
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 240 && rect.top > spaceBelow) {
        setCoords({ bottom: window.innerHeight - rect.top + 4, left })
      } else {
        setCoords({ top: rect.bottom + 4, left })
      }
    }
    setOpen((o) => !o)
  }

  return (
    <>
      {children(handleClick, btnRef)}
      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            left: coords.left,
            width: POP_WIDTH,
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
          }}
          className="z-50 rounded-lg border border-line bg-card p-1.5 text-left shadow-xl"
        >
          <ul className="max-h-56 overflow-y-auto">
            {matches.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => { onOpenLead(r.id); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.04]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{r.nome || 'Sem nome'}</span>
                  <span className="shrink-0 truncate text-[10px] text-foreground/40">{boardName(r.boardId)}</span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
