import { Loader2 } from 'lucide-react'

/** Placeholder enquanto o chunk de uma página lazy carrega. */
export function PageFallback() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-foreground/55">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </span>
    </div>
  )
}
