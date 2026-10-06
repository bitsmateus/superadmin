import * as React from 'react'
import { Check, Lightbulb, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  gestaoClientes, type GcEstrategia, type GcModelos,
} from '@/services/gestaoClientes'
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
 * Estratégias do cliente: o que está sendo feito pra entregar resultado, cada uma com seus passos.
 *
 * Aplicar uma estratégia pronta copia o nome e os passos dela (os passos viram checklist). É cópia,
 * não referência — ajustar o modelo depois não reescreve o que já está rodando num cliente.
 */
export function AbaEstrategias({
  estrategias,
  clienteId,
  onMudou,
}: {
  estrategias: GcEstrategia[]
  clienteId: string
  onMudou: () => Promise<void> | void
}) {
  const [modelos, setModelos] = React.useState<GcModelos['estrategias']>([])
  const [modeloEscolhido, setModeloEscolhido] = React.useState('')
  const [nomeLivre, setNomeLivre] = React.useState('')
  const [aplicando, setAplicando] = React.useState(false)
  const [novoPasso, setNovoPasso] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    gestaoClientes
      .modelos()
      .then((m) => setModelos(m.estrategias))
      .catch(() => {
        // O seletor de prontas fica vazio, mas dá pra criar estratégia em branco — não vale travar
        // a aba por causa disso.
      })
  }, [])

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  const aplicar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modeloEscolhido && !nomeLivre.trim()) {
      toast.error('Escolha uma estratégia pronta ou dê um nome pra nova')
      return
    }
    setAplicando(true)
    try {
      await gestaoClientes.criarEstrategia(clienteId, {
        estrategia_modelo_id: modeloEscolhido || undefined,
        nome: nomeLivre.trim() || undefined,
      })
      setModeloEscolhido('')
      setNomeLivre('')
      await onMudou()
    } catch (err) {
      toast.error('Falha ao aplicar: ' + (err as Error).message)
    } finally {
      setAplicando(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={aplicar} className="grid items-end gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
        <Select
          id="gc-aplicar-estrategia"
          label="Estratégia pronta"
          options={[
            { value: '', label: '— Nenhuma (criar em branco) —' },
            ...modelos.map((m) => ({ value: m.id, label: m.nome })),
          ]}
          value={modeloEscolhido}
          onChange={(e) => setModeloEscolhido(e.target.value)}
        />
        <Input
          label="Ou nome da estratégia nova"
          value={nomeLivre}
          onChange={(e) => setNomeLivre(e.target.value)}
          placeholder="Ex.: Campanha de inverno"
        />
        <Button type="submit" loading={aplicando} leftIcon={<Plus className="h-4 w-4" />}>
          Aplicar
        </Button>
      </form>

      {estrategias.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-6 w-6" />}
          title="Nenhuma estratégia aplicada"
          description="Escolha uma pronta acima — os passos dela já viram checklist."
          action={
            <Button
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => document.getElementById('gc-aplicar-estrategia')?.focus()}
            >
              Aplicar estratégia
            </Button>
          }
        />
      ) : (
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
