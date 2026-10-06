import * as React from 'react'
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { gestaoClientes, type GcPendencia } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

function prazoBr(prazo: string | null): string {
  return prazo ? String(prazo).slice(0, 10).split('-').reverse().join('/') : 'sem prazo'
}

const CHAVE_AGRUPAR = 'gc:pendencias:agrupar'

function lerAgrupar(): boolean {
  try {
    // Agrupado por cliente é o padrão: é como se trabalha ("o que falta pro Shopbike?").
    return window.localStorage.getItem(CHAVE_AGRUPAR) !== '0'
  } catch {
    return true
  }
}

const ROTULO_ORIGEM: Record<GcPendencia['origem'], string> = {
  jornada: 'etapa',
  estrategia: 'estratégia',
  rotina: 'rotina',
}

/** Um seletor simples — o <Select> do projeto traz rótulo e margem demais pra uma barra de filtros. */
function Filtro({
  valor,
  onChange,
  opcoes,
  rotulo,
}: {
  valor: string
  onChange: (v: string) => void
  opcoes: { value: string; label: string }[]
  rotulo: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-foreground/50">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border border-line bg-transparent px-2 text-sm text-foreground outline-none focus:border-accent/60"
      >
        {opcoes.map((o) => (
          <option key={o.value} value={o.value} className="bg-surface">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Pendências da carteira: os itens de checklist ABERTOS de todos os clientes, numa lista só.
 *
 * É o "o que está pendente?" sem abrir cliente por cliente. Dá pra filtrar por responsável, por
 * cliente e por atrasados, agrupar por cliente e concluir direto na linha — o servidor recalcula a
 * etapa/estratégia do item, como na tela do cliente.
 *
 * O responsável mostrado cai em cascata (item → etapa/estratégia → cliente): quase ninguém atribui
 * item por item, e filtrar só pelo campo do item deixaria quase tudo "sem responsável".
 */
export function PainelPendencias({ onAbrirCliente }: { onAbrirCliente: (id: string) => void }) {
  const [itens, setItens] = React.useState<GcPendencia[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [responsavel, setResponsavel] = React.useState('')
  const [cliente, setCliente] = React.useState('')
  const [soAtrasados, setSoAtrasados] = React.useState(false)
  const [agrupar, setAgrupar] = React.useState(lerAgrupar)
  const [fechados, setFechados] = React.useState<Set<string>>(new Set())
  const [concluindo, setConcluindo] = React.useState<Set<string>>(new Set())

  const carregar = React.useCallback(async () => {
    try {
      setItens(await gestaoClientes.pendencias())
    } catch (err) {
      toast.error('Falha ao carregar as pendências: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const alternarAgrupar = (valor: boolean) => {
    setAgrupar(valor)
    try {
      window.localStorage.setItem(CHAVE_AGRUPAR, valor ? '1' : '0')
    } catch {
      /* sem armazenamento: vale até recarregar */
    }
  }

  const responsaveis = React.useMemo(() => {
    const mapa = new Map<string, string>()
    for (const i of itens) if (i.responsavel_id) mapa.set(i.responsavel_id, i.responsavel_nome ?? '—')
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [itens])

  const clientes = React.useMemo(() => {
    const mapa = new Map<string, string>()
    for (const i of itens) mapa.set(i.cliente_id, i.cliente_nome)
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [itens])

  const visiveis = itens.filter((i) => {
    if (responsavel === '__sem') return !i.responsavel_id
    if (responsavel && i.responsavel_id !== responsavel) return false
    if (cliente && i.cliente_id !== cliente) return false
    if (soAtrasados && !i.atrasado) return false
    return true
  })
  const atrasados = itens.filter((i) => i.atrasado).length

  // Grupos por cliente: quem tem mais atrasadas vem primeiro — é o que pede ação —, depois por nome.
  const grupos = React.useMemo(() => {
    const mapa = new Map<string, { id: string; nome: string; itens: GcPendencia[] }>()
    for (const i of visiveis) {
      const g = mapa.get(i.cliente_id) ?? { id: i.cliente_id, nome: i.cliente_nome, itens: [] }
      g.itens.push(i)
      mapa.set(i.cliente_id, g)
    }
    return [...mapa.values()].sort((a, b) => {
      const atrasoA = a.itens.filter((x) => x.atrasado).length
      const atrasoB = b.itens.filter((x) => x.atrasado).length
      return atrasoB - atrasoA || a.nome.localeCompare(b.nome)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, responsavel, cliente, soAtrasados])

  const concluir = async (item: GcPendencia) => {
    // Sai da lista na hora; se o servidor recusar, volta. Esperar a ida e volta pra cada clique
    // faria concluir 10 itens parecer um trabalho de 10 esperas.
    setConcluindo((s) => new Set(s).add(item.id))
    setItens((atual) => atual.filter((x) => x.id !== item.id))
    try {
      await gestaoClientes.atualizarItem(item.id, { concluido: true })
    } catch (err) {
      toast.error('Falha ao concluir: ' + (err as Error).message)
      await carregar()
    } finally {
      setConcluindo((s) => {
        const novo = new Set(s)
        novo.delete(item.id)
        return novo
      })
    }
  }

  const linha = (i: GcPendencia, mostrarCliente: boolean) => (
    <li key={i.id} className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
      <button
        type="button"
        disabled={concluindo.has(i.id)}
        onClick={() => void concluir(i)}
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors',
          i.atrasado ? 'border-danger hover:bg-danger/10' : 'border-line hover:border-success hover:bg-success/10',
        )}
        aria-label="Concluir"
        title="Marcar como concluído"
      >
        <Check className="h-3 w-3 text-transparent group-hover:text-success" />
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm', i.atrasado ? 'text-danger' : 'text-foreground/90')}>
          {i.titulo}
        </span>
        <span className="block truncate text-xs text-foreground/50">
          {mostrarCliente ? `${i.cliente_nome} · ` : ''}
          {ROTULO_ORIGEM[i.origem]}: {i.origem_nome}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-foreground/55 sm:block">
        {i.responsavel_nome ?? 'sem responsável'}
      </span>
      <span className="w-24 shrink-0 text-right">
        {i.atrasado ? (
          <Badge tone="danger">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {prazoBr(i.prazo)}
          </Badge>
        ) : (
          <span className="text-xs text-foreground/45">{prazoBr(i.prazo)}</span>
        )}
      </span>
      {!agrupar && (
        <button
          type="button"
          onClick={() => onAbrirCliente(i.cliente_id)}
          className="shrink-0 text-foreground/30 transition-colors hover:text-accent"
          aria-label="Abrir cliente"
          title="Abrir o cliente"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando pendências…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-foreground/45">Em aberto</p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">{itens.length}</p>
          <p className="text-xs text-foreground/45">em {clientes.length} cliente(s)</p>
        </div>
        <button
          type="button"
          onClick={() => setSoAtrasados((v) => !v)}
          className={cn(
            'rounded-xl border px-4 py-3 text-left transition-colors',
            soAtrasados ? 'border-danger/50 bg-danger/[0.05]' : 'border-line hover:border-foreground/20',
          )}
        >
          <p className="text-xs uppercase tracking-wide text-foreground/45">Atrasadas</p>
          <p className={cn('text-2xl font-semibold tabular-nums', atrasados > 0 ? 'text-danger' : 'text-foreground')}>
            {atrasados}
          </p>
          <p className="text-xs text-foreground/45">{soAtrasados ? 'mostrando só elas' : 'clique pra filtrar'}</p>
        </button>
        <div className="rounded-xl border border-line px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-foreground/45">Sem prazo</p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {itens.filter((i) => !i.prazo).length}
          </p>
          <p className="text-xs text-foreground/45">defina um prazo pra elas poderem atrasar</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filtro
          rotulo="Responsável"
          valor={responsavel}
          onChange={setResponsavel}
          opcoes={[
            { value: '', label: 'Todos' },
            ...responsaveis.map(([id, nome]) => ({ value: id, label: nome })),
            { value: '__sem', label: 'Sem responsável' },
          ]}
        />
        <Filtro
          rotulo="Cliente"
          valor={cliente}
          onChange={setCliente}
          opcoes={[{ value: '', label: 'Todos' }, ...clientes.map(([id, nome]) => ({ value: id, label: nome }))]}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground/70">
          <input
            type="checkbox"
            checked={soAtrasados}
            onChange={(e) => setSoAtrasados(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line"
          />
          só atrasadas
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-foreground/70">
          <input
            type="checkbox"
            checked={agrupar}
            onChange={(e) => alternarAgrupar(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line"
          />
          agrupar por cliente
        </label>
        {(responsavel || cliente || soAtrasados) && (
          <button
            type="button"
            onClick={() => {
              setResponsavel('')
              setCliente('')
              setSoAtrasados(false)
            }}
            className="text-xs text-foreground/45 hover:text-accent"
          >
            limpar filtros
          </button>
        )}
      </div>

      {visiveis.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title={itens.length === 0 ? 'Nada pendente' : 'Nada com esses filtros'}
          description={
            itens.length === 0
              ? 'Todos os itens de checklist dos clientes ativos estão concluídos.'
              : 'Mude os filtros ou limpe a seleção.'
          }
        />
      ) : agrupar ? (
        <div className="space-y-3">
          {grupos.map((g) => {
            const atrasoDoGrupo = g.itens.filter((x) => x.atrasado).length
            const fechado = fechados.has(g.id)
            return (
              <section key={g.id} className="overflow-hidden rounded-xl border border-line">
                <header className="flex items-center gap-3 bg-elevate/[0.02] px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setFechados((atual) => {
                        const novo = new Set(atual)
                        if (novo.has(g.id)) novo.delete(g.id)
                        else novo.add(g.id)
                        return novo
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', fechado && '-rotate-90')}
                    />
                    <span className="truncate text-sm font-semibold text-foreground">{g.nome}</span>
                    <span className="text-xs text-foreground/45">{g.itens.length} em aberto</span>
                    {atrasoDoGrupo > 0 && <Badge tone="danger">{atrasoDoGrupo} atrasada(s)</Badge>}
                  </button>
                  <button
                    type="button"
                    onClick={() => onAbrirCliente(g.id)}
                    className="flex shrink-0 items-center gap-1 text-xs text-foreground/45 transition-colors hover:text-accent"
                  >
                    abrir cliente <ExternalLink className="h-3 w-3" />
                  </button>
                </header>
                {!fechado && <ul className="border-t border-line">{g.itens.map((i) => linha(i, false))}</ul>}
              </section>
            )
          })}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line">{visiveis.map((i) => linha(i, true))}</ul>
      )}
    </div>
  )
}
