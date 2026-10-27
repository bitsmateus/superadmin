import * as React from 'react'
import { BarChart3, Calendar, LayoutGrid, PhoneCall, ShoppingBag, Tags, UserCheck, UserRound, Users } from 'lucide-react'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { useMonthFilter, withinBounds, addMonthsToId, currentMonthId } from '@/hooks/useMonthFilter'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { ClickableStat } from '@/components/comercial/ClickableStat'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { diaLocal } from '@/lib/diaLocal'
import { CANAIS_DE_AGENDAMENTO, agendadoEhOutro, textoDoAgendadoOutro } from '@/lib/regraDoStatus'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

/** Etiquetas de Status que "contam" pro funil do SDR — precisam bater com o texto exato
 * cadastrado em Status (ver server/src/routes/leadBoards.ts, MILESTONE_STATUSES). Exportadas pra
 * reuso no resumo por SDR do Dashboard Comercial (SdrSummaryPanel), que usa o mesmo critério. */
export const MILESTONE_NO_SHOW = 'Reunião não comparecida'
export const MILESTONE_VENDIDO = 'Vendido'

interface Bucket {
  key: string
  label: string
  color: string
  count: number
}

function BarList({ icon, title, buckets, total }: { icon: React.ReactNode; title: string; buckets: Bucket[]; total: number }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">{icon}</span>
        {title}
      </div>
      {buckets.length === 0 ? (
        <p className="py-4 text-center text-xs text-foreground/40">Sem dados pra mostrar.</p>
      ) : (
        <div className="space-y-2">
          {buckets.map((b) => (
            <div key={b.key} className="flex items-center gap-2.5 border-b border-line/60 pb-2 last:border-0 last:pb-0">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/70" title={b.label}>
                {b.label}
              </span>
              <span className="shrink-0 text-xs font-semibold text-foreground/70">
                {b.count} {total > 0 ? `(${Math.round((b.count / total) * 100)}%)` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-foreground/40">{label}</p>
        <p className="truncate text-lg font-bold text-foreground">{value}</p>
      </div>
    </div>
  )
}

interface SdrMetrics {
  sdr: string
  color: string
  total: number
  agendados: number
  noShow: number
  /** Reuniões que comprovadamente aconteceram (o lead seguiu pra proposta/follow-up/venda). */
  compareceu: number
  vendas: number
  pctAgendamento: number
  pctComparecimento: number
  pctAgendamentoVenda: number
  totalRows: LeadRow[]
  agendadosRows: LeadRow[]
  noShowRows: LeadRow[]
  compareceuRows: LeadRow[]
  vendasRows: LeadRow[]
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function RingStat({
  icon,
  label,
  color,
  of,
  ratio,
  matches,
  boards,
  onOpenLead,
}: {
  icon: React.ReactNode
  label: string
  color: string
  of: number
  ratio: number
  matches: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
}) {
  const count = matches.length
  const deg = Math.max(0, Math.min(1, ratio)) * 360
  return (
    <ClickableStat matches={matches} boards={boards} onOpenLead={onOpenLead}>
      {(onClick, ref) => (
        <button
          ref={ref}
          type="button"
          onClick={onClick}
          disabled={count === 0}
          className={cn(
            'flex flex-col items-center gap-2 rounded-xl bg-elevate/[0.05] px-2 py-3 transition-opacity',
            count > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
          )}
        >
          <div
            className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full"
            style={{ background: `conic-gradient(${color} ${deg}deg, #E5E7EB 0deg)` }}
          >
            <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-card">
              <span className="text-sm font-bold" style={{ color }}>{pct(ratio)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-foreground/70">
            <span style={{ color }}>{icon}</span>
            {label}
          </div>
          <div className="text-[10px] text-foreground/40">{count} de {Math.max(of, count)}</div>
        </button>
      )}
    </ClickableStat>
  )
}

function SdrCard({ metrics, boards, onOpenLead }: { metrics: SdrMetrics; boards: LeadBoard[]; onOpenLead: (id: string) => void }) {
  const m = metrics
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: m.color }}
        >
          {initials(m.sdr)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{m.sdr}</p>
          <p className="text-[11px] text-foreground/40">{m.total} lead{m.total === 1 ? '' : 's'} no total</p>
        </div>
        <ClickableStat matches={m.totalRows} boards={boards} onOpenLead={onOpenLead}>
          {(onClick, ref) => (
            <button
              ref={ref}
              type="button"
              onClick={onClick}
              disabled={m.total === 0}
              className={cn(
                'shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent transition-opacity',
                m.total > 0 ? 'cursor-pointer hover:opacity-70' : 'cursor-default',
              )}
            >
              {m.total}
            </button>
          )}
        </ClickableStat>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <RingStat icon={<Calendar className="h-3 w-3" />} label="Agendada" color="#4F8EF7" of={m.total} ratio={m.pctAgendamento} matches={m.agendadosRows} boards={boards} onOpenLead={onOpenLead} />
        <RingStat icon={<UserCheck className="h-3 w-3" />} label="Comparecimento" color="#06B6D4" of={m.compareceu + m.noShow} ratio={m.pctComparecimento} matches={m.compareceuRows} boards={boards} onOpenLead={onOpenLead} />
        <RingStat icon={<ShoppingBag className="h-3 w-3" />} label="Venda" color="#22C55E" of={m.agendados} ratio={m.pctAgendamentoVenda} matches={m.vendasRows} boards={boards} onOpenLead={onOpenLead} />
      </div>
    </div>
  )
}

function MetricCell({ value, sub }: { value: React.ReactNode; sub?: string }) {
  return (
    <td className="px-3 py-2.5 text-center">
      <div className="text-sm font-semibold text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-foreground/40">{sub}</div>}
    </td>
  )
}

function SdrMetricsTable({ bySdr, title = 'Métricas por SDR' }: { bySdr: SdrMetrics[]; title?: string }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <UserRound className="h-4 w-4" />
        </span>
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold text-foreground/50">
              <th className="px-3 py-2">SDR</th>
              <th className="px-3 py-2 text-center">Total de leads</th>
              <th className="px-3 py-2 text-center">Reunião agendada</th>
              <th className="px-3 py-2 text-center">% de agendamento</th>
              <th className="px-3 py-2 text-center">Reunião não comparecida</th>
              <th className="px-3 py-2 text-center">% de comparecimento</th>
              <th className="px-3 py-2 text-center">Total de vendas</th>
              <th className="px-3 py-2 text-center">% agend. p/ venda</th>
            </tr>
          </thead>
          <tbody>
            {bySdr.map((m) => (
              <tr key={m.sdr} className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground/70">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
                    {m.sdr}
                  </span>
                </td>
                <MetricCell value={m.total} />
                <MetricCell value={m.agendados} />
                <MetricCell value={pct(m.pctAgendamento)} />
                <MetricCell value={m.noShow} />
                <MetricCell value={pct(m.pctComparecimento)} />
                <MetricCell value={m.vendas} />
                <MetricCell value={pct(m.pctAgendamentoVenda)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type PeriodoCanal = 'hoje' | 'ontem' | '7dias' | 'mes' | 'personalizado'

/** Dia local (AAAA-MM-DD) deslocado em `dias` a partir de hoje. */
function diaDeHoje(dias = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const NAO_INFORMADO = 'Não informado'
const CANAL_DA_LUIZA = 'WhatsApp Comercial'

/**
 * AGENDAMENTOS POR CANAL — quantas reuniões foram marcadas no período e por onde (o campo "Agendado por" que o SDR
 * preenche ao agendar). Conta no dia em que a reunião foi marcada pela primeira vez, igual ao "Dia a dia".
 * Agendamento sem o campo preenchido (os de antes do campo existir) aparece em "Não informado".
 */
function AgendamentosPorCanal({
  rows, boards, onOpenLead, bounds, milestoneById,
}: {
  rows: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  bounds: { from: string; to: string }
  milestoneById: Map<string, { firstAgendadaAt: string | null; firstAgendadaBy?: string | null }>
}) {
  const [periodo, setPeriodo] = React.useState<PeriodoCanal>('hoje')
  const [de, setDe] = React.useState(() => diaDeHoje(-6))
  const [ate, setAte] = React.useState(() => diaDeHoje())

  const faixa = React.useMemo(() => {
    if (periodo === 'hoje') return { from: diaDeHoje(), to: diaDeHoje() }
    if (periodo === 'ontem') return { from: diaDeHoje(-1), to: diaDeHoje(-1) }
    if (periodo === '7dias') return { from: diaDeHoje(-6), to: diaDeHoje() }
    if (periodo === 'mes') return bounds
    return de <= ate ? { from: de, to: ate } : { from: ate, to: de }
  }, [periodo, bounds, de, ate])

  const { porCanal, porQuem, total, textosOutro } = React.useMemo(() => {
    const mapa = new Map<string, LeadRow[]>()
    for (const c of [...CANAIS_DE_AGENDAMENTO, NAO_INFORMADO]) mapa.set(c, [])
    // Quem marcou: o autor da 1ª mudança pra "Reunião agendada". Os dois SDRs e a IA Luiza; o resto vai em "Outros".
    const quem = new Map<string, LeadRow[]>([['SDR Arthur', []], ['SDR Luis', []], ['IA Luiza', []]])
    const textos: string[] = []
    let n = 0
    for (const r of rows) {
      const quando = milestoneById.get(r.id)?.firstAgendadaAt
      if (!quando) continue
      const dia = diaLocal(quando)
      if (dia < faixa.from || dia > faixa.to) continue
      const autor = milestoneById.get(r.id)?.firstAgendadaBy ?? ''
      // SDR "IA Luiza" = marcado como agendado pela IA (mesmo que quem clicou tenha sido o SDR).
      const pessoa = /luiza/i.test(autor) || /luiza/i.test(r.sdr ?? '') ? 'IA Luiza' : /arthur/i.test(autor) ? 'SDR Arthur' : /lu[ií]s/i.test(autor) ? 'SDR Luis' : autor ? 'Outros' : NAO_INFORMADO
      // Toda reunião que a IA Luiza agenda é pelo WhatsApp Comercial: sem o "Agendado por", conta lá.
      const v = (r.agendadoPor ?? '').trim() || (pessoa === 'IA Luiza' ? CANAL_DA_LUIZA : '')
      const canal = !v ? NAO_INFORMADO
        : agendadoEhOutro(v) ? 'Outro'
        : (CANAIS_DE_AGENDAMENTO as readonly string[]).includes(v) ? v : 'Outro'
      if (canal === 'Outro') textos.push(`${textoDoAgendadoOutro(v) || v} (${r.nome || r.empresa || 'sem nome'})`)
      mapa.get(canal)!.push(r)
      quem.set(pessoa, [...(quem.get(pessoa) ?? []), r])
      n++
    }
    return { porCanal: mapa, porQuem: quem, total: n, textosOutro: textos }
  }, [rows, milestoneById, faixa])

  const maior = Math.max(1, ...Array.from(porCanal.values()).map((l) => l.length))
  const rotuloDoPeriodo = periodo === 'hoje' ? 'Hoje' : periodo === 'ontem' ? 'Ontem' : periodo === '7dias' ? 'Últimos 7 dias'
    : periodo === 'mes' ? 'Mês selecionado' : 'Período'
  const opcoes: { id: PeriodoCanal; rotulo: string }[] = [
    { id: 'hoje', rotulo: 'Hoje' }, { id: 'ontem', rotulo: 'Ontem' }, { id: '7dias', rotulo: '7 dias' },
    { id: 'mes', rotulo: 'Mês' }, { id: 'personalizado', rotulo: 'Personalizado' },
  ]

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PhoneCall className="h-4 w-4 text-accent" /> Agendamentos por canal
          </p>
          <p className="mt-0.5 text-xs text-foreground/45">Por onde as reuniões foram marcadas (o campo "Agendado por" do lead) e por quem.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {opcoes.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setPeriodo(o.id)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                periodo === o.id ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/55 hover:bg-elevate/[0.05]',
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>
      {periodo === 'personalizado' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-xs text-foreground/60">
          de
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent" />
          até
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent" />
        </div>
      )}
      <div className="px-4 py-3">
        <p className="mb-3 text-sm text-foreground/70">
          <span className="text-xs uppercase tracking-wide text-foreground/45">{rotuloDoPeriodo}</span>
          <span className="ml-2 text-2xl font-bold tabular-nums text-foreground">{total}</span>
          <span className="ml-1.5">{total === 1 ? 'agendado' : 'agendados'}</span>
        </p>
        <ul className="space-y-1.5">
          {Array.from(porCanal.entries())
            // Do canal que mais agendou pro que menos; "Não informado" sempre por último.
            .sort((x, y) => (x[0] === NAO_INFORMADO ? 1 : 0) - (y[0] === NAO_INFORMADO ? 1 : 0) || y[1].length - x[1].length)
            .map(([canal, lista]) => {
            const n = lista.length
            const pct = total > 0 ? Math.round((n / total) * 100) : 0
            return (
              <li key={canal} className={cn('grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[180px_1fr_88px]', n === 0 && 'text-foreground/35')}>
                <span title={canal} className={cn('truncate', canal === NAO_INFORMADO && 'italic')}>{canal}</span>
                <span className="h-2 overflow-hidden rounded-full bg-elevate/[0.06]">
                  <span
                    className={cn('block h-full rounded-full', canal === NAO_INFORMADO ? 'bg-foreground/25' : 'bg-accent')}
                    style={{ width: `${n === 0 ? 0 : Math.max(3, (n / maior) * 100)}%` }}
                  />
                </span>
                <span className="flex items-center justify-end gap-2 tabular-nums">
                  {n === 0 ? (
                    <span>0</span>
                  ) : (
                    <ClickableStat matches={lista} boards={boards} onOpenLead={onOpenLead}>
                      {(onClick, ref) => (
                        <button ref={ref} type="button" onClick={onClick} title="Ver quem é" className="rounded px-1.5 font-semibold text-foreground hover:bg-elevate/[0.08]">
                          {n}
                        </button>
                      )}
                    </ClickableStat>
                  )}
                  <span className="w-9 text-right text-xs text-foreground/45">{n > 0 ? `${pct}%` : ''}</span>
                </span>
              </li>
            )
          })}
        </ul>
        {textosOutro.length > 0 && (
          <div className="mt-3 rounded-lg bg-elevate/[0.03] px-3 py-2 text-xs text-foreground/60">
            <span className="font-medium text-foreground/75">Em "Outro" escreveram:</span> {textosOutro.join(' · ')}
          </div>
        )}

        <p className="mb-2 mt-5 border-t border-line pt-3 text-xs font-semibold uppercase tracking-wide text-foreground/50">Por quem agendou</p>
        <ul className="space-y-1.5">
          {Array.from(porQuem.entries())
            // Os dois SDRs e a IA Luiza sempre aparecem; "Outros" e "Não informado" só quando tiver alguém.
            .filter(([p, l]) => p === 'SDR Arthur' || p === 'SDR Luis' || p === 'IA Luiza' || l.length > 0)
            .map(([pessoa, lista]) => {
              const n = lista.length
              const pct = total > 0 ? Math.round((n / total) * 100) : 0
              return (
                <li key={pessoa} className={cn('grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[180px_1fr_88px]', n === 0 && 'text-foreground/35')}>
                  <span className={cn('truncate', pessoa === NAO_INFORMADO && 'italic')}>{pessoa}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-elevate/[0.06]">
                    <span className={cn('block h-full rounded-full', pessoa === NAO_INFORMADO || pessoa === 'Outros' ? 'bg-foreground/25' : 'bg-accent')}
                      style={{ width: `${n === 0 ? 0 : Math.max(3, (n / Math.max(1, total)) * 100)}%` }} />
                  </span>
                  <span className="flex items-center justify-end gap-2 tabular-nums">
                    {n === 0 ? <span>0</span> : (
                      <ClickableStat matches={lista} boards={boards} onOpenLead={onOpenLead}>
                        {(onClick, ref) => (
                          <button ref={ref} type="button" onClick={onClick} title="Ver quem é" className="rounded px-1.5 font-semibold text-foreground hover:bg-elevate/[0.08]">{n}</button>
                        )}
                      </ClickableStat>
                    )}
                    <span className="w-9 text-right text-xs text-foreground/45">{n > 0 ? `${pct}%` : ''}</span>
                  </span>
                </li>
              )
            })}
        </ul>
      </div>
    </div>
  )
}

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/**
 * DIA A DIA — uma linha por dia do período, como numa planilha. Aqui cada coisa conta no dia em que ACONTECEU:
 * o lead no dia em que entrou, o agendamento no dia em que a reunião foi marcada (o primeiro — reagendar não conta
 * de novo), a falta e a venda no dia em que o lead virou "não compareceu" / "Vendido". Por isso a soma pode ser
 * diferente da tabela de cima, que acompanha só a leva de leads que entrou no período.
 */
function MetricasPorDia({
  rows, boards, onOpenLead, bounds, milestoneById,
}: {
  rows: LeadRow[]
  boards: LeadBoard[]
  onOpenLead: (id: string) => void
  bounds: { from: string; to: string }
  milestoneById: Map<string, { milestone: string | null; milestoneAt: string | null; firstAgendadaAt: string | null }>
}) {
  const hoje = diaLocal(new Date().toISOString())
  const dias = React.useMemo(() => {
    const fim = bounds.to && bounds.to < hoje ? bounds.to : hoje
    const lista: string[] = []
    if (!bounds.from) return lista
    const [y, m, d] = bounds.from.split('-').map(Number)
    for (let data = new Date(y, m - 1, d); lista.length < 400; data.setDate(data.getDate() + 1)) {
      const iso = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
      if (iso > fim) break
      lista.push(iso)
    }
    return lista
  }, [bounds.from, bounds.to, hoje])

  const porDia = React.useMemo(() => {
    const mapa = new Map<string, { leads: LeadRow[]; agendados: LeadRow[]; noShow: LeadRow[]; vendas: LeadRow[] }>()
    for (const dia of dias) mapa.set(dia, { leads: [], agendados: [], noShow: [], vendas: [] })
    const no = (iso: string | null | undefined) => (iso ? mapa.get(diaLocal(iso)) : undefined)
    for (const r of rows) {
      no(r.createdAt)?.leads.push(r)
      const info = milestoneById.get(r.id)
      if (!info) continue
      no(info.firstAgendadaAt)?.agendados.push(r)
      if (info.milestone === MILESTONE_NO_SHOW) no(info.milestoneAt)?.noShow.push(r)
      else if (info.milestone === MILESTONE_VENDIDO) no(info.milestoneAt)?.vendas.push(r)
    }
    return mapa
  }, [rows, milestoneById, dias])

  const total = React.useMemo(() => {
    const t = { leads: 0, agendados: 0, noShow: 0, vendas: 0 }
    for (const v of porDia.values()) {
      t.leads += v.leads.length; t.agendados += v.agendados.length; t.noShow += v.noShow.length; t.vendas += v.vendas.length
    }
    return t
  }, [porDia])

  if (dias.length === 0) return null

  const celula = (lista: LeadRow[], cor: string) =>
    lista.length === 0 ? (
      <span className="text-foreground/25">0</span>
    ) : (
      <ClickableStat matches={lista} boards={boards} onOpenLead={onOpenLead}>
        {(onClick, ref) => (
          <button
            ref={ref}
            type="button"
            onClick={onClick}
            title="Ver quem é"
            className={cn('min-w-[2rem] rounded-md px-2 py-0.5 font-semibold tabular-nums transition-colors hover:bg-elevate/[0.08]', cor)}
          >
            {lista.length}
          </button>
        )}
      </ClickableStat>
    )

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calendar className="h-4 w-4 text-accent" /> Dia a dia
        </p>
        <p className="mt-0.5 text-xs text-foreground/45">
          Cada número conta no dia em que aconteceu (o lead no dia em que entrou, o agendamento no dia em que foi marcado, a
          falta e a venda no dia do desfecho). Clique num número pra ver quem é.
        </p>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2.5">Dia</th>
              <th className="px-3 py-2.5 text-center">Leads que entraram</th>
              <th className="px-3 py-2.5 text-center">Agendamentos</th>
              <th className="px-3 py-2.5 text-center">Não compareceu</th>
              <th className="px-3 py-2.5 text-center">Vendas</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((dia) => {
              const v = porDia.get(dia)!
              const [y, m, d] = dia.split('-').map(Number)
              const semana = DIAS_DA_SEMANA[new Date(y, m - 1, d).getDay()]
              const fimDeSemana = semana === 'sáb' || semana === 'dom'
              const vazio = v.leads.length + v.agendados.length + v.noShow.length + v.vendas.length === 0
              return (
                <tr
                  key={dia}
                  className={cn(
                    'border-b border-line/60 last:border-0',
                    dia === hoje ? 'bg-accent/[0.06]' : fimDeSemana && 'bg-elevate/[0.025]',
                    vazio && 'text-foreground/40',
                  )}
                >
                  <td className="whitespace-nowrap px-4 py-1.5 tabular-nums">
                    <span className="font-medium text-foreground">{String(d).padStart(2, '0')}/{String(m).padStart(2, '0')}</span>
                    <span className="ml-1.5 text-xs text-foreground/45">{semana}</span>
                    {dia === hoje && <span className="ml-1.5 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">hoje</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">{celula(v.leads, 'text-foreground')}</td>
                  <td className="px-3 py-1.5 text-center">{celula(v.agendados, 'text-accent')}</td>
                  <td className="px-3 py-1.5 text-center">{celula(v.noShow, 'text-warning')}</td>
                  <td className="px-3 py-1.5 text-center">{celula(v.vendas, 'text-success')}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="sticky bottom-0 bg-card">
            <tr className="border-t-2 border-line text-sm font-semibold text-foreground">
              <td className="px-4 py-2.5">Total do período</td>
              <td className="px-3 py-2.5 text-center tabular-nums">{total.leads}</td>
              <td className="px-3 py-2.5 text-center tabular-nums text-accent">{total.agendados}</td>
              <td className="px-3 py-2.5 text-center tabular-nums text-warning">{total.noShow}</td>
              <td className="px-3 py-2.5 text-center tabular-nums text-success">{total.vendas}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/** Métricas por SDR. "Reunião agendada" conta todo lead que JÁ passou por esse marco em algum
 * momento (mesmo se hoje já virou Vendido/No-show) — é o denominador do funil. "No-show" e
 * "Vendas" usam sempre o marco mais recente da linha do tempo de cada lead, não o status literal
 * atual, pra não contar duas vezes reagendamentos. */
export function SdrMetricsGrid({
  rows, boards, onOpenLead, title, mostrarPorDia = false,
}: {
  rows: LeadRow[]; boards: LeadBoard[]; onOpenLead: (id: string) => void; title?: string
  /** CRM do SDR (Arthur/Luis): acrescenta a tabela "Dia a dia" embaixo. */
  mostrarPorDia?: boolean
}) {
  const milestones = useLeadMilestones()
  const sdrLabels = useLeadLabels('sdr')
  const milestoneById = React.useMemo(
    () => new Map(milestones.map((m) => [
      m.id, {
        milestone: m.milestone, everAgendada: m.everAgendada, everCompareceu: m.everCompareceu,
        milestoneAt: m.milestoneAt, firstAgendadaAt: m.firstAgendadaAt, firstAgendadaBy: m.firstAgendadaBy,
      },
    ])),
    [milestones],
  )
  // Nasce com o mês atual e o anterior já como pills (além de "Personalizado") — os dois recortes
  // mais pedidos num painel de performance, sem precisar clicar em nada pra ver o mês passado.
  const monthFilter = useMonthFilter(React.useMemo(() => [addMonthsToId(currentMonthId(), -1)], []))

  const bySdr = React.useMemo<SdrMetrics[]>(() => {
    const bounds = monthFilter.bounds
    const buckets = new Map<string, {
      totalRows: LeadRow[]; agendadosRows: LeadRow[]; noShowRows: LeadRow[]
      compareceuRows: LeadRow[]; vendasRows: LeadRow[]
    }>()
    for (const r of rows) {
      // O período filtra a LEVA de leads (quem nasceu nesse mês) — não cada marco individualmente.
      // Uma vez que o lead entrou na leva do mês, ele carrega o funil inteiro dali: se agendou, fica
      // contado em "Agendada" pra sempre, não importa se depois virou Vendido/No-show/qualquer outro
      // status — mudar a etiqueta não tira ele da contagem de quem já agendou.
      if (!withinBounds(r.createdAt, bounds)) continue
      const name = r.sdr || 'Sem SDR'
      const b = buckets.get(name) ?? { totalRows: [], agendadosRows: [], noShowRows: [], compareceuRows: [], vendasRows: [] }
      const info = milestoneById.get(r.id)
      b.totalRows.push(r)
      if (info?.everAgendada) b.agendadosRows.push(r)
      // Comparecimento vive DENTRO de quem agendou: quem foi direto pra proposta, sem reunião
      // marcada, não entra nem no denominador nem aqui.
      if (info?.everAgendada && info?.everCompareceu) b.compareceuRows.push(r)
      if (info?.milestone === MILESTONE_NO_SHOW) b.noShowRows.push(r)
      else if (info?.milestone === MILESTONE_VENDIDO) b.vendasRows.push(r)
      buckets.set(name, b)
    }
    return Array.from(buckets.entries())
      .map(([name, b]) => {
        // Comparecimento é medido pela PROVA de que a reunião aconteceu (o lead seguiu pra
        // proposta/follow-up/venda), e a taxa sai sobre as reuniões que já tiveram desfecho —
        // compareceu + não compareceu. Quem ainda está só "Reunião agendada" fica de fora da
        // conta: a reunião pode estar marcada pra frente, e contar como falta punia o SDR por
        // uma reunião que nem chegou a acontecer.
        const compareceuRows = b.compareceuRows
        const comDesfecho = compareceuRows.length + b.noShowRows.length
        return {
          sdr: name,
          color: sdrLabels.find((l) => l.name === name)?.color ?? '#9CA3AF',
          total: b.totalRows.length,
          agendados: b.agendadosRows.length,
          noShow: b.noShowRows.length,
          compareceu: compareceuRows.length,
          vendas: b.vendasRows.length,
          pctAgendamento: b.totalRows.length > 0 ? b.agendadosRows.length / b.totalRows.length : 0,
          pctComparecimento: comDesfecho > 0 ? compareceuRows.length / comDesfecho : 0,
          pctAgendamentoVenda: b.agendadosRows.length > 0 ? b.vendasRows.length / b.agendadosRows.length : (b.vendasRows.length > 0 ? 1 : 0),
          totalRows: b.totalRows,
          agendadosRows: b.agendadosRows,
          noShowRows: b.noShowRows,
          compareceuRows,
          vendasRows: b.vendasRows,
        }
      })
      .sort((a, b) => b.total - a.total)
  }, [rows, milestoneById, sdrLabels, monthFilter.bounds])

  if (bySdr.length === 0) {
    return (
      <div className="space-y-4">
        <MonthFilterBar filter={monthFilter} />
        <div className="rounded-2xl bg-card p-6 shadow-sm sm:p-8">
          <p className="text-center text-xs text-foreground/40">Sem dados nesse período.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <MonthFilterBar filter={monthFilter} />
      <SdrMetricsTable bySdr={bySdr} title={title} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {bySdr.map((m) => <SdrCard key={m.sdr} metrics={m} boards={boards} onOpenLead={onOpenLead} />)}
      </div>
      {mostrarPorDia && (
        <>
          <AgendamentosPorCanal rows={rows} boards={boards} onOpenLead={onOpenLead} bounds={monthFilter.bounds} milestoneById={milestoneById} />
          <MetricasPorDia rows={rows} boards={boards} onOpenLead={onOpenLead} bounds={monthFilter.bounds} milestoneById={milestoneById} />
        </>
      )}
    </div>
  )
}

export interface LeadDashboardViewProps {
  rows: LeadRow[]
  boards: LeadBoard[]
  /** Abre o lead ao clicar num número das Métricas por SDR (Agendada/No-show/Venda/total). */
  onOpenLead: (id: string) => void
  /** Rótulo da 2ª aba — "Dashboard do SDR" por padrão (Novos Leads, com os 2 SDRs juntos).
   * CRM NX Luis/Arthur passam "Minhas métricas" porque ali só existe o SDR dono da aba. */
  sdrTabLabel?: string
  /** Numa aba travada num SDR só, o "Dashboard geral" (leads por quadro/status/dia de contato de
   * TODOS os SDRs) não faz sentido — some o alternador de abas e mostra só "Minhas métricas". */
  onlySdr?: boolean
}

/** Painel só de visualização — nada aqui é editável, é resumo de leitura dos leads filtrados. */
export function LeadDashboardView({ rows, boards, onOpenLead, sdrTabLabel = 'Dashboard do SDR', onlySdr = false }: LeadDashboardViewProps) {
  const [subView, setSubView] = React.useState<'geral' | 'sdr'>(onlySdr ? 'sdr' : 'geral')
  // boards já vem filtrado pra UMA aba só (chamado de dentro de LeadBoardsView).
  const pageId = boards[0]?.page
  const statusLabels = useLeadLabels('status', pageId)
  const diaContatoLabels = useLeadLabels('diaContato', pageId)

  const totalLeads = rows.length
  const totalMrr = React.useMemo(() => rows.reduce((sum, r) => sum + parseBRLCents(r.valorMrr), 0), [rows])
  const totalImplementacao = React.useMemo(
    () => rows.reduce((sum, r) => sum + parseBRLCents(r.valorImplementacao), 0),
    [rows],
  )

  const byBoard = React.useMemo<Bucket[]>(() => {
    return boards
      .map((b) => ({
        key: b.id,
        label: b.name,
        color: b.color,
        count: rows.filter((r) => r.boardId === b.id).length,
      }))
      .sort((a, b) => b.count - a.count)
  }, [rows, boards])

  // Sempre mostra TODAS as etiquetas cadastradas (mesmo com 0 leads), não só as que já têm
  // lead — igual "Leads por quadro" já fazia. Mantém a ordem cadastrada (1º Dia, 2º Dia...),
  // não reordena por quantidade. "Sem status"/"Sem dia de contato" só aparece se tiver algum
  // lead de fato sem essa etiqueta preenchida, e fica sempre por último.
  const byStatus = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.status || '—', (counts.get(r.status || '—') ?? 0) + 1)
    const items: Bucket[] = statusLabels.map((l) => ({
      key: l.name, label: l.name, color: l.color, count: counts.get(l.name) ?? 0,
    }))
    const blank = counts.get('—') ?? 0
    if (blank > 0) items.push({ key: '—', label: 'Sem status', color: '#9CA3AF', count: blank })
    return items
  }, [rows, statusLabels])

  const byDiaContato = React.useMemo<Bucket[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows) counts.set(r.diaContato || '—', (counts.get(r.diaContato || '—') ?? 0) + 1)
    const items: Bucket[] = diaContatoLabels.map((l) => ({
      key: l.name, label: l.name, color: l.color, count: counts.get(l.name) ?? 0,
    }))
    const blank = counts.get('—') ?? 0
    if (blank > 0) items.push({ key: '—', label: 'Sem dia de contato', color: '#9CA3AF', count: blank })
    return items
  }, [rows, diaContatoLabels])

  return (
    <div className={cn('flex-1 space-y-4')}>
      {!onlySdr && (
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setSubView('geral')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              subView === 'geral' ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Dashboard geral
          </button>
          <button
            type="button"
            onClick={() => setSubView('sdr')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              subView === 'sdr' ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
            )}
          >
            <UserRound className="h-3.5 w-3.5" />
            {sdrTabLabel}
          </button>
        </div>
      )}

      {(onlySdr || subView === 'sdr') ? (
        <SdrMetricsGrid rows={rows} boards={boards} onOpenLead={onOpenLead} mostrarPorDia={onlySdr} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard icon={<Users className="h-5 w-5" />} label="Total de leads" value={String(totalLeads)} />
            <SummaryCard icon={<BarChart3 className="h-5 w-5" />} label="Valor MRR (total)" value={formatBRLCents(totalMrr)} />
            <SummaryCard icon={<BarChart3 className="h-5 w-5" />} label="Valor Implementação (total)" value={formatBRLCents(totalImplementacao)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarList icon={<LayoutGrid className="h-4 w-4" />} title="Leads por quadro" buckets={byBoard} total={totalLeads} />
            <BarList icon={<Tags className="h-4 w-4" />} title="Leads por status" buckets={byStatus} total={totalLeads} />
            <BarList icon={<Tags className="h-4 w-4" />} title="Leads por dia de contato" buckets={byDiaContato} total={totalLeads} />
          </div>
        </>
      )}
    </div>
  )
}
