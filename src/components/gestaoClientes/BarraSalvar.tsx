import { Button } from '@/components/ui/Button'

/**
 * Barra de salvar FIXA no pé da tela: só aparece com alteração pendente e acompanha a rolagem, então
 * quem editou lá embaixo não precisa subir até o botão do cabeçalho.
 */
export function BarraSalvar({
  visivel,
  salvando,
  rotulo = 'Salvar',
  onSalvar,
  onDescartar,
}: {
  visivel: boolean
  salvando: boolean
  rotulo?: string
  onSalvar: () => void
  onDescartar: () => void
}) {
  if (!visivel) return null
  return (
    <div
      role="region"
      aria-label="Alterações não salvas"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      className="sticky z-30 mx-auto mt-4 flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/40 bg-surface/95 px-3 py-2.5 shadow-lg backdrop-blur sm:px-4"
    >
      <span className="flex items-center gap-2 text-sm text-foreground">
        <span className="h-2 w-2 rounded-full bg-warning" /> Alterações não salvas
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onDescartar}>
          Descartar
        </Button>
        <Button size="sm" loading={salvando} onClick={onSalvar}>
          {rotulo}
        </Button>
      </span>
    </div>
  )
}
