import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, CalendarClock, Clock, Loader2, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { AvatarCliente } from '@/components/gestaoClientes/AvatarCliente'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import { gestaoClientes, type GcDemanda, type GcDemandaColuna } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'
import { diasDesde, tempoDesde, useMostrarTempo } from '@/lib/tempoNaColuna'

const PRIORIDADES: { valor: GcDemanda['prioridade']; label: string; cor: string }[] = [
  { valor: 'baixa', label: 'Baixa', cor: 'bg-foreground/25' },
  { valor: 'media', label: 'Média', cor: 'bg-warning' },
  { valor: 'alta', label: 'Alta', cor: 'bg-danger' },
]

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const hojeISO = () => new Date().toISOString().slice(0, 10)

interface FormDemanda {
  id?: string
  cliente: string
  titulo: string
  descricao: string
  prioridade: GcDemanda['prioridade']
  prazo: string
  responsavel: string
  coluna: string
}

/**
 * KANBAN DE DEMANDAS. As colunas são as mesmas pra todos os clientes (editáveis em "Colunas").
 * Dentro do cliente (`clienteId`) mostra só as demandas dele; sem `clienteId` é o quadro geral, com as de
 * todos os clientes e o nome do cliente em cada cartão.
 *
 * Arrastar o cartão muda a coluna, ou a ordem dentro da mesma coluna (a linha colorida mostra onde ele cai). No celular não há arrastar com o dedo: cada cartão tem o seletor "Mover para".
 */
export function KanbanDemandas({
  clienteId,
  clientes,
}: {
  clienteId?: string
  /** Só no quadro geral: os clientes pra escolher ao criar e filtrar. */
  clientes?: { id: string; nome_empresa: string }[]
}) {
  const navegar = useNavigate()
  const { data: perfis } = useTeamProfiles()
  const [colunas, setColunas] = React.useState<GcDemandaColuna[]>([])
  const [demandas, setDemandas] = React.useState<GcDemanda[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [filtroCliente, setFiltroCliente] = React.useState('')
  const [form, setForm] = React.useState<FormDemanda | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const [gerenciando, setGerenciando] = React.useState(false)
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [sobre, setSobre] = React.useState<string | null>(null)
  /** Onde o cartão arrastado vai cair: coluna + posição entre os cartões visíveis (sem contar o arrastado). */
  const [ponto, setPonto] = React.useState<{ col: string; idx: number } | null>(null)
  const [mostrarTempo, alternarTempo] = useMostrarTempo('demandas')

  const carregar = React.useCallback(async () => {
    try {
      const [c, d] = await Promise.all([gestaoClientes.demandasColunas(), gestaoClientes.demandas(clienteId)])
      setColunas(c)
      setDemandas(d)
    } catch (err) {
      toast.error('Falha ao carregar as demandas: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const visiveis = filtroCliente ? demandas.filter((d) => d.gc_cliente_id === filtroCliente) : demandas
  const doGrupo = (colunaId: string) =>
    visiveis.filter((d) => d.coluna_id === colunaId).sort((a, b) => a.ordem - b.ordem)
  const colunaConcluida = new Set(colunas.filter((c) => c.concluida).map((c) => c.id))

  /** Posição no servidor (coluna inteira) equivalente à posição entre os cartões visíveis. */
  const posicaoReal = (colunaId: string, idxVisivel: number, arrastadaId: string) => {
    const todos = demandas
      .filter((d) => d.coluna_id === colunaId && d.id !== arrastadaId)
      .sort((a, b) => a.ordem - b.ordem)
    const vis = doGrupo(colunaId).filter((d) => d.id !== arrastadaId)
    if (idxVisivel < vis.length) return todos.findIndex((x) => x.id === vis[idxVisivel].id)
    if (vis.length) return todos.findIndex((x) => x.id === vis[vis.length - 1].id) + 1
    return todos.length
  }

  const mover = async (demanda: GcDemanda, colunaId: string, posicao?: number) => {
    // Otimista: o cartão já muda de lugar; se o servidor recusar, recarrega.
    setDemandas((lista) => {
      const outras = lista.filter((d) => d.coluna_id === colunaId && d.id !== demanda.id).sort((a, b) => a.ordem - b.ordem)
      outras.splice(posicao ?? outras.length, 0, demanda)
      const novaOrdem = new Map(outras.map((d, i) => [d.id, i]))
      return lista.map((d) => {
        if (d.id === demanda.id) {
          const mudouDeColuna = d.coluna_id !== colunaId
          return { ...d, coluna_id: colunaId, ordem: novaOrdem.get(d.id) ?? 0, coluna_desde: mudouDeColuna ? new Date().toISOString() : d.coluna_desde }
        }
        return novaOrdem.has(d.id) ? { ...d, ordem: novaOrdem.get(d.id)! } : d
      })
    })
    try {
      await gestaoClientes.moverDemanda(demanda.id, colunaId, posicao)
      await carregar()
    } catch (err) {
      toast.error('Falha ao mover: ' + (err as Error).message)
      await carregar()
    }
  }

  const abrirNova = (colunaId?: string) =>
    setForm({
      cliente: clienteId ?? filtroCliente ?? '',
      titulo: '',
      descricao: '',
      prioridade: 'media',
      prazo: '',
      responsavel: '',
      coluna: colunaId ?? colunas[0]?.id ?? '',
    })
  const abrirEdicao = (d: GcDemanda) =>
    setForm({
      id: d.id,
      cliente: d.gc_cliente_id,
      titulo: d.titulo,
      descricao: d.descricao,
      prioridade: d.prioridade,
      prazo: d.prazo ?? '',
      responsavel: d.responsavel_id ?? '',
      coluna: d.coluna_id,
    })

  const salvar = async () => {
    if (!form) return
    if (!form.titulo.trim()) return toast.error('Dê um título à demanda')
    if (!form.id && !form.cliente) return toast.error('Escolha o cliente')
    setSalvando(true)
    try {
      if (form.id) {
        const original = demandas.find((d) => d.id === form.id)
        await gestaoClientes.atualizarDemanda(form.id, {
          titulo: form.titulo.trim(),
          descricao: form.descricao,
          prioridade: form.prioridade,
          prazo: form.prazo || null,
          responsavel_id: form.responsavel || null,
        })
        if (original && original.coluna_id !== form.coluna) await gestaoClientes.moverDemanda(form.id, form.coluna)
      } else {
        await gestaoClientes.criarDemanda({
          gc_cliente_id: form.cliente,
          titulo: form.titulo.trim(),
          descricao: form.descricao,
          prioridade: form.prioridade,
          prazo: form.prazo || null,
          responsavel_id: form.responsavel || null,
          coluna_id: form.coluna,
        })
      }
      setForm(null)
      await carregar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const excluir = async () => {
    if (!form?.id) return
    if (!window.confirm('Excluir esta demanda? Não dá pra desfazer.')) return
    try {
      await gestaoClientes.excluirDemanda(form.id)
      setForm(null)
      await carregar()
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando demandas…
      </div>
    )
  }

  const opcoesResponsavel = [
    { value: '', label: 'Sem responsável' },
    ...(perfis ?? []).map((p) => ({ value: p.id, label: (p.name && p.name.trim()) || p.email })),
  ]

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {!clienteId && clientes && (
            <Select
              options={[{ value: '', label: 'Todos os clientes' }, ...clientes.map((c) => ({ value: c.id, label: c.nome_empresa }))]}
              value={filtroCliente}
              onChange={(e) => setFiltroCliente(e.target.value)}
              className="w-full sm:w-64"
            />
          )}
        </div>
        {/* No celular os três botões cabem numa linha só, sem quebrar o texto em duas. */}
        <div className="flex items-center gap-2 max-sm:gap-1 [&>button]:max-sm:whitespace-nowrap [&>button]:max-sm:px-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Clock className="h-4 w-4" />}
            onClick={alternarTempo}
            className={cn(mostrarTempo && 'bg-accent/10 text-accent')}
            title="Mostra há quanto tempo cada cartão está na coluna"
          >
            Tempo na coluna
          </Button>
          <Button variant="ghost" size="sm" leftIcon={<Settings2 className="h-4 w-4" />} onClick={() => setGerenciando(true)}>
            Colunas
          </Button>
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => abrirNova()}>
            Nova demanda
          </Button>
        </div>
      </div>

      {/* Colunas: lado a lado no computador; no celular cada uma ocupa quase a tela e se desliza pro lado. */}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 sm:mx-0 sm:snap-none sm:px-0">
        {colunas.map((col) => {
          const cartoes = doGrupo(col.id)
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                setSobre(col.id)
                // Área vazia da coluna (abaixo dos cartões): cai no fim.
                setPonto({ col: col.id, idx: cartoes.filter((x) => x.id !== arrastando).length })
              }}
              onDragLeave={() => setSobre((s) => (s === col.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                const alvo = ponto?.col === col.id ? ponto.idx : cartoes.filter((x) => x.id !== arrastando).length
                const d = demandas.find((x) => x.id === arrastando)
                setSobre(null)
                setPonto(null)
                setArrastando(null)
                if (!d) return
                const posicao = posicaoReal(col.id, alvo, d.id)
                if (d.coluna_id === col.id) {
                  const atual = demandas.filter((x) => x.coluna_id === col.id).sort((a, b) => a.ordem - b.ordem).findIndex((x) => x.id === d.id)
                  if (atual === posicao) return
                }
                void mover(d, col.id, posicao)
              }}
              className={cn(
                'flex max-h-[calc(100vh-14rem)] min-h-[12rem] w-[85vw] max-w-sm shrink-0 snap-center flex-col rounded-2xl border bg-elevate/[0.025] sm:w-72',
                sobre === col.id ? 'border-accent/60 bg-accent/[0.04]' : 'border-line',
              )}
            >
              <header className="flex items-center justify-between gap-2 px-3.5 py-3">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {col.nome}
                  {col.concluida && <span className="ml-1.5 text-[10px] font-normal uppercase text-success">concluída</span>}
                </h3>
                <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">{cartoes.length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {cartoes.length === 0 && (
                  <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-foreground/35">
                    Solte uma demanda aqui
                  </p>
                )}
                {cartoes.map((d, i) => {
                  const linhaAntes =
                    !!arrastando && arrastando !== d.id && ponto?.col === col.id &&
                    ponto.idx === cartoes.slice(0, i).filter((x) => x.id !== arrastando).length
                  const parado = diasDesde(d.coluna_desde)
                  const atrasada = d.prazo && d.prazo < hojeISO() && !colunaConcluida.has(d.coluna_id)
                  const prio = PRIORIDADES.find((p) => p.valor === d.prioridade)
                  return (
                    <React.Fragment key={d.id}>
                    {linhaAntes && <div className="-my-1 h-0.5 shrink-0 rounded-full bg-accent" />}
                    <article
                      draggable
                      onDragOver={(e) => {
                        if (!arrastando) return
                        e.preventDefault()
                        e.stopPropagation()
                        setSobre(col.id)
                        if (d.id === arrastando) return
                        const r = e.currentTarget.getBoundingClientRect()
                        const depois = e.clientY > r.top + r.height / 2
                        const base = cartoes.filter((x) => x.id !== arrastando)
                        setPonto({ col: col.id, idx: base.findIndex((x) => x.id === d.id) + (depois ? 1 : 0) })
                      }}
                      onDragStart={(e) => {
                        setArrastando(d.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        setArrastando(null)
                        setSobre(null)
                        setPonto(null)
                      }}
                      className={cn(
                        'group cursor-grab rounded-xl border border-line bg-surface p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing',
                        arrastando === d.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', prio?.cor)} title={`Prioridade ${prio?.label.toLowerCase()}`} />
                        <button type="button" onClick={() => abrirEdicao(d)} className="min-w-0 flex-1 text-left">
                          <p className={cn('text-sm font-medium text-foreground', colunaConcluida.has(d.coluna_id) && 'text-foreground/50 line-through')}>
                            {d.titulo}
                          </p>
                          {d.descricao && <p className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{d.descricao}</p>}
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirEdicao(d)}
                          className="shrink-0 rounded-md p-1 text-foreground/30 hover:text-accent sm:opacity-0 sm:group-hover:opacity-100"
                          aria-label="Editar demanda"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground/50">
                        {!clienteId && (
                          <button
                            type="button"
                            onClick={() => navegar(`/clientesnxdigital/clientes/${d.gc_cliente_id}`)}
                            className="flex items-center gap-1.5 rounded-full bg-elevate/[0.05] py-0.5 pl-0.5 pr-2 hover:text-accent"
                          >
                            <AvatarCliente nome={d.cliente_nome} logoUrl={d.cliente_logo} className="h-4 w-4 rounded-full text-[8px]" />
                            <span className="max-w-[120px] truncate">{d.cliente_nome}</span>
                          </button>
                        )}
                        {d.prazo && (
                          <span className={cn('flex items-center gap-1', atrasada && 'font-medium text-danger')}>
                            <CalendarClock className="h-3 w-3" /> {dataBr(d.prazo)}
                          </span>
                        )}
                        {d.responsavel_nome && <span className="truncate">· {d.responsavel_nome}</span>}
                        {mostrarTempo && (
                          <span
                            className={cn('flex items-center gap-1', parado >= 7 && !colunaConcluida.has(d.coluna_id) && 'font-medium text-warning')}
                            title={`Na coluna "${col.nome}" desde ${new Date(d.coluna_desde).toLocaleString('pt-BR')}`}
                          >
                            <Clock className="h-3 w-3" /> {tempoDesde(d.coluna_desde)}
                          </span>
                        )}
                      </div>
                      {/* Sem arrastar no celular: este seletor é o jeito de mover. */}
                      <select
                        value={d.coluna_id}
                        onChange={(e) => void mover(d, e.target.value)}
                        aria-label="Mover para"
                        className="mt-2 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs text-foreground/70 sm:hidden"
                      >
                        {colunas.map((c) => (
                          <option key={c.id} value={c.id}>
                            Mover para: {c.nome}
                          </option>
                        ))}
                      </select>
                    </article>
                    </React.Fragment>
                  )
                })}
                {!!arrastando && ponto?.col === col.id && ponto.idx >= cartoes.filter((x) => x.id !== arrastando).length && cartoes.some((x) => x.id !== arrastando) && (
                  <div className="-my-1 h-0.5 shrink-0 rounded-full bg-accent" />
                )}
                <button
                  type="button"
                  onClick={() => abrirNova(col.id)}
                  className="flex items-center justify-center gap-1 rounded-xl py-2 text-xs text-foreground/40 transition-colors hover:bg-elevate/[0.04] hover:text-accent"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {/* ------------------------------------------------------------ criar / editar */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        size="md"
        title={form?.id ? 'Editar demanda' : 'Nova demanda'}
        footer={
          <div className="flex items-center justify-between gap-2">
            {form?.id ? (
              <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => void excluir()}>
                Excluir
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button loading={salvando} onClick={() => void salvar()}>
                Salvar
              </Button>
            </div>
          </div>
        }
      >
        {form && (
          <div className="space-y-3">
            {!clienteId && !form.id && (
              <Select
                label="Cliente *"
                options={[{ value: '', label: 'Escolha o cliente…' }, ...(clientes ?? []).map((c) => ({ value: c.id, label: c.nome_empresa }))]}
                value={form.cliente}
                onChange={(e) => setForm({ ...form, cliente: e.target.value })}
              />
            )}
            <Input label="Título *" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} autoFocus />
            <Textarea label="Detalhes" rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Coluna"
                options={colunas.map((c) => ({ value: c.id, label: c.nome }))}
                value={form.coluna}
                onChange={(e) => setForm({ ...form, coluna: e.target.value })}
                disabled={!form.id && false}
              />
              <Select
                label="Prioridade"
                options={PRIORIDADES.map((p) => ({ value: p.valor, label: p.label }))}
                value={form.prioridade}
                onChange={(e) => setForm({ ...form, prioridade: e.target.value as GcDemanda['prioridade'] })}
              />
              <Input label="Prazo" type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
              <Select
                label="Responsável"
                options={opcoesResponsavel}
                value={form.responsavel}
                onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>

      <ModalColunas aberto={gerenciando} onFechar={() => setGerenciando(false)} colunas={colunas} onMudou={carregar} />
    </div>
  )
}

/** Adicionar, renomear, reordenar e apagar colunas. Vale pra todos os clientes. */
function ModalColunas({
  aberto, onFechar, colunas, onMudou,
}: {
  aberto: boolean
  onFechar: () => void
  colunas: GcDemandaColuna[]
  onMudou: () => Promise<void> | void
}) {
  const [nova, setNova] = React.useState('')
  const [nomes, setNomes] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    if (aberto) setNomes(Object.fromEntries(colunas.map((c) => [c.id, c.nome])))
  }, [aberto, colunas])

  const agir = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const trocar = (i: number, delta: number) => {
    const ids = colunas.map((c) => c.id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void agir(() => gestaoClientes.ordenarDemandasColunas(ids))
  }

  const apagar = async (c: GcDemandaColuna) => {
    try {
      await gestaoClientes.excluirDemandaColuna(c.id)
      await onMudou()
    } catch (err) {
      const msg = (err as Error).message
      // A coluna tem demandas: pergunta pra onde vão (a primeira outra coluna é a sugestão).
      const outra = colunas.find((x) => x.id !== c.id)
      if (outra && /escolha pra qual coluna/i.test(msg)) {
        if (window.confirm(`"${c.nome}" tem demandas. Mover todas para "${outra.nome}" e apagar a coluna?`)) {
          await agir(() => gestaoClientes.excluirDemandaColuna(c.id, outra.id))
        }
      } else toast.error(msg)
    }
  }

  return (
    <Modal open={aberto} onClose={onFechar} size="md" title="Colunas do kanban" description="Valem pra todos os clientes.">
      <ul className="space-y-2">
        {colunas.map((c, i) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl border border-line p-2">
            <div className="flex flex-col">
              <button type="button" disabled={i === 0} onClick={() => trocar(i, -1)} className="text-foreground/40 hover:text-accent disabled:opacity-20" aria-label="Subir">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button type="button" disabled={i === colunas.length - 1} onClick={() => trocar(i, 1)} className="text-foreground/40 hover:text-accent disabled:opacity-20" aria-label="Descer">
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              value={nomes[c.id] ?? c.nome}
              onChange={(e) => setNomes((n) => ({ ...n, [c.id]: e.target.value }))}
              onBlur={() => {
                const v = (nomes[c.id] ?? '').trim()
                if (v && v !== c.nome) void agir(() => gestaoClientes.atualizarDemandaColuna(c.id, { nome: v }))
              }}
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-sm text-foreground outline-none focus:border-accent"
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-foreground/55" title="Demandas nesta coluna contam como concluídas">
              <input
                type="checkbox"
                checked={c.concluida}
                onChange={(e) => void agir(() => gestaoClientes.atualizarDemandaColuna(c.id, { concluida: e.target.checked }))}
              />
              concluída
            </label>
            <button
              type="button"
              onClick={() => void apagar(c)}
              disabled={colunas.length <= 1}
              className="shrink-0 p-1 text-foreground/30 hover:text-danger disabled:opacity-20"
              aria-label="Apagar coluna"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const nome = nova.trim()
          if (!nome) return
          void agir(async () => {
            await gestaoClientes.criarDemandaColuna(nome)
            setNova('')
          })
        }}
      >
        <Input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nome da nova coluna" />
        <Button type="submit" leftIcon={<Plus className="h-4 w-4" />}>
          Adicionar
        </Button>
      </form>
    </Modal>
  )
}
