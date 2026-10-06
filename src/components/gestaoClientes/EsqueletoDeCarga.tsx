import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'

/**
 * Esqueleto de carregamento: o formato do que vai aparecer, em vez de um "Carregando…" no meio da
 * tela. A página não pula quando os dados chegam, e dá pra ver que algo está vindo.
 *
 *  - `tabela`: indicadores em cima e linhas de lista;
 *  - `lista`: só linhas (pendências, modelos, estratégias);
 *  - `ficha`: cartões lado a lado (detalhe do cliente).
 */
export function EsqueletoDeCarga({
  tipo = 'lista',
  linhas = 6,
  className,
}: {
  tipo?: 'tabela' | 'lista' | 'ficha'
  linhas?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Carregando">
      {tipo === 'tabela' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}
      {tipo === 'ficha' ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {Array.from({ length: linhas }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
              <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-5 w-20 rounded-full sm:block" />
              <Skeleton className="hidden h-4 w-24 lg:block" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
