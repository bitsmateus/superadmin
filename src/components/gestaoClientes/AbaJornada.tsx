import * as React from 'react'
import { AlertTriangle, Check, ChevronDown, Circle, CircleDot, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { DataMiuda } from '@/components/gestaoClientes/CampoData'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
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

/** Hoje em Brasília, só a data — pra saber o que está atrasado sem depender do fuso do navegador. */
function hojeBr(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function estaAtrasado(prazo: string | null | undefined, concluido: boolean): boolean {
  if (!prazo || concluido) return false
  return String(prazo).slice(0, 10) < hojeBr()
}

/** Ícone do estado da etapa, no lugar de um número de passo: diz o estado sem precisar de legenda. */
function IconeEtapa({ status, atrasada }: { status: GcEtapaJornada['status']; atrasada: boolean }) {
  if (atrasada && status !== 'concluida') {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
        <AlertTriangle className="h-4 w-4" />
      </span>
    )
  }
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
 * Jornada do cliente — as etapas da implantação, cada uma com seu checklist, dono e prazo.
 *
 * Marcar os itens é o que move a jornada: quando o último item da etapa é marcado, ela fecha e a
 * próxima abre sozinha (quem decide isso é o servidor, ver recalcularEtapa). Por isso toda ação
 * aqui recarrega o cliente inteiro em vez de mexer só na linha clicada — o estado que vale é o
 * que o servidor devolveu.
 *
 * O prazo não é enfeite: é dele que sai o sinal "pendência atrasada" do semáforo. Item vencido
 * aparece em vermelho aqui e puxa o cliente pra baixo na lista.
 */
export function AbaJornada({
  jornada,
  onMudou,
}: {
  jornada: GcEtapaJornada[]
  onMudou: () => Promise<void> | void
}) {
  const { data: perfis } = useTeamProfiles()
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

  const opcoesResponsavel = [
    { value: '', label: '— sem dono —' },
    ...(perfis ?? [])
      .map((p) => ({ value: p.id, label: (p.name && p.name.trim()) || p.email }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]

  const totalAtrasados = jornada.reduce(
    (soma, e) => soma + e.itens.filter((i) => estaAtrasado(i.prazo, i.concluido)).length,
    0,
  )

  return (
    <div className="space-y-2">
      {totalAtrasados > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-danger/25 bg-danger/[0.04] px-3 py-2 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" />
          {totalAtrasados} item(ns) com prazo vencido — é o que está pesando no semáforo desse cliente.
        </p>
      )}

      {jornada.map((etapa) => {
        const feitos = etapa.itens.filter((i) => i.concluido).length
        const aberta = estaAberta(etapa)
        const atrasadosNaEtapa = etapa.itens.filter((i) => estaAtrasado(i.prazo, i.concluido)).length
        const etapaAtrasada = estaAtrasado(etapa.prazo, etapa.status === 'concluida') || atrasadosNaEtapa > 0

        return (
          <div
            key={etapa.id}
            className={cn(
              'overflow-hidden rounded-xl border',
              etapaAtrasada && etapa.status !== 'concluida' ? 'border-danger/30' : 'border-line',
            )}
          >
            <button
              type="button"
              onClick={() => setAbertas((a) => ({ ...a, [etapa.id]: !aberta }))}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevate/[0.02]"
            >
              <IconeEtapa status={etapa.status} atrasada={etapaAtrasada} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{etapa.nome}</span>
                <span className="block text-xs text-foreground/50">
                  {etapa.itens.length > 0 ? `${feitos} de ${etapa.itens.length} itens` : 'sem checklist'}
                  {etapa.responsavel_nome ? ` · ${etapa.responsavel_nome}` : ''}
                  {etapa.prazo && etapa.status !== 'concluida'
                    ? ` · prazo ${String(etapa.prazo).slice(0, 10).split('-').reverse().join('/')}`
                    : ''}
                  {etapa.concluida_em
                    ? ` · concluída em ${new Date(etapa.concluida_em).toLocaleDateString('pt-BR')}`
                    : ''}
                </span>
              </span>
              {atrasadosNaEtapa > 0 && (
                <Badge tone="danger">{atrasadosNaEtapa} atrasado(s)</Badge>
              )}
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
                <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-line pb-3">
                  <Select
                    options={opcoesResponsavel}
                    value={etapa.responsavel_id ?? ''}
                    onChange={(e) =>
                      void comErro(`dono-${etapa.id}`, () =>
                        gestaoClientes.atualizarEtapa(etapa.id, {
                          responsavel_id: e.target.value || null,
                        }),
                      )
                    }
                    className="w-48"
                  />
                  <span className="flex items-center gap-1.5 text-xs text-foreground/50">
                    prazo da etapa
                    <DataMiuda
                      value={etapa.prazo ? String(etapa.prazo).slice(0, 10) : null}
                      atrasado={estaAtrasado(etapa.prazo, etapa.status === 'concluida')}
                      onChange={(v) =>
                        void comErro(`prazo-${etapa.id}`, () =>
                          gestaoClientes.atualizarEtapa(etapa.id, { prazo: v }),
                        )
                      }
                    />
                  </span>
                </div>

                <ul className="space-y-1.5">
                  {etapa.itens.map((item) => {
                    const atrasado = estaAtrasado(item.prazo, item.concluido)
                    return (
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
                              : atrasado
                                ? 'border-danger hover:border-danger'
                                : 'border-line hover:border-accent',
                          )}
                          aria-label={item.concluido ? 'Desmarcar item' : 'Marcar item'}
                        >
                          {item.concluido && <Check className="h-3 w-3" />}
                        </button>
                        <span
                          className={cn(
                            'min-w-0 flex-1 text-sm',
                            item.concluido
                              ? 'text-foreground/45 line-through'
                              : atrasado
                                ? 'text-danger'
                                : 'text-foreground/85',
                          )}
                        >
                          {item.titulo}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 transition-opacity',
                            item.prazo ? '' : 'opacity-0 group-hover:opacity-100',
                          )}
                        >
                          <DataMiuda
                            value={item.prazo ? String(item.prazo).slice(0, 10) : null}
                            atrasado={atrasado}
                            onChange={(v) =>
                              void comErro(`prazo-item-${item.id}`, () =>
                                gestaoClientes.atualizarItem(item.id, { prazo: v }),
                              )
                            }
                          />
                        </span>
                        <button
                          type="button"
                          onClick={() => void comErro(item.id, () => gestaoClientes.excluirItem(item.id))}
                          className="shrink-0 text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                          aria-label="Excluir item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    )
                  })}
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

                <div className="mt-3 border-t border-line pt-3">
                  {etapa.status !== 'concluida' ? (
                    <>
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
                    </>
                  ) : (
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
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
