import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Lightbulb, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  TIPOS_SERVICO, gestaoClientes, type GcClienteLista, type GcModelos,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/**
 * CLIENTES NX DIGITAL → Estratégias.
 *
 * O catálogo das estratégias prontas — o que cada uma faz e em que ordem. Aplicar uma estratégia é
 * feito DENTRO do cliente (aba Estratégias dele), porque é lá que ela ganha dono, prazo e
 * checklist; aqui é a referência de "o que a gente sabe fazer".
 */
export function EstrategiasNxPage() {
  const navegar = useNavigate()
  const [modelos, setModelos] = React.useState<GcModelos['estrategias']>([])
  const [clientes, setClientes] = React.useState<GcClienteLista[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [aberta, setAberta] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    Promise.all([gestaoClientes.modelos(), gestaoClientes.listar()])
      .then(([m, c]) => {
        setModelos(m.estrategias)
        setClientes(c)
      })
      .catch((err: Error) => toast.error('Falha ao carregar: ' + err.message))
      .finally(() => setCarregando(false))
  }, [])

  return (
    <>
      <TopBar
        title="Estratégias"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Estratégias' },
        ]}
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : modelos.length === 0 ? (
          <EmptyState
            icon={<Lightbulb className="h-6 w-6" />}
            title="Nenhuma estratégia cadastrada"
            description="As estratégias prontas nascem com o módulo; se a lista está vazia, elas foram removidas do banco."
          />
        ) : (
          <>
            <p className="text-sm text-foreground/60">
              Aplicar uma estratégia é feito dentro do cliente, na aba Estratégias dele — é lá que
              ela ganha dono e checklist. Aqui fica a referência.
            </p>

            <div className="space-y-2">
              {modelos.map((m) => {
                const abertaAgora = aberta[m.id] ?? false
                const rotuloServico = m.servico_tipo
                  ? TIPOS_SERVICO.find((t) => t.valor === m.servico_tipo)?.label ?? m.servico_tipo
                  : null
                return (
                  <div key={m.id} className="overflow-hidden rounded-xl border border-line">
                    <button
                      type="button"
                      onClick={() => setAberta((a) => ({ ...a, [m.id]: !abertaAgora }))}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevate/[0.02]"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
                        <Lightbulb className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{m.nome}</span>
                        <span className="block truncate text-xs text-foreground/50">
                          {m.descricao || 'sem descrição'} · {m.passos.length} passos
                        </span>
                      </span>
                      {rotuloServico && <Badge tone="info">{rotuloServico}</Badge>}
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-foreground/40 transition-transform',
                          abertaAgora ? '' : '-rotate-90',
                        )}
                      />
                    </button>
                    {abertaAgora && (
                      <ol className="list-decimal space-y-1 border-t border-line bg-elevate/[0.015] py-3 pl-10 pr-4">
                        {m.passos.map((p) => (
                          <li key={p.id} className="text-sm text-foreground/80">
                            {p.titulo}
                          </li>
                        ))}
                        {m.passos.length === 0 && (
                          <li className="list-none text-sm text-foreground/45">
                            Nenhum passo cadastrado.
                          </li>
                        )}
                      </ol>
                    )}
                  </div>
                )
              })}
            </div>

            {clientes.length > 0 && (
              <section className="rounded-xl border border-line p-4">
                <h2 className="mb-2 text-sm font-semibold text-foreground">Aplicar em qual cliente?</h2>
                <div className="flex flex-wrap gap-2">
                  {clientes
                    .filter((c) => c.status === 'ativo')
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => navegar(`/clientesnxdigital/clientes/${c.id}`)}
                        className="rounded-lg border border-line px-3 py-1.5 text-sm text-foreground/80 transition-colors hover:border-accent/40 hover:text-foreground"
                      >
                        {c.nome_empresa}
                      </button>
                    ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
