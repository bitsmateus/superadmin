import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, TrendingUp } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { MILESTONE_NO_SHOW, MILESTONE_VENDIDO } from '@/components/comercial/LeadDashboardView'
import { useAllLeadRows, useLeadBoards, useLeadBoardsBooted } from '@/hooks/useLeadBoards'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { useCommercialMonths, useCommercialMonthsLoaded } from '@/hooks/useCommercialMonths'
import { commercialMonthsService } from '@/services/commercialMonths'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function currentMonthId(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function addMonths(id: string, n: number): string {
  const [y, m] = id.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return `${MONTH_NAMES[m - 1] ?? id}/${y}`
}
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function monthBounds(id: string): { from: string; to: string } {
  const [y, m] = id.split('-').map(Number)
  return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) }
}

function money(cents: number): string { return formatBRLCents(Math.round(cents)) }
function pct(ratio: number): string { return `${(ratio * 100).toFixed(1)}%` }
function mult(ratio: number): string { return `${ratio.toFixed(1)}x` }
function meses(n: number): string { return `${n.toFixed(1)} ${n === 1 ? 'mês' : 'meses'}` }

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="mb-2 text-sm font-semibold text-foreground">{title}</div>
      <div className="divide-y divide-line/60">{children}</div>
    </div>
  )
}

function MetricRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 text-foreground/50">
        {label}
        {hint && <span className="ml-1.5 text-[11px] text-foreground/30">{hint}</span>}
      </span>
      <span className="shrink-0 font-semibold text-foreground">{value}</span>
    </div>
  )
}

function ManualCurrencyRow({ label, value, onSave }: { label: string; value: string; onSave: (next: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-foreground/50">{label}</span>
      <div className="w-36 shrink-0 rounded-lg bg-warning/10 ring-1 ring-warning/20">
        <CurrencyField value={value} onSave={onSave} className="h-9 rounded-lg bg-transparent px-3 text-right font-semibold text-warning" />
      </div>
    </div>
  )
}

function ManualNumberRow({ label, value, onSave, step }: { label: string; value: number; onSave: (next: number) => void; step?: number }) {
  const [local, setLocal] = React.useState(String(value))
  React.useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-foreground/50">{label}</span>
      <input
        type="number"
        step={step ?? 1}
        min={0}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          const n = Number(local.replace(',', '.'))
          const safe = Number.isFinite(n) && n >= 0 ? n : 0
          setLocal(String(safe))
          if (safe !== value) onSave(safe)
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-9 w-28 shrink-0 rounded-lg bg-warning/10 px-3 text-right font-semibold text-warning outline-none ring-1 ring-warning/20"
      />
    </div>
  )
}

/** Painel do mês (Marketing & Comercial) — um "instantâneo" mensal do funil + ROI, no mesmo estilo
 * da planilha que o usuário já usa: só 3 campos manuais (investimento, leads gerados, permanência
 * média), o resto calculado ao vivo em cima do que já existe no CRM (agendamentos via campo
 * `agendamento`/milestones) e em Vendas (MRR/Implementação). Cada mês é um registro próprio — ao
 * fechar o mês o usuário clica "Adicionar mês" e começa um novo, zerado nos campos manuais. */
export function PainelMensalPage() {
  const boardsBooted = useLeadBoardsBooted()
  const monthsLoaded = useCommercialMonthsLoaded()
  const booted = boardsBooted && monthsLoaded

  const boards = useLeadBoards()
  const allRows = useAllLeadRows()
  const milestones = useLeadMilestones()
  const months = useCommercialMonths()

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!selectedId && months.length) setSelectedId(months[0].id)
  }, [months, selectedId])

  const nextId = months.length ? addMonths(months[0].id, 1) : currentMonthId()

  const handleAddMonth = async () => {
    const created = await commercialMonthsService.create(nextId)
    setSelectedId(created.id)
  }

  const month = months.find((m) => m.id === selectedId) ?? null

  const milestoneById = React.useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones])
  const vendasBoard = React.useMemo(() => boards.find((b) => b.isVendas), [boards])

  const stats = React.useMemo(() => {
    if (!month) return null
    const { from, to } = monthBounds(month.id)
    const todayIso = toISODate(new Date())
    const untilIso = to < todayIso ? to : todayIso

    // Leva do mês = quem foi CRIADO nesse período (mesma lógica das Métricas por SDR — soma
    // todas as abas/SDRs juntos, sem filtro nenhum por CRM). "Agendamentos" é por STATUS (chegou
    // em "Reunião agendada" ou etapa seguinte, alguma vez), não pela data marcada no campo
    // Agendamento — evita divergir do que já aparece em Métricas por SDR pro mesmo período.
    const monthCohort = allRows.filter((r) => {
      const d = r.createdAt.slice(0, 10)
      return d >= from && d <= to
    })
    const agendadosTotal = monthCohort.filter((r) => milestoneById.get(r.id)?.everAgendada)
    const agendadosAteHoje = agendadosTotal.filter((r) => {
      const d = milestoneById.get(r.id)?.firstAgendadaAt?.slice(0, 10)
      return !!d && d <= untilIso
    })
    const noShowAteHoje = agendadosAteHoje.filter((r) => milestoneById.get(r.id)?.milestone === MILESTONE_NO_SHOW)
    const comparecimentos = agendadosAteHoje.length - noShowAteHoje.length
    const vendasFechadas = monthCohort.filter((r) => milestoneById.get(r.id)?.milestone === MILESTONE_VENDIDO)

    const vendasRows = vendasBoard
      ? allRows.filter((r) => r.boardId === vendasBoard.id && !r.vendaRevertida)
      : []
    const vendasNoMes = vendasRows.filter((r) => {
      const d = (r.fechamento || r.createdAt).slice(0, 10)
      return d >= from && d <= to
    })

    const investimentoCents = parseBRLCents(month.investimentoTrafego)
    const leadsGerados = month.leadsGerados
    const permanencia = month.permanenciaMedia

    const mrrTotalCents = vendasNoMes.reduce((s, r) => s + parseBRLCents(r.valorMrr), 0)
    const implTotalCents = vendasNoMes.reduce((s, r) => s + parseBRLCents(r.valorImplementacao), 0)
    const entrouCents = mrrTotalCents + implTotalCents
    const clientesVendidos = vendasNoMes.length

    const agendTotal = agendadosTotal.length
    const agendAteHoje = agendadosAteHoje.length
    const noShow = noShowAteHoje.length
    const vendas = vendasFechadas.length

    const cplCents = leadsGerados > 0 ? investimentoCents / leadsGerados : 0
    const custoPorAgendCents = agendTotal > 0 ? investimentoCents / agendTotal : 0
    const cacCents = vendas > 0 ? investimentoCents / vendas : 0

    const taxaLeadAgend = leadsGerados > 0 ? agendTotal / leadsGerados : 0
    const showRate = agendAteHoje > 0 ? comparecimentos / agendAteHoje : 0
    const taxaCompVenda = comparecimentos > 0 ? vendas / comparecimentos : 0
    const taxaLeadVenda = leadsGerados > 0 ? vendas / leadsGerados : 0

    const ticketMedioCents = clientesVendidos > 0 ? entrouCents / clientesVendidos : 0
    const mrrMedioCents = clientesVendidos > 0 ? mrrTotalCents / clientesVendidos : 0
    const receitaProjetadaCents = mrrTotalCents * permanencia + implTotalCents
    const roasImediato = investimentoCents > 0 ? entrouCents / investimentoCents : 0
    const roiImediato = investimentoCents > 0 ? (entrouCents - investimentoCents) / investimentoCents : 0
    const roiProjetado = investimentoCents > 0 ? (receitaProjetadaCents - investimentoCents) / investimentoCents : 0
    const retornoProjetadoCents = receitaProjetadaCents - investimentoCents
    const ltvCac = cacCents > 0 ? receitaProjetadaCents / cacCents : 0
    const paybackCac = mrrMedioCents > 0 ? cacCents / mrrMedioCents : 0

    return {
      investimentoCents, leadsGerados, cplCents,
      agendTotal, agendAteHoje, comparecimentos, vendas, noShow,
      taxaLeadAgend, showRate, taxaCompVenda, taxaLeadVenda, custoPorAgendCents, cacCents,
      mrrTotalCents, implTotalCents, entrouCents, clientesVendidos, permanencia,
      ticketMedioCents, mrrMedioCents, receitaProjetadaCents, roasImediato, roiImediato,
      roiProjetado, retornoProjetadoCents, ltvCac, paybackCac,
    }
  }, [month, allRows, milestoneById, vendasBoard])

  const veredito = React.useMemo(() => {
    if (!stats || stats.leadsGerados === 0) return null
    const roiLabel = stats.roiProjetado >= 1 ? 'Excelente' : stats.roiProjetado >= 0.3 ? 'Bom' : stats.roiProjetado >= 0 ? 'Regular' : 'Ruim'
    const ltvCacLabel = stats.ltvCac >= 3 ? 'Saudável' : 'Abaixo do ideal'
    const showLabel = stats.showRate >= 0.7 ? 'Ótimo' : 'Atenção'
    let gargalo = 'Funil equilibrado — foque em escalar leads'
    if (stats.taxaLeadAgend < 0.2) gargalo = 'Agendamento baixo — foque em qualificar melhor os leads antes de marcar'
    else if (stats.agendAteHoje > 0 && stats.showRate < 0.7) gargalo = 'Show rate baixo — foque em confirmar as reuniões marcadas'
    else if (stats.comparecimentos > 0 && stats.taxaCompVenda < 0.3) gargalo = 'Conversão de reunião pra venda baixa — foque no fechamento'
    return { roiLabel, ltvCacLabel, showLabel, gargalo }
  }, [stats])

  return (
    <>
      <TopBar
        title="Painel do Mês"
        subtitle="Comercial · investimento, funil e ROI por mês"
        titleClassName="text-[36px] font-semibold"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Comercial', to: '/comercial' },
          { label: 'Dashboard Comercial', to: '/comercial-dashboard' },
          { label: 'Painel do Mês' },
        ]}
        rightSlot={
          <Link
            to="/comercial-dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Link>
        }
      />

      <div className="flex min-h-screen flex-col gap-4 bg-bg px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {!booted ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-card p-3">
              {months.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors',
                    m.id === selectedId ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
                  )}
                >
                  {monthLabel(m.id)}
                </button>
              ))}
              <button
                type="button"
                onClick={handleAddMonth}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar {monthLabel(nextId).toLowerCase()}
              </button>
            </div>

            {!month || !stats ? (
              <div className="grid min-h-[30vh] place-items-center text-center text-sm text-foreground/40">
                Nenhum mês criado ainda — clique em "Adicionar {monthLabel(nextId).toLowerCase()}" pra começar.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SectionCard title="Investimento & Leads">
                    <ManualCurrencyRow
                      label="Investimento em tráfego (R$)"
                      value={month.investimentoTrafego}
                      onSave={(next) => void commercialMonthsService.update(month.id, { investimentoTrafego: next })}
                    />
                    <ManualNumberRow
                      label="Total de leads gerados"
                      value={month.leadsGerados}
                      onSave={(next) => void commercialMonthsService.update(month.id, { leadsGerados: Math.round(next) })}
                    />
                    <MetricRow label="CPL — Custo por Lead (R$)" value={money(stats.cplCents)} hint="investimento ÷ leads" />
                  </SectionCard>

                  <SectionCard title="Funil de Vendas">
                    <MetricRow label="Agendamentos (total)" value={stats.agendTotal} />
                    <MetricRow label="Agendamentos até hoje" value={stats.agendAteHoje} />
                    <MetricRow label="Comparecimentos (show)" value={stats.comparecimentos} />
                    <MetricRow label="Vendas fechadas" value={stats.vendas} />
                    <MetricRow label="Taxa Lead → Agendamento" value={pct(stats.taxaLeadAgend)} />
                    <MetricRow label="Show rate (real)" value={pct(stats.showRate)} />
                    <MetricRow label="Taxa Comp → Venda" value={pct(stats.taxaCompVenda)} />
                    <MetricRow label="Taxa geral Lead → Venda" value={pct(stats.taxaLeadVenda)} />
                    <MetricRow label="Custo por agendamento (R$)" value={money(stats.custoPorAgendCents)} />
                    <MetricRow label="CAC — Custo por venda (R$)" value={money(stats.cacCents)} />
                  </SectionCard>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SectionCard title="Receita, MRR & ROI">
                    <MetricRow label="MRR total do mês (R$)" value={money(stats.mrrTotalCents)} hint="soma das vendas" />
                    <MetricRow label="Implementação total (R$)" value={money(stats.implTotalCents)} />
                    <MetricRow label="Entrou no 1º mês (R$)" value={money(stats.entrouCents)} hint="MRR + implementação" />
                    <MetricRow label="Nº de clientes vendidos" value={stats.clientesVendidos} hint="aba Vendas do mês" />
                    <ManualNumberRow
                      label="Permanência média (meses)"
                      value={month.permanenciaMedia}
                      step={0.5}
                      onSave={(next) => void commercialMonthsService.update(month.id, { permanenciaMedia: next })}
                    />
                    <MetricRow label="Ticket médio de entrada (R$)" value={money(stats.ticketMedioCents)} />
                    <MetricRow label="MRR médio por cliente (R$)" value={money(stats.mrrMedioCents)} />
                    <MetricRow label="Receita projetada — LTV (R$)" value={money(stats.receitaProjetadaCents)} hint="MRR × permanência + implementação" />
                    <MetricRow label="ROAS imediato" value={mult(stats.roasImediato)} />
                    <MetricRow label="ROI imediato — 1º mês" value={pct(stats.roiImediato)} />
                    <MetricRow label="ROI projetado — LTV" value={pct(stats.roiProjetado)} />
                    <MetricRow label="Retorno projetado (lucro, R$)" value={money(stats.retornoProjetadoCents)} />
                    <MetricRow label="LTV / CAC" value={mult(stats.ltvCac)} />
                    <MetricRow label="Payback do CAC" value={meses(stats.paybackCac)} />
                  </SectionCard>

                  <SectionCard title="Veredito do Mês">
                    {!veredito ? (
                      <p className="py-4 text-center text-xs text-foreground/40">
                        Preencha o total de leads gerados pra ver o veredito.
                      </p>
                    ) : (
                      <>
                        <MetricRow label="ROI (projetado)" value={veredito.roiLabel} />
                        <MetricRow label="LTV / CAC" value={veredito.ltvCacLabel} />
                        <MetricRow label="Show rate" value={veredito.showLabel} />
                        <div className="flex items-start gap-2 py-2 text-sm">
                          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          <div>
                            <p className="text-foreground/50">Onde está o gargalo</p>
                            <p className="font-semibold text-foreground">{veredito.gargalo}</p>
                          </div>
                        </div>
                      </>
                    )}
                  </SectionCard>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}
