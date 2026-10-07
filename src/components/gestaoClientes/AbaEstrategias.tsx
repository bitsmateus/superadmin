import * as React from 'react'
import { Check, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { gestaoClientes, type GcEstrategia } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const STATUS: { valor: GcEstrategia['status']; label: string }[] = [
  { valor: 'planejada', label: 'Planejada' },
  { valor: 'em_execucao', label: 'Em execução' },
  { valor: 'concluida', label: 'Concluída' },
  { valor: 'pausada', label: 'Pausada' },
]

const TOM: Record<GcEstrategia['status'], 'info' | 'success' | 'warning' | 'neutral'> = {
  planejada: 'neutral',
  em_execucao: 'info',
  concluida: 'success',
  pausada: 'warning',
}

/**
 * Estratégias com PASSOS (checklist) que já tinham sido aplicadas neste cliente.
 *
 * A estratégia de hoje agora se escreve no Planejamento (passo 3, "Como vamos chegar lá?"), então esta aba
 * só aparece se o cliente ainda tem estratégias antigas com passos — pra não perder o checklist, que segue
 * alimentando as Pendências.
 */
export function AbaEstrategias({
  estrategias,
  onMudou,
}: {
  estrategias: GcEstrategia[]
  clienteId?: string
  estrategiaUsada?: string
  onMudou: () => Promise<void> | void
}) {
  const [novoPasso, setNovoPasso] = React.useState<Record<string, string>>({})

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs text-foreground/55">
        A estratégia de hoje fica no <strong>Planejamento</strong> (passo 3). Aqui ficam só as estratégias com passos que já estavam aplicadas.
      </p>

      {estrategias.length === 0 ? null : (
        estrategias.map((e) => {
          const feitos = e.itens.filter((i) => i.concluido).length
          return (
            <section key={e.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-medium text-foreground">{e.nome}</h3>
                  {e.objetivo && (
                    <p className="mt-0.5 text-sm text-foreground/60">{e.objetivo}</p>
                  )}
                  <p className="mt-1 text-xs text-foreground/45">
                    {e.itens.length > 0 ? `${feitos} de ${e.itens.length} passos` : 'sem passos'}
                    {e.responsavel_nome ? ` · ${e.responsavel_nome}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={TOM[e.status]}>
                    {STATUS.find((s) => s.valor === e.status)?.label ?? e.status}
                  </Badge>
                  <Select
                    options={STATUS.map((s) => ({ value: s.valor, label: s.label }))}
                    value={e.status}
                    onChange={(ev) =>
                      void agir(() =>
                        gestaoClientes.atualizarEstrategia(e.id, {
                          status: ev.target.value as GcEstrategia['status'],
                        }),
                      )
                    }
                    className="w-36"
                  />
                  <button
                    type="button"
                    onClick={() => void agir(() => gestaoClientes.excluirEstrategia(e.id))}
                    className="text-foreground/25 hover:text-danger"
                    aria-label="Excluir estratégia"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                {e.itens.map((item) => (
                  <li key={item.id} className="group flex items-start gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        void agir(() =>
                          gestaoClientes.atualizarItem(item.id, { concluido: !item.concluido }),
                        )
                      }
                      className={cn(
                        'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                        item.concluido
                          ? 'border-success bg-success text-white'
                          : 'border-line hover:border-accent',
                      )}
                      aria-label={item.concluido ? 'Desmarcar passo' : 'Marcar passo'}
                    >
                      {item.concluido && <Check className="h-3 w-3" />}
                    </button>
                    <span
                      className={cn(
                        'min-w-0 flex-1 text-sm',
                        item.concluido ? 'text-foreground/45 line-through' : 'text-foreground/85',
                      )}
                    >
                      {item.titulo}
                    </span>
                    <button
                      type="button"
                      onClick={() => void agir(() => gestaoClientes.excluirItem(item.id))}
                      className="shrink-0 text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      aria-label="Excluir passo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              <form
                className="mt-3 flex items-center gap-2"
                onSubmit={(ev) => {
                  ev.preventDefault()
                  const titulo = (novoPasso[e.id] ?? '').trim()
                  if (!titulo) return
                  void agir(async () => {
                    await gestaoClientes.criarItem({ gc_cliente_estrategia_id: e.id, titulo })
                    setNovoPasso((n) => ({ ...n, [e.id]: '' }))
                  })
                }}
              >
                <Input
                  value={novoPasso[e.id] ?? ''}
                  onChange={(ev) => setNovoPasso((n) => ({ ...n, [e.id]: ev.target.value }))}
                  placeholder="Adicionar passo"
                  containerClassName="flex-1"
                />
                <Button type="submit" variant="secondary" size="sm">
                  Adicionar
                </Button>
              </form>
            </section>
          )
        })
      )}
    </div>
  )
}
