import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  header?: React.ReactNode
  width?: number | string
  children: React.ReactNode
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  header,
  width = 'min(92vw, 1400px)',
  children,
}: DrawerProps) {
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Com uma janela aberta por cima (ex.: pré-visualização de anexo), o Esc fecha só ela, não a gaveta.
      if (e.key === 'Escape' && document.querySelectorAll('[aria-modal="true"]').length <= 1) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        // No celular a gaveta ocupa a tela toda (92vw deixava uma faixa inútil de 8% e espremia o conteúdo).
        className={cn(
          'absolute right-0 top-0 h-full max-w-full overflow-hidden border-l border-line bg-card shadow-2xl max-sm:!w-full',
          'flex flex-col animate-slide-in-right',
        )}
        style={{ width }}
      >
        {(title || header) && (
          <div className="border-b border-line px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {header ?? (
                  <>
                    {title && (
                      <h2 className="text-base font-semibold text-foreground">
                        {title}
                      </h2>
                    )}
                    {description && (
                      <p className="mt-1 text-sm text-foreground/50">{description}</p>
                    )}
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="rounded-md p-1 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground focus-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {/* overflow-wrap:anywhere (herdado por tudo lá dentro): link, e-mail, token ou ID sem espaço quebra linha
            em vez de passar da borda. overflow-x-hidden: se ainda assim algo vazar, a gaveta inteira não desliza
            de lado no celular (tabelas e listas largas continuam com a própria rolagem lateral). */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden [overflow-wrap:anywhere]">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
