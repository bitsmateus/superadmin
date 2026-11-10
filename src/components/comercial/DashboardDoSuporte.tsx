import * as React from 'react'
import { AlertTriangle, CalendarRange, CheckCircle2, HelpCircle, Inbox, LayoutGrid, ListTodo, PackageCheck, PlayCircle, ShoppingBag, Tags, Timer } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { ClickableStat } from '@/components/comercial/ClickableStat'
import { TodayStatCard, type StatCard } from '@/components/comercial/LeadTodayPanel'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadLabelsService } from '@/services/leadLabels'
import { addMonthsToId, currentMonthId, monthIdBounds } from '@/hooks/useMonthFilter'
import { diaLocal } from '@/lib/diaLocal'
import { todayKey } from '@/lib/leadDates'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

type Periodo = 'hoje' | 'mes' | 'mes_anterior' | 'personalizado'

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Em que "tipo" de quadro o card está — pelo nome, que é como o CRM do Jean/João foi montado. */
type Etapa = 'pendente' | 'fazendo' | 'finalizado' | 'entrega' | 'venda' | 'outro'
function etapaDoQuadro(nome: string): Etapa {
  const n = normalizar(nome)
  if (n === 'demandaspendentes') return 'pendente'
  if (n === 'fazendo') return 'fazendo'
  if (n === 'finalizado' || n === 'finalizados') return 'finalizado'
  if (n.includes('entrega')) return 'entrega'
  if (n.startsWith('vendasdomes')) return 'venda'
  return 'outro'
}

/** Dia (yyyy-mm-dd) do "Finalizar até", ou '' se não tem. */
const diaDoPrazo = (r: LeadRow) => (/^\d{4}-\d{2}-\d{2}/.test(r.agendamento) ? r.agendamento.slice(0, 10) : '')
/** Dia em que o card entrou no quadro onde está agora (cards antigos, de antes do campo, caem na última edição). */
const diaQueEntrou = (r: LeadRow) => diaLocal(r.entrouColunaEm ?? r.updatedAt)

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
      )}
    >
      {children}
    </button>
  )
}

/** Número clicável de uma célula da tabela por tipo (abre o card, ou a lista se tiver mais de um). */
function Numero({ matches, boards, onOpenLead }: { matches: LeadRow[]; boards: LeadBoard[]; onOpenLead: (id: string) => void }) {
  return (
    <ClickableStat matches={matches} boards={boards} onOpenLead={onOpenLead}>
      {(onClick, ref) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          disabled={matches.length === 0}
          className={cn(
            'min-w-[2rem] rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums',
            matches.length > 0 ? 'text-foreground hover:bg-accent/10 hover:text-accent' : 'cursor-default text-foreground/25',
          )}
        >
          {matches.length}
        </button>
      )}
    </ClickableStat>
  )
}

function Bloco({ icon, title, children, extra }: { icon: React.ReactNode; title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span>
        <span className="flex-1">{title}</span>
        {extra}
      </div>
      {children}
    </div>
  )
}

/**
 * Dashboard do CRM do Jean/João (suporte) — no lugar do dashboard de leads (MRR, SDR, dia de contato não servem aqui).
 * - Agora: retrato do momento, sem período (pendentes, fazendo, vencidas, sem info).
 * - No período (Hoje / Mês atual / Mês anterior / Personalizado): demandas que entraram (data de criação) e as que
 *   foram finalizadas / entregues / viraram venda (data em que o card entrou nesse quadro), quantas no prazo do
 *   "Finalizar até", e tudo isso aberto por Tipo (API OFICIAL, API COMUM, IA...).
 */
export function DashboardDoSuporte({ rows, boards, onOpenLead }: { rows: LeadRow[]; boards: LeadBoard[]; onOpenLead: (id: string) => void }) {
  const pageId = boards[0]?.page
  // As etiquetas só carregam quando alguém abre a coluna — sem isso a tabela vinha sem as 8 opções (nem cor, nem ordem).
  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])
  const tipos = useLeadLabels('tipo', pageId)
  const hoje = React.useMemo(() => todayKey(), [])

  const [periodo, setPeriodo] = React.useState<Periodo>('mes')
  const [deCustom, setDeCustom] = React.useState(() => monthIdBounds(currentMonthId()).from)
  const [ateCustom, setAteCustom] = React.useState(() => hoje)
  const { from, to } = React.useMemo(() => {
    if (periodo === 'hoje') return { from: hoje, to: hoje }
    if (periodo === 'mes') return monthIdBounds(currentMonthId())
    if (periodo === 'mes_anterior') return monthIdBounds(addMonthsToId(currentMonthId(), -1))
    return { from: deCustom, to: ateCustom }
  }, [periodo, hoje, deCustom, ateCustom])
  const noPeriodo = React.useCallback((dia: string) => !!dia && (!from || dia >= from) && (!to || dia <= to), [from, to])

  const etapaPorQuadro = React.useMemo(() => new Map(boards.map((b) => [b.id, etapaDoQuadro(b.name)])), [boards])
  const temQuadroDeEntrega = boards.some((b) => etapaDoQuadro(b.name) === 'entrega')
  const temQuadroDeVenda = boards.some((b) => etapaDoQuadro(b.name) === 'venda')

  const d = React.useMemo(() => {
    const agora = { pendentes: [] as LeadRow[], fazendo: [] as LeadRow[], vencidas: [] as LeadRow[], semInfo: [] as LeadRow[] }
    const per = { entraram: [] as LeadRow[], finalizadas: [] as LeadRow[], entregas: [] as LeadRow[], vendas: [] as LeadRow[], noPrazo: [] as LeadRow[], foraDoPrazo: [] as LeadRow[] }
    for (const r of rows) {
      const etapa = etapaPorQuadro.get(r.boardId) ?? 'outro'
      const fechada = etapa === 'finalizado' || etapa === 'entrega' || etapa === 'venda'
      const prazo = diaDoPrazo(r)
      if (etapa === 'pendente') agora.pendentes.push(r)
      if (etapa === 'fazendo') agora.fazendo.push(r)
      if (!fechada && prazo && prazo < hoje) agora.vencidas.push(r)
      if (!fechada && (!r.telefone.trim() || !r.tipo.trim() || !prazo)) agora.semInfo.push(r)

      if (noPeriodo(diaLocal(r.createdAt))) per.entraram.push(r)
      if (fechada && noPeriodo(diaQueEntrou(r))) {
        if (etapa === 'finalizado') per.finalizadas.push(r)
        else if (etapa === 'entrega') per.entregas.push(r)
        else per.vendas.push(r)
        if (etapa !== 'venda' && prazo) (diaQueEntrou(r) <= prazo ? per.noPrazo : per.foraDoPrazo).push(r)
      }
    }
    return { agora, per }
  }, [rows, etapaPorQuadro, hoje, noPeriodo])

  // Tabela por tipo: as 8 etiquetas na ordem cadastrada (mesmo zeradas) + tipos soltos que só existam nos cards + "Sem tipo".
  const porTipo = React.useMemo(() => {
    const nomes = tipos.map((t) => t.name)
    for (const r of [...d.per.entraram, ...d.per.finalizadas, ...d.per.entregas, ...d.per.vendas]) {
      if (r.tipo.trim() && !nomes.includes(r.tipo)) nomes.push(r.tipo)
    }
    const doTipo = (lista: LeadRow[], nome: string) => lista.filter((r) => (nome ? r.tipo === nome : !r.tipo.trim()))
    const linhas = [...nomes, ''].map((nome) => ({
      nome,
      cor: tipos.find((t) => t.name === nome)?.color ?? '#9CA3AF',
      entraram: doTipo(d.per.entraram, nome),
      finalizadas: doTipo(d.per.finalizadas, nome),
      entregas: doTipo(d.per.entregas, nome),
      vendas: doTipo(d.per.vendas, nome),
    }))
    // "Sem tipo" só aparece se tiver algum card nele.
    return linhas.filter((l) => l.nome || l.entraram.length + l.finalizadas.length + l.entregas.length + l.vendas.length > 0)
  }, [tipos, d.per])

  const porQuadro = React.useMemo(
    () => boards.map((b) => ({ id: b.id, nome: b.name, cor: b.color, cards: rows.filter((r) => r.boardId === b.id) })),
    [boards, rows],
  )

  const cardsAgora: StatCard[] = [
    { key: 'pendentes', icon: <ListTodo className="h-4 w-4" />, label: 'Demandas pendentes', tone: 'text-warning bg-warning/10', matches: d.agora.pendentes },
    { key: 'fazendo', icon: <PlayCircle className="h-4 w-4" />, label: 'Fazendo', tone: 'text-accent bg-accent/10', matches: d.agora.fazendo },
    { key: 'vencidas', icon: <AlertTriangle className="h-4 w-4" />, label: 'Passaram do "Finalizar até"', tone: 'text-danger bg-danger/10', matches: d.agora.vencidas },
    { key: 'sem-info', icon: <HelpCircle className="h-4 w-4" />, label: 'Sem info', tone: 'text-foreground/60 bg-elevate/[0.08]', matches: d.agora.semInfo },
  ]
  const comPrazo = d.per.noPrazo.length + d.per.foraDoPrazo.length
  const cardsPeriodo: StatCard[] = [
    { key: 'entraram', icon: <Inbox className="h-4 w-4" />, label: 'Demandas que entraram', tone: 'text-accent bg-accent/10', matches: d.per.entraram },
    { key: 'finalizadas', icon: <CheckCircle2 className="h-4 w-4" />, label: 'Finalizadas', tone: 'text-success bg-success/10', matches: d.per.finalizadas },
    ...(temQuadroDeEntrega ? [{ key: 'entregas', icon: <PackageCheck className="h-4 w-4" />, label: 'Entregas realizadas', tone: 'text-success bg-success/10', matches: d.per.entregas }] : []),
    ...(temQuadroDeVenda ? [{ key: 'vendas', icon: <ShoppingBag className="h-4 w-4" />, label: 'Vendas do mês', tone: 'text-warning bg-warning/10', matches: d.per.vendas }] : []),
    {
      key: 'prazo',
      icon: <Timer className="h-4 w-4" />,
      label: comPrazo > 0 ? `No prazo (${Math.round((d.per.noPrazo.length / comPrazo) * 100)}% de ${comPrazo})` : 'No prazo',
      tone: 'text-success bg-success/10',
      matches: d.per.noPrazo,
    },
  ]

  const rotuloPeriodo = from && to ? (from === to ? from.split('-').reverse().join('/') : `${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')}`) : 'todo o período'

  return (
    <div className="flex-1 space-y-4">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/40">Agora</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cardsAgora.map((c) => <TodayStatCard key={c.key} card={c} boards={boards} onOpenLead={onOpenLead} />)}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-card p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange className="h-4 w-4 shrink-0 text-foreground/40" />
          <Pill active={periodo === 'hoje'} onClick={() => setPeriodo('hoje')}>Hoje</Pill>
          <Pill active={periodo === 'mes'} onClick={() => setPeriodo('mes')}>Mês atual</Pill>
          <Pill active={periodo === 'mes_anterior'} onClick={() => setPeriodo('mes_anterior')}>Mês anterior</Pill>
          <Pill active={periodo === 'personalizado'} onClick={() => setPeriodo('personalizado')}>Personalizado</Pill>
        </div>
        {periodo === 'personalizado' && (
          <div className="flex flex-wrap items-end gap-2">
            <Input label="De" type="date" value={deCustom} onChange={(e) => setDeCustom(e.target.value)} containerClassName="w-36" />
            <Input label="Até" type="date" value={ateCustom} onChange={(e) => setAteCustom(e.target.value)} containerClassName="w-36" />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/40">No período · {rotuloPeriodo}</p>
        <div className={cn('grid grid-cols-2 gap-3', cardsPeriodo.length >= 5 ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
          {cardsPeriodo.map((c) => <TodayStatCard key={c.key} card={c} boards={boards} onOpenLead={onOpenLead} />)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Bloco icon={<Tags className="h-4 w-4" />} title="Por tipo, no período">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-[11px] text-foreground/45">
                    <th className="py-1.5 pr-2 font-medium">Tipo</th>
                    <th className="px-2 py-1.5 text-center font-medium">Entraram</th>
                    <th className="px-2 py-1.5 text-center font-medium">Finalizadas</th>
                    {temQuadroDeEntrega && <th className="px-2 py-1.5 text-center font-medium">Entregas</th>}
                    {temQuadroDeVenda && <th className="px-2 py-1.5 text-center font-medium">Vendas</th>}
                  </tr>
                </thead>
                <tbody>
                  {porTipo.map((l) => (
                    <tr key={l.nome || '—'} className="border-b border-line/60 last:border-0">
                      <td className="py-1.5 pr-2">
                        <span className="inline-flex items-center gap-2 font-medium text-foreground/75">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.cor }} />
                          {l.nome || 'Sem tipo'}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-center"><Numero matches={l.entraram} boards={boards} onOpenLead={onOpenLead} /></td>
                      <td className="px-2 py-1 text-center"><Numero matches={l.finalizadas} boards={boards} onOpenLead={onOpenLead} /></td>
                      {temQuadroDeEntrega && <td className="px-2 py-1 text-center"><Numero matches={l.entregas} boards={boards} onOpenLead={onOpenLead} /></td>}
                      {temQuadroDeVenda && <td className="px-2 py-1 text-center"><Numero matches={l.vendas} boards={boards} onOpenLead={onOpenLead} /></td>}
                    </tr>
                  ))}
                  <tr className="border-t border-line font-semibold">
                    <td className="py-1.5 pr-2 text-foreground/75">Total</td>
                    <td className="px-2 py-1 text-center"><Numero matches={d.per.entraram} boards={boards} onOpenLead={onOpenLead} /></td>
                    <td className="px-2 py-1 text-center"><Numero matches={d.per.finalizadas} boards={boards} onOpenLead={onOpenLead} /></td>
                    {temQuadroDeEntrega && <td className="px-2 py-1 text-center"><Numero matches={d.per.entregas} boards={boards} onOpenLead={onOpenLead} /></td>}
                    {temQuadroDeVenda && <td className="px-2 py-1 text-center"><Numero matches={d.per.vendas} boards={boards} onOpenLead={onOpenLead} /></td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </Bloco>
        </div>

        <Bloco icon={<LayoutGrid className="h-4 w-4" />} title="Por quadro, agora">
          <div className="space-y-1">
            {porQuadro.map((q) => (
              <div key={q.id} className="flex items-center gap-2.5 border-b border-line/60 pb-1 last:border-0 last:pb-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: q.cor }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/70" title={q.nome}>{q.nome}</span>
                <Numero matches={q.cards} boards={boards} onOpenLead={onOpenLead} />
              </div>
            ))}
          </div>
        </Bloco>
      </div>
    </div>
  )
}
