import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, Search, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { AvatarCliente } from '@/components/gestaoClientes/AvatarCliente'
import {
  BarraDoMes, CaixaDaEtapa, EtapasDoMes, etapasFeitas, proximaEtapa, resumoDasArtes, useSalvarEtapa,
} from '@/components/gestaoClientes/ChecklistSocial'
import { ETAPAS_SOCIAL, gestaoClientes, type GcChecklistSocialCliente } from '@/services/gestaoClientes'
import { mesDeHoje, nomeDoMes, somarMes } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'

const CHAVE_MES = 'nx-demandas-social-mes'
const lerMes = () => {
  try { return sessionStorage.getItem(CHAVE_MES) || mesDeHoje() } catch { return mesDeHoje() }
}

type Filtro = 'todos' | 'pendentes' | 'fechados'

/**
 * Demandas social: por mês, o checklist de cada cliente — reunião, copy, criativos, aprovação e agendamento.
 * Da copy em diante as etapas se marcam sozinhas conforme as artes andam no Social media.
 */
export function DemandasSocialPage() {
  const navegar = useNavigate()
  const [mes, setMesState] = React.useState(lerMes)
  const [lista, setLista] = React.useState<GcChecklistSocialCliente[] | null>(null)
  const [busca, setBusca] = React.useState('')
  const [filtro, setFiltro] = React.useState<Filtro>('todos')
  const [aberto, setAberto] = React.useState<string | null>(null)

  const setMes = (m: string) => {
    setMesState(m)
    try { sessionStorage.setItem(CHAVE_MES, m) } catch { /* sem storage */ }
  }

  React.useEffect(() => {
    let vivo = true
    setLista(null)
    gestaoClientes
      .checklistSocial(mes)
      .then((l) => { if (vivo) setLista(l) })
      .catch((err: Error) => {
        toast.error('Falha ao carregar: ' + err.message)
        if (vivo) setLista([])
      })
    return () => { vivo = false }
  }, [mes])

  const atualizarLinha = (l: GcChecklistSocialCliente) =>
    setLista((atual) => (atual ?? []).map((x) => (x.id === l.id ? l : x)))
  const { salvar, salvando } = useSalvarEtapa(mes, atualizarLinha)

  const todos = lista ?? []
  const visiveis = todos
    .filter((c) => c.nome_empresa.toLowerCase().includes(busca.trim().toLowerCase()))
    .filter((c) => (filtro === 'todos' ? true : filtro === 'fechados' ? etapasFeitas(c) === 5 : etapasFeitas(c) < 5))

  const abrirSocial = (clienteId: string) => {
    // O Social media do cliente abre no mesmo mês.
    try { sessionStorage.setItem('nx-social-mes', mes) } catch { /* sem storage */ }
    navegar(`/clientesnxdigital/socialmedia/${clienteId}`)
  }

  const colunas = 'md:grid-cols-[minmax(0,2fr)_repeat(5,72px)_minmax(110px,1fr)]'

  return (
    <>
      <TopBar
        compacto
        title="Demandas social"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Demandas social' },
        ]}
      />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        {/* ------------------------------------------------ mês, busca e filtro */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <button type="button" onClick={() => setMes(somarMes(mes, -1))} className="p-2 text-foreground/60 hover:text-foreground" aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[140px] text-center text-sm font-semibold text-foreground">{nomeDoMes(mes)}</span>
            <button type="button" onClick={() => setMes(somarMes(mes, 1))} className="p-2 text-foreground/60 hover:text-foreground" aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {mes !== mesDeHoje() && (
            <button type="button" onClick={() => setMes(mesDeHoje())} className="text-xs text-accent hover:underline">
              Voltar pro mês atual
            </button>
          )}
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar cliente…"
              className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs">
            {([['todos', 'Todos'], ['pendentes', 'Com pendência'], ['fechados', 'Mês fechado']] as const).map(([v, r]) => (
              <button
                key={v}
                type="button"
                onClick={() => setFiltro(v)}
                className={cn('rounded-md px-2.5 py-1.5', filtro === v ? 'bg-accent/10 font-medium text-accent' : 'text-foreground/60 hover:text-foreground')}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* ------------------------------------------------ quantos clientes em cada etapa */}
        {lista && todos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {ETAPAS_SOCIAL.map((def, i) => {
              const feitos = todos.filter((c) => c.etapas[def.valor].feito).length
              return (
                <div key={def.valor} className="rounded-xl border border-line bg-surface px-3 py-2.5">
                  <p className="truncate text-[11px] font-medium uppercase tracking-wide text-foreground/45">{i + 1}. {def.label}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
                    {feitos}<span className="text-sm font-normal text-foreground/40">/{todos.length}</span>
                  </p>
                  <p className="truncate text-[11px] text-foreground/45" title={def.ajuda}>{def.ajuda}</p>
                </div>
              )
            })}
          </div>
        )}

        {lista === null ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando clientes…
          </div>
        ) : visiveis.length === 0 ? (
          <p className="py-12 text-center text-sm text-foreground/50">Nenhum cliente encontrado.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <div className={cn('hidden items-center gap-3 border-b border-line bg-elevate/[0.03] px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-foreground/45 md:grid', colunas)}>
              <span>Cliente</span>
              {ETAPAS_SOCIAL.map((def) => (
                <span key={def.valor} className="text-center" title={def.ajuda}>{def.label}</span>
              ))}
              <span>Progresso</span>
            </div>
            <ul className="divide-y divide-line">
              {visiveis.map((c) => {
                const prox = proximaEtapa(c)
                const estaAberto = aberto === c.id
                return (
                  <li key={c.id}>
                    <div className={cn('grid grid-cols-5 items-center gap-x-3 gap-y-2 px-4 py-3', colunas)}>
                      <button
                        type="button"
                        onClick={() => setAberto(estaAberto ? null : c.id)}
                        className="col-span-5 flex min-w-0 items-center gap-3 text-left md:col-span-1"
                      >
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', estaAberto && 'rotate-180')} />
                        <AvatarCliente nome={c.nome_empresa} logoUrl={c.logo_url} className="h-9 w-9 rounded-xl text-xs" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-foreground">{c.nome_empresa}</span>
                          <span className="block truncate text-xs text-foreground/50">
                            {prox ? `Próxima: ${prox.label}` : 'Mês fechado'}
                            {c.gestor_nome ? ` · Gestor: ${c.gestor_nome}` : ''}
                          </span>
                        </span>
                      </button>
                      {ETAPAS_SOCIAL.map((def) => (
                        <span key={def.valor} className="flex flex-col items-center gap-0.5">
                          <CaixaDaEtapa
                            linha={c}
                            etapa={def.valor}
                            salvando={salvando === `${c.id}:${def.valor}`}
                            onToggle={() => void salvar(c.id, def.valor, { feito: !c.etapas[def.valor].manual })}
                          />
                          <span className="text-[10px] text-foreground/45 md:hidden">{def.label}</span>
                        </span>
                      ))}
                      <div className="col-span-5 md:col-span-1"><BarraDoMes linha={c} /></div>
                    </div>
                    {estaAberto && (
                      <div className="space-y-3 border-t border-line bg-elevate/[0.02] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-foreground/60">
                            <Sparkles className="mr-1 inline h-3 w-3 text-accent" />
                            {resumoDasArtes(c)}
                          </p>
                          <button
                            type="button"
                            onClick={() => abrirSocial(c.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-foreground/70 hover:border-accent hover:text-accent"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Abrir Social media de {nomeDoMes(mes)}
                          </button>
                        </div>
                        <EtapasDoMes linha={c} mes={mes} onSalvo={atualizarLinha} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-foreground/45">
          <Sparkles className="h-3 w-3 text-accent" />
          Copy, criativos, aprovação e agendamento se marcam sozinhos conforme as artes do mês andam no Social media.
          A reunião é marcada à mão e vai pro histórico do cliente.
        </p>
      </div>
    </>
  )
}
