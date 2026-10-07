import * as React from 'react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { PRIORIDADES, progressoDoCliente, type GcClienteLista, type GcPrioridade } from '@/services/gestaoClientes'
import { DIAS_AVISO_RENOVACAO, type Saude } from '@/lib/gcSaude'
import { mesPorExtenso, somarMeses } from '@/lib/gcMetricas'
import { situacaoDoMes, type SituacaoDoMes } from '@/lib/gcLancamento'
import { FAIXA_DA_SAUDE, estiloDoAvatar } from '@/lib/gcVisual'
import { iniciaisDe } from '@/lib/gcIniciais'
import { cn } from '@/lib/utils'

/**
 * A altura do quadro vai do topo dele até o fim da TELA. Assim as colunas rolam por dentro e a barra de
 * rolagem horizontal fica sempre à vista — antes o quadro crescia com a lista e era preciso descer a
 * página até o rodapé pra achar a barra e alcançar as colunas da direita.
 */
function useAlturaAteOFim(ref: React.RefObject<HTMLElement>) {
  const [altura, setAltura] = React.useState<number | undefined>(undefined)
  React.useLayoutEffect(() => {
    const calcular = () => {
      const el = ref.current
      if (!el) return
      setAltura(Math.max(380, Math.round(window.innerHeight - el.getBoundingClientRect().top - 16)))
    }
    calcular()
    const t = window.setTimeout(calcular, 300)
    window.addEventListener('resize', calcular)
    window.addEventListener('scroll', calcular, { passive: true, capture: true })
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', calcular)
      window.removeEventListener('scroll', calcular, true)
    }
  }, [ref])
  return altura
}

export interface ColunaKanban {
  /** Id do modelo da etapa, ou 'fim' pra "jornada concluída". */
  id: string
  nome: string
}

type Item = { cliente: GcClienteLista; saude: Saude }

const ESTILO_PRIORIDADE: Record<GcPrioridade, string> = {
  alta: 'border-danger/30 bg-danger/10 text-danger',
  media: 'border-line bg-elevate/[0.04] text-foreground/55',
  baixa: 'border-line text-foreground/40',
}

/** Em que coluna o cliente está: o modelo da etapa atual, ou o fim se a jornada acabou. */
function colunaDo(c: GcClienteLista, colunas: ColunaKanban[]): string | null {
  if (!c.etapa_atual) return 'fim'
  if (c.etapa_atual_modelo_id && colunas.some((x) => x.id === c.etapa_atual_modelo_id)) {
    return c.etapa_atual_modelo_id
  }
  // Etapa cujo modelo foi desativado/removido: acha pelo nome, que a jornada do cliente copia.
  return colunas.find((x) => x.nome === c.etapa_atual)?.id ?? null
}

function diasAteData(data: string | null): number | null {
  if (!data) return null
  const quando = new Date(`${String(data).slice(0, 10)}T12:00:00`).getTime()
  return Number.isNaN(quando) ? null : Math.round((quando - Date.now()) / 86400000)
}

/** O card de um cliente — o mesmo nas duas visões do Kanban. */
function CartaoCliente({
  item,
  esmaecido,
  onAbrir,
  arrastavel,
  onDragStart,
  onDragEnd,
  rodape,
}: {
  item: Item
  esmaecido?: boolean
  onAbrir: (id: string) => void
  arrastavel?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  /** Conteúdo extra no pé do card (o seletor "mover pra…" da visão por etapa). */
  rodape?: React.ReactNode
}) {
  const { cliente: c, saude } = item
  const renov = diasAteData(c.proxima_renovacao)
  const alertaRenov = renov !== null && renov <= DIAS_AVISO_RENOVACAO

  return (
    <article
      draggable={arrastavel}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onAbrir(c.id)}
      className={cn(
        'group cursor-pointer rounded-xl border border-l-[3px] border-line bg-surface p-3 shadow-sm transition-all hover:-translate-y-px hover:shadow-md',
        FAIXA_DA_SAUDE[saude.nivel],
        arrastavel && 'active:cursor-grabbing',
        esmaecido && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold"
          style={estiloDoAvatar(c.nome_empresa)}
        >
          {iniciaisDe(c.nome_empresa) || '—'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {c.nome_empresa}
            {c.fora_dos_totais && (
              <span className="ml-1.5 rounded border border-line px-1 text-[10px] font-normal uppercase text-foreground/45">
                teste
              </span>
            )}
          </p>
          <p className="truncate text-xs text-foreground/45">{c.responsavel_nome ?? 'sem responsável'}</p>
        </div>
        {arrastavel && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-foreground/20 transition-colors group-hover:text-foreground/50" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PastilhaSaude estado={saude.nivel} />
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
            ESTILO_PRIORIDADE[c.prioridade ?? 'media'],
          )}
        >
          {PRIORIDADES.find((p) => p.valor === (c.prioridade ?? 'media'))?.label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevate/[0.08]">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${progressoDoCliente(c)}%` }} />
        </span>
        <span className="text-[10px] tabular-nums text-foreground/45">{progressoDoCliente(c)}%</span>
      </div>

      {(Number(c.itens_atrasados) > 0 || alertaRenov) && (
        <p className="mt-1.5 text-[11px] text-danger">
          {Number(c.itens_atrasados) > 0 && `${Number(c.itens_atrasados)} atrasado(s)`}
          {Number(c.itens_atrasados) > 0 && alertaRenov && ' · '}
          {alertaRenov && (renov! < 0 ? `renovação venceu há ${Math.abs(renov!)}d` : `renova em ${renov}d`)}
        </p>
      )}

      {rodape}
    </article>
  )
}

/**
 * Kanban por etapa da jornada: uma coluna por etapa, o cliente no card da etapa em que está.
 *
 * Arrastar o card pra outra coluna MOVE o cliente de etapa — e isso mexe no checklist (pra frente,
 * conclui as etapas que ficam pra trás; pra trás, reabre e desmarca). Por isso arrastar não executa
 * nada direto: pede a prévia ao servidor e a página mostra uma janela de confirmação com o que vai
 * acontecer.
 *
 * Arrastar não funciona em tela de toque, então todo card também tem um seletor "mover pra…", que
 * passa pela mesma confirmação.
 */
export function KanbanClientes({
  itens,
  colunas,
  onAbrir,
  onMover,
}: {
  itens: Item[]
  colunas: ColunaKanban[]
  onAbrir: (id: string) => void
  onMover: (cliente: GcClienteLista, destinoId: string) => void
}) {
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [sobre, setSobre] = React.useState<string | null>(null)
  const rolagem = React.useRef<HTMLDivElement>(null)
  const ponteiroX = React.useRef<number | null>(null)
  const altura = useAlturaAteOFim(rolagem)

  // Arrastando perto da borda, o quadro anda sozinho: dá pra levar o card até uma coluna distante sem
  // soltar, sem precisar da barra de rolagem.
  React.useEffect(() => {
    if (arrastando === null) return
    const id = window.setInterval(() => {
      const el = rolagem.current
      const x = ponteiroX.current
      if (!el || x === null) return
      const r = el.getBoundingClientRect()
      const zona = 110
      if (x < r.left + zona) el.scrollLeft -= Math.ceil((r.left + zona - x) / 5)
      else if (x > r.right - zona) el.scrollLeft += Math.ceil((x - (r.right - zona)) / 5)
    }, 16)
    return () => window.clearInterval(id)
  }, [arrastando])

  const todas: ColunaKanban[] = [...colunas, { id: 'fim', nome: 'Jornada concluída' }]
  const porColuna = new Map<string, Item[]>()
  for (const col of todas) porColuna.set(col.id, [])
  const sem: Item[] = []
  for (const item of itens) {
    const alvo = colunaDo(item.cliente, colunas)
    if (alvo && porColuna.has(alvo)) porColuna.get(alvo)!.push(item)
    else sem.push(item)
  }

  return (
    <div>
    <div
      ref={rolagem}
      style={{ height: altura }}
      onDragOver={(e) => {
        ponteiroX.current = e.clientX
      }}
      className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-3 lg:-mx-6 lg:px-6"
    >
      <div className="flex h-full gap-3">
        {todas.map((col, ordemDaColuna) => {
          const doGrupo = porColuna.get(col.id) ?? []
          const ativa = sobre === col.id && arrastando !== null
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                if (sobre !== col.id) setSobre(col.id)
              }}
              onDragLeave={() => setSobre((atual) => (atual === col.id ? null : atual))}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain') || arrastando
                setSobre(null)
                setArrastando(null)
                const cliente = itens.find((x) => x.cliente.id === id)?.cliente
                if (cliente) onMover(cliente, col.id)
              }}
              className={cn(
                'flex h-full w-[272px] shrink-0 flex-col rounded-2xl border bg-elevate/[0.025] transition-colors',
                ativa ? 'border-accent/60 bg-accent/[0.06] ring-1 ring-accent/30' : 'border-line',
              )}
            >
              <header className="flex items-center justify-between gap-2 px-3.5 py-3">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground" title={col.nome}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent/15 text-[10px] font-bold tabular-nums text-accent">
                    {col.id === 'fim' ? '✓' : ordemDaColuna + 1}
                  </span>
                  <span className="truncate">{col.nome}</span>
                </h3>
                <span className="rounded-full bg-elevate/[0.08] px-2 py-0.5 text-xs font-medium tabular-nums text-foreground/60">
                  {doGrupo.length}
                </span>
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {doGrupo.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-foreground/30">
                    {arrastando ? 'solte aqui' : 'nenhum cliente'}
                  </p>
                )}
                {doGrupo.map((item) => (
                  <CartaoCliente
                    key={item.cliente.id}
                    item={item}
                    esmaecido={arrastando === item.cliente.id}
                    onAbrir={onAbrir}
                    arrastavel
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', item.cliente.id)
                      e.dataTransfer.effectAllowed = 'move'
                      setArrastando(item.cliente.id)
                    }}
                    onDragEnd={() => {
                      setArrastando(null)
                      setSobre(null)
                    }}
                    rodape={
                      // Alternativa ao arrastar, pra tela de toque. Mesma confirmação.
                      <select
                        value=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          if (e.target.value) onMover(item.cliente, e.target.value)
                        }}
                        className="mt-2 h-6 w-full rounded border border-line bg-transparent px-1 text-[11px] text-foreground/45 outline-none focus:border-accent/60"
                        aria-label="Mover pra outra etapa"
                      >
                        <option value="">mover pra…</option>
                        {todas
                          .filter((x) => x.id !== col.id)
                          .map((x) => (
                            <option key={x.id} value={x.id} className="bg-surface text-foreground">
                              {x.nome}
                            </option>
                          ))}
                      </select>
                    }
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>

      {sem.length > 0 && (
        <p className="mt-2 text-xs text-foreground/45">
          {sem.length} cliente(s) com etapa que não bate com nenhuma coluna:{' '}
          {sem.map((x) => x.cliente.nome_empresa).join(', ')} — aparecem na tabela.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------
// Visão por situação do mês
// ---------------------------------------------------------------------------------------------------

const COLUNAS_SITUACAO: { id: SituacaoDoMes; nome: string; ajuda: string; tom: string }[] = [
  { id: 'sem_lancamento', nome: 'Sem lançamento', ajuda: 'nenhuma métrica lançada', tom: 'border-t-danger/60' },
  { id: 'lancado', nome: 'Lançado', ajuda: 'números no lugar, falta o relatório', tom: 'border-t-warning/60' },
  { id: 'rascunho', nome: 'Relatório em rascunho', ajuda: 'escrito, ainda não publicado', tom: 'border-t-accent/60' },
  { id: 'publicado', nome: 'Publicado', ajuda: 'o cliente já pode ler', tom: 'border-t-success/60' },
]

/**
 * Kanban por situação do mês: sem lançamento → lançado → relatório em rascunho → publicado.
 *
 * É SÓ LEITURA, de propósito: a situação é calculada (do que está lançado e publicado), não
 * escolhida. Arrastar um card pra "Publicado" não publicaria nada, só mentiria. Pra avançar, o card
 * abre o cliente, e a coluna "Sem lançamento" tem o atalho pra grade de lançamento.
 */
export function KanbanSituacao({
  itens,
  periodo,
  carregando,
  onPeriodo,
  onAbrir,
  onLancar,
}: {
  itens: Item[]
  periodo: string
  carregando: boolean
  onPeriodo: (p: string) => void
  onAbrir: (id: string) => void
  onLancar: (periodo: string) => void
}) {
  const rolagemSit = React.useRef<HTMLDivElement>(null)
  const alturaSit = useAlturaAteOFim(rolagemSit)
  const porColuna = new Map<SituacaoDoMes, Item[]>()
  for (const col of COLUNAS_SITUACAO) porColuna.set(col.id, [])
  for (const item of itens) porColuna.get(situacaoDoMes(item.cliente))!.push(item)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => onPeriodo(somarMeses(periodo, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[160px] text-center text-sm font-semibold text-foreground">
          {mesPorExtenso(periodo)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onPeriodo(somarMeses(periodo, 1))} aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="ml-2 text-xs text-foreground/45">
          {carregando ? 'carregando…' : 'situação calculada do que está lançado e publicado'}
        </span>
      </div>

      <div ref={rolagemSit} style={{ height: alturaSit }} className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-3 lg:-mx-6 lg:px-6">
        <div className="flex h-full gap-3">
          {COLUNAS_SITUACAO.map((col) => {
            const doGrupo = porColuna.get(col.id) ?? []
            return (
              <section
                key={col.id}
                className={cn(
                  'flex h-full w-[272px] shrink-0 flex-col rounded-2xl border border-t-[3px] border-line bg-elevate/[0.025]',
                  col.tom,
                  carregando && 'opacity-60',
                )}
              >
                <header className="px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{col.nome}</h3>
                    <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">
                      {doGrupo.length}
                    </span>
                  </div>
                  <p className="text-[11px] text-foreground/40">{col.ajuda}</p>
                  {col.id === 'sem_lancamento' && doGrupo.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onLancar(periodo)}
                      className="mt-1 text-xs font-medium text-accent hover:underline"
                    >
                      lançar o mês →
                    </button>
                  )}
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                  {doGrupo.length === 0 && (
                    <p className="px-1 py-4 text-center text-xs text-foreground/30">nenhum cliente</p>
                  )}
                  {doGrupo.map((item) => (
                    <CartaoCliente key={item.cliente.id} item={item} onAbrir={onAbrir} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
