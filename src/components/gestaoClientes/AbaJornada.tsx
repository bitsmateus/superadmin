import * as React from 'react'
import { Check, ChevronDown, Circle, CircleDot, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { gestaoClientes, type GcEtapaJornada } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const TOM: Record<GcEtapaJornada['status'], 'success' | 'info' | 'neutral'> = {
  concluida: 'success',
  em_andamento: 'info',
  pendente: 'neutral',
}
const ROTULO: Record<GcEtapaJornada['status'], string> = {
  concluida: 'Concluída',
  em_andamento: 'Em andamento',
  pendente: 'Pendente',
}

/** Ícone do estado da etapa, no lugar de um número de passo: diz o estado sem precisar de legenda. */
function IconeEtapa({ status }: { status: GcEtapaJornada['status'] }) {
  if (status === 'concluida') {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success/15 text-success">
        <Check className="h-4 w-4" />
      </span>
    )
  }
  if (status === 'em_andamento') {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        <CircleDot className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.06] text-foreground/40">
      <Circle className="h-3.5 w-3.5" />
    </span>
  )
}

/**
 * Jornada do cliente — as etapas da implantação, cada uma com seu checklist.
 *
 * Marcar os itens é o que move a jornada: quando o último item da etapa é marcado, ela fecha e a
 * próxima abre sozinha (quem decide isso é o servidor, ver recalcularEtapa). Por isso toda ação
 * aqui recarrega o cliente inteiro em vez de mexer só na linha clicada — o estado que vale é o
 * que o servidor devolveu.
 */
export function AbaJornada({
  jornada,
  onMudou,
}: {
  jornada: GcEtapaJornada[]
  onMudou: () => Promise<void> | void
}) {
  // A etapa em andamento nasce aberta; as outras, fechadas. Jornada de 9 etapas aberta inteira é
  // uma parede de texto, e o que interessa é onde o cliente está agora.
  const [abertas, setAbertas] = React.useState<Record<string, boolean>>({})
  const [novoItem, setNovoItem] = React.useState<Record<string, string>>({})
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  const estaAberta = (etapa: GcEtapaJornada) => abertas[etapa.id] ?? etapa.status === 'em_andamento'

  const comErro = async (chave: string, fn: () => Promise<unknown>) => {
    setOcupado(chave)
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  return (
    <div className="space-y-2">
      {jornada.map((etapa) => {
        const feitos = etapa.itens.filter((i) => i.concluido).length
        const aberta = estaAberta(etapa)
        return (
          <div key={etapa.id} className="overflow-hidden rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setAbertas((a) => ({ ...a, [etapa.id]: !aberta }))}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevate/[0.02]"
            >
              <IconeEtapa status={etapa.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{etapa.nome}</span>
                <span className="block text-xs text-foreground/50">
                  {etapa.itens.length > 0
                    ? `${feitos} de ${etapa.itens.length} itens`
                    : 'sem checklist'}
                  {etapa.concluida_em
                    ? ` · concluída em ${new Date(etapa.concluida_em).toLocaleDateString('pt-BR')}`
                    : ''}
                </span>
              </span>
              <Badge tone={TOM[etapa.status]}>{ROTULO[etapa.status]}</Badge>
              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-foreground/40 transition-transform',
                  aberta ? '' : '-rotate-90',
                )}
              />
            </button>

            {aberta && (
              <div className="border-t border-line bg-elevate/[0.015] px-4 py-3">
                <ul className="space-y-1.5">
                  {etapa.itens.map((item) => (
                    <li key={item.id} className="group flex items-start gap-2.5">
                      <button
                        type="button"
                        disabled={ocupado === item.id}
                        onClick={() =>
                          void comErro(item.id, () =>
                            gestaoClientes.atualizarItem(item.id, { concluido: !item.concluido }),
                          )
                        }
                        className={cn(
                          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
                          item.concluido
                            ? 'border-success bg-success text-white'
                            : 'border-line hover:border-accent',
                        )}
                        aria-label={item.concluido ? 'Desmarcar item' : 'Marcar item'}
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
                        onClick={() =>
                          void comErro(item.id, () => gestaoClientes.excluirItem(item.id))
                        }
                        className="shrink-0 text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                        aria-label="Excluir item"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>

                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const titulo = (novoItem[etapa.id] ?? '').trim()
                    if (!titulo) return
                    void comErro(`novo-${etapa.id}`, async () => {
                      await gestaoClientes.criarItem({ gc_cliente_jornada_id: etapa.id, titulo })
                      setNovoItem((n) => ({ ...n, [etapa.id]: '' }))
                    })
                  }}
                >
                  <Input
                    value={novoItem[etapa.id] ?? ''}
                    onChange={(e) => setNovoItem((n) => ({ ...n, [etapa.id]: e.target.value }))}
                    placeholder="Adicionar item ao checklist desta etapa"
                    containerClassName="flex-1"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    loading={ocupado === `novo-${etapa.id}`}
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                  >
                    Adicionar
                  </Button>
                </form>

                {etapa.status !== 'concluida' && (
                  <div className="mt-3 border-t border-line pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={ocupado === `etapa-${etapa.id}`}
                      onClick={() =>
                        void comErro(`etapa-${etapa.id}`, () =>
                          gestaoClientes.atualizarEtapa(etapa.id, { status: 'concluida' }),
                        )
                      }
                      leftIcon={<Check className="h-3.5 w-3.5" />}
                    >
                      Concluir etapa
                    </Button>
                    <span className="ml-2 text-xs text-foreground/45">
                      marca os itens que faltam e abre a próxima etapa
                    </span>
                  </div>
                )}
                {etapa.status === 'concluida' && (
                  <div className="mt-3 border-t border-line pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={ocupado === `etapa-${etapa.id}`}
                      onClick={() =>
                        void comErro(`etapa-${etapa.id}`, () =>
                          gestaoClientes.atualizarEtapa(etapa.id, { status: 'em_andamento' }),
                        )
                      }
                    >
                      Reabrir etapa
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
