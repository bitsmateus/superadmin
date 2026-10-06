import * as React from 'react'
import { Eye, EyeOff, Loader2, Monitor, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { JornadaPortal } from '@/components/gestaoClientes/JornadaPortal'
import { gestaoClientes, type GcJornadaPortal } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/**
 * "Ver como o cliente vê" — o bloco "Nossa jornada" exatamente como o portal o entregaria.
 *
 * O bloco vem do SERVIDOR, montado pelo mesmo caminho da rota pública (só ignorando o interruptor
 * do portal). Montar a prévia aqui, no navegador, a partir dos dados da tela, poderia mostrar mais
 * que o portal — ou menos — e a prévia perderia a razão de existir: conferir antes de ligar.
 *
 * Mostra o que está SALVO. Alteração pendente não aparece, e quem abre a janela é avisado.
 */
export function PreviaPortal({
  aberto,
  clienteId,
  onFechar,
}: {
  aberto: boolean
  clienteId: string
  onFechar: () => void
}) {
  const [carregando, setCarregando] = React.useState(false)
  const [dados, setDados] = React.useState<{ ligado: boolean; jornada: GcJornadaPortal | null } | null>(null)
  const [celular, setCelular] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) return
    let cancelado = false
    setCarregando(true)
    setDados(null)
    gestaoClientes
      .previaPortal(clienteId)
      .then((d) => {
        if (!cancelado) setDados(d)
      })
      .catch((err: Error) => toast.error('Falha ao montar a prévia: ' + err.message))
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [aberto, clienteId])

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="2xl"
      title="Como o cliente vê"
      description='A prévia do bloco "Nossa jornada" do portal, com o que está salvo.'
    >
      {carregando || !dados ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando a prévia…
        </div>
      ) : (
        <div className="space-y-3">
          <div
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              dados.ligado ? 'border-success/30 bg-success/[0.05]' : 'border-warning/30 bg-warning/[0.06]',
            )}
          >
            {dados.ligado ? (
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            ) : (
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            )}
            <p className="text-foreground/85">
              {dados.ligado ? (
                <>
                  O bloco está <strong>ligado</strong> no portal deste cliente: é isto que ele vê agora.
                </>
              ) : (
                <>
                  O bloco está <strong>desligado</strong>: o cliente <strong>não vê nada disso</strong> até você
                  ligar "Mostrar Nossa jornada no portal".
                </>
              )}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-foreground/50">
              Não aparecem pro cliente: estratégia, premissas e os textos que você não marcou.
            </p>
            <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Tamanho da tela">
              {(
                [
                  { valor: false, icone: Monitor, rotulo: 'Computador' },
                  { valor: true, icone: Smartphone, rotulo: 'Celular' },
                ] as const
              ).map((o) => (
                <button
                  key={o.rotulo}
                  type="button"
                  onClick={() => setCelular(o.valor)}
                  aria-pressed={celular === o.valor}
                  title={o.rotulo}
                  className={cn(
                    'flex h-8 items-center gap-1.5 px-2.5 text-xs transition-colors',
                    celular === o.valor ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/50 hover:text-foreground/80',
                  )}
                >
                  <o.icone className="h-3.5 w-3.5" />
                  {o.rotulo}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-line bg-elevate/[0.02] p-3">
            {dados.jornada ? (
              <div className={cn('mx-auto transition-[max-width]', celular ? 'max-w-sm' : 'max-w-full')}>
                <JornadaPortal jornada={dados.jornada} />
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-foreground/50">
                Ainda não há o que mostrar: salve o planejamento (ponto A e metas) primeiro.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
