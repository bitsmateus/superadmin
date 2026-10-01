import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, CalendarDays, ChevronDown, DollarSign, Pencil, Target, TrendingUp, Users, Zap,
} from 'lucide-react'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { MILESTONE_NO_SHOW, MILESTONE_VENDIDO } from '@/components/comercial/LeadDashboardView'
import { GraficoBarras, GraficoFunil, GraficoMeta, GraficoRosca, type FatiaGrafico } from '@/components/comercial/charts'
import { useLeadMilestones } from '@/hooks/useLeadMilestones'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useCommercialMonths } from '@/hooks/useCommercialMonths'
import { commercialMonthsService, type CommercialMonth } from '@/services/commercialMonths'
import { formatBRLCents, formatBRLCompact, parseBRLCents } from '@/lib/currency'
import { cn } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
function rotuloMes(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return `${MESES[m - 1] ?? id}/${y}`
}
function limitesDoMes(id: string): { from: string; to: string } {
  const [y, m] = id.split('-').map(Number)
  const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: dia(new Date(y, m - 1, 1)), to: dia(new Date(y, m, 0)) }
}

const money = (cents: number) => formatBRLCents(Math.round(cents))
const pct = (r: number) => `${(r * 100).toFixed(1)}%`

/**
 * Painel do mês do Dashboard Comercial: quanto entrou de lead, quanto virou reunião, quanto virou
 * venda e quanto isso deu de dinheiro — com as metas do lado, pra saber se o mês está no caminho.
 *
 * Os números calculados saem dos mesmos lugares do resto do app (leva de leads criada no mês,
 * marcos do funil, linhas da aba Vendas), então batem com as Métricas por SDR e com o Painel do
 * Mês. O que é digitado — investimento, leads gerados, custos fora do tráfego, permanência e as
 * metas — fica no registro do mês e é editável aqui mesmo.
 */
export function PainelMetricasMes({ monthId, rows, boards }: {
  monthId: string
  /** Leads de todas as abas (já sem as cópias do espelho). */
  rows: LeadRow[]
  boards: LeadBoard[]
}) {
  const milestones = useLeadMilestones()
  const months = useCommercialMonths()
  const sdrLabels = useLeadLabels('sdr')
  const [editando, setEditando] = React.useState(false)

  const month = months.find((m) => m.id === monthId) ?? null
  const milestoneById = React.useMemo(() => new Map(milestones.map((m) => [m.id, m])), [milestones])
  const vendasBoard = React.useMemo(() => boards.find((b) => b.isVendas), [boards])

  const dados = React.useMemo(() => {
    const { from, to } = limitesDoMes(monthId)
    const leva = rows.filter((r) => {
      const d = r.createdAt.slice(0, 10)
      return d >= from && d <= to
    })
    const agendados = leva.filter((r) => milestoneById.get(r.id)?.everAgendada)
    const compareceram = agendados.filter((r) => milestoneById.get(r.id)?.everCompareceu)
    const noShow = agendados.filter((r) => milestoneById.get(r.id)?.milestone === MILESTONE_NO_SHOW)
    const vendasFunil = leva.filter((r) => milestoneById.get(r.id)?.milestone === MILESTONE_VENDIDO)

    // Dinheiro vem das linhas da aba Vendas fechadas no mês — é onde MRR e implementação existem
    // preenchidos de verdade (venda avulsa inclusive, que não passou pelo funil).
    const vendasDoMes = (vendasBoard ? rows.filter((r) => r.boardId === vendasBoard.id && !r.vendaRevertida) : [])
      .filter((r) => {
        const d = (r.fechamento || r.createdAt).slice(0, 10)
        return d >= from && d <= to
      })
    const mrrCents = vendasDoMes.reduce((s, r) => s + parseBRLCents(r.valorMrr), 0)
    const implCents = vendasDoMes.reduce((s, r) => s + parseBRLCents(r.valorImplementacao), 0)
    const entrouCents = mrrCents + implCents

    const investimentoCents = parseBRLCents(month?.investimentoTrafego ?? '0')
    const extrasCents = parseBRLCents(month?.custosExtras ?? '0')
    const custoTotalCents = investimentoCents + extrasCents
    // Leads do mês: vale o número DIGITADO (o que o tráfego entregou, que é o que casa com o
    // investimento); sem ele preenchido, usa o que o CRM tem — melhor um número real do que zero.
    // Um só, usado no CPL, no funil e na meta: antes a meta olhava só o digitado e mostrava 0 de
    // 400 com o CRM cheio de lead.
    const leadsGerados = month?.leadsGerados || rows.filter((r) => {
      const d = r.createdAt.slice(0, 10)
      return d >= from && d <= to
    }).length
    const permanencia = month?.permanenciaMedia ?? 0

    const vendas = vendasDoMes.length
    const comDesfecho = compareceram.length + noShow.length

    // Vendas por SDR: usa a linha da aba Vendas (é ela que carrega o valor fechado).
    const porSdr = new Map<string, { qtd: number; mrr: number }>()
    for (const r of vendasDoMes) {
      const nome = r.sdr || 'Sem SDR'
      const atual = porSdr.get(nome) ?? { qtd: 0, mrr: 0 }
      atual.qtd += 1
      atual.mrr += parseBRLCents(r.valorMrr)
      porSdr.set(nome, atual)
    }

    return {
      leva, agendados, compareceram, noShow, vendasFunil, vendasDoMes,
      mrrCents, implCents, entrouCents, investimentoCents, extrasCents, custoTotalCents,
      leadsGerados, permanencia, vendas, comDesfecho, porSdr,
      cplCents: leadsGerados > 0 ? custoTotalCents / leadsGerados : 0,
      // CAC é custo de aquisição PELO TRÁFEGO: divide pelas vendas que vieram do funil, não pelas
      // avulsas (indicação, cliente antigo voltando) — misturar faria o tráfego parecer mais
      // barato do que é.
      cacCents: vendasFunil.length > 0 ? custoTotalCents / vendasFunil.length : 0,
      ticketCents: vendas > 0 ? entrouCents / vendas : 0,
      mrrMedioCents: vendas > 0 ? mrrCents / vendas : 0,
      roas: custoTotalCents > 0 ? entrouCents / custoTotalCents : 0,
      roi: custoTotalCents > 0 ? (entrouCents - custoTotalCents) / custoTotalCents : 0,
      projetadaCents: mrrCents * permanencia + implCents,
      taxaLeadAgend: leadsGerados > 0 ? agendados.length / leadsGerados : 0,
      taxaComparecimento: comDesfecho > 0 ? compareceram.length / comDesfecho : 0,
      taxaNoShow: comDesfecho > 0 ? noShow.length / comDesfecho : 0,
      taxaReuniaoVenda: compareceram.length > 0 ? vendasFunil.length / compareceram.length : 0,
    }
  }, [monthId, rows, milestoneById, vendasBoard, month])

  const roiProjetado = dados.custoTotalCents > 0
    ? (dados.projetadaCents - dados.custoTotalCents) / dados.custoTotalCents
    : 0

  const veredito = React.useMemo(() => {
    if (!month || dados.leadsGerados === 0) return null
    let gargalo = 'Funil equilibrado — o caminho agora é trazer mais lead'
    if (dados.taxaLeadAgend < 0.2) gargalo = 'Agendamento baixo — o aperto está em transformar lead em reunião'
    else if (dados.comDesfecho > 0 && dados.taxaComparecimento < 0.7) gargalo = 'Comparecimento baixo — o aperto está em confirmar as reuniões marcadas'
    else if (dados.compareceram.length > 0 && dados.taxaReuniaoVenda < 0.3) gargalo = 'Reunião vira pouca venda — o aperto está no fechamento'
    return {
      gargalo,
      roi: roiProjetado >= 1 ? 'Excelente' : roiProjetado >= 0.3 ? 'Bom' : roiProjetado >= 0 ? 'Regular' : 'No prejuízo',
      roiTom: roiProjetado >= 0.3 ? 'text-success' : roiProjetado >= 0 ? 'text-warning' : 'text-danger',
    }
  }, [month, dados, roiProjetado])

  if (!month) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center shadow-sm">
        <CalendarDays className="mx-auto h-6 w-6 text-foreground/25" />
        <p className="mt-2 text-sm font-medium text-foreground">{rotuloMes(monthId)} ainda não existe no Painel do Mês</p>
        <p className="mt-1 text-xs text-foreground/50">
          Investimento, leads gerados e metas ficam guardados por mês.
        </p>
        <button
          type="button"
          onClick={() => void commercialMonthsService.create(monthId)}
          className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Criar {rotuloMes(monthId)}
        </button>
      </div>
    )
  }

  const metaReceitaCents = parseBRLCents(month.metaMrr) + parseBRLCents(month.metaImpl)

  const corSdr = (nome: string) => sdrLabels.find((l) => l.name === nome)?.color ?? 'var(--viz-3)'
  const fatiasSdr: FatiaGrafico[] = Array.from(dados.porSdr.entries())
    .map(([nome, v]) => ({ nome, valor: v.qtd, cor: corSdr(nome), rotulo: String(v.qtd) }))
    .sort((a, b) => b.valor - a.valor)

  return (
    <div className="space-y-4">
      {/* ---------------- números do mês ---------------- */}
      <div className="rounded-2xl bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <TrendingUp className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-foreground">Resultado de {rotuloMes(monthId)}</span>
          <button
            type="button"
            onClick={() => setEditando((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            {editando ? 'Fechar' : 'Investimento, custos e metas'}
            <ChevronDown className={cn('h-3 w-3 transition-transform', editando && 'rotate-180')} />
          </button>
          <Link
            to="/comercial-dashboard-mensal"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
          >
            Painel do Mês completo
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {editando && <EditorDoMes month={month} />}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          <Kpi titulo="Investimento" valor={money(dados.custoTotalCents)}
            nota={dados.extrasCents > 0 ? `${money(dados.investimentoCents)} tráfego + ${money(dados.extrasCents)} outros` : 'tráfego'} />
          <Kpi titulo="CPL" valor={money(dados.cplCents)} nota="custo por lead" />
          <Kpi titulo="CAC" valor={money(dados.cacCents)} nota="custo por venda do funil" editavel onEditar={() => setEditando(true)} />
          <Kpi titulo="ROI / ROAS" valor={pct(dados.roi)} nota={`ROAS ${dados.roas.toFixed(1)}x · receita ÷ custo`}
            tom={dados.roi >= 0 ? 'bom' : 'ruim'} />
          <Kpi titulo="Total de leads" valor={String(dados.leadsGerados)}
            nota={month.leadsGerados ? `${dados.leva.length} no CRM` : 'contados no CRM'} />
          <Kpi titulo="Agendamentos" valor={String(dados.agendados.length)} nota={`${pct(dados.taxaLeadAgend)} dos leads`} />
          <Kpi titulo="Vendas" valor={String(dados.vendas)} nota={`${dados.vendasFunil.length} pelo funil`} tom="bom" />
          <Kpi titulo="Reuniões realizadas" valor={String(dados.compareceram.length)} nota={`${pct(dados.taxaComparecimento)} de comparecimento`} />
          <Kpi titulo="No-shows" valor={String(dados.noShow.length)} nota={pct(dados.taxaNoShow)} tom={dados.noShow.length ? 'ruim' : undefined} />
          <Kpi titulo="Reunião → venda" valor={pct(dados.taxaReuniaoVenda)} nota="fechamento" />
          <Kpi titulo="Receita do mês" valor={money(dados.entrouCents)} nota="MRR + implementação" tom="bom" />
          <Kpi titulo="MRR novo" valor={money(dados.mrrCents)} nota="recorrente conquistado" />
          <Kpi titulo="Ticket médio" valor={money(dados.ticketCents)} nota="por venda" />
          <Kpi titulo="Receita projetada" valor={money(dados.projetadaCents)}
            nota={dados.permanencia > 0 ? `${dados.permanencia} meses de permanência` : 'defina a permanência'} />
        </div>
      </div>

      {/* ---------------- metas ---------------- */}
      <div className="rounded-2xl bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <Target className="h-4 w-4" />
          </span>
          Metas de {rotuloMes(monthId)}
          {metaReceitaCents > 0 && (
            <span className="ml-auto text-xs font-normal text-foreground/45">
              {money(dados.entrouCents)} de {money(metaReceitaCents)}
              {dados.entrouCents < metaReceitaCents
                ? ` — faltam ${money(metaReceitaCents - dados.entrouCents)}`
                : ' — meta batida'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {/* A meta GERAL é a soma das duas de receita — sem campo próprio, pra nunca contradizer
              as partes (9k de MRR + 16k de implementação = 25k, sempre). */}
          <GraficoMeta
            titulo="Receita total"
            realizado={dados.entrouCents}
            meta={metaReceitaCents}
            rotuloRealizado={formatBRLCompact(dados.entrouCents)}
            rotuloMeta={formatBRLCompact(metaReceitaCents)}
            cor="var(--viz-2)"
          />
          <GraficoMeta
            titulo="MRR novo"
            realizado={dados.mrrCents}
            meta={parseBRLCents(month.metaMrr)}
            rotuloRealizado={formatBRLCompact(dados.mrrCents)}
            rotuloMeta={formatBRLCompact(parseBRLCents(month.metaMrr))}
            cor="var(--viz-1)"
          />
          <GraficoMeta
            titulo="Implementação"
            realizado={dados.implCents}
            meta={parseBRLCents(month.metaImpl)}
            rotuloRealizado={formatBRLCompact(dados.implCents)}
            rotuloMeta={formatBRLCompact(parseBRLCents(month.metaImpl))}
            cor="var(--viz-3)"
          />
          <GraficoMeta titulo="Vendas" realizado={dados.vendas} meta={month.metaVendas} cor="var(--viz-2)" />
          <GraficoMeta titulo="Leads" realizado={dados.leadsGerados} meta={month.metaLeads} cor="var(--viz-1)" />
          <GraficoMeta titulo="Agendamentos" realizado={dados.agendados.length} meta={month.metaAgendamentos} cor="var(--viz-3)" />
        </div>
      </div>

      {/* ---------------- funil + vendas por SDR ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Zap className="h-4 w-4" />
            </span>
            Funil de vendas
          </div>
          <GraficoFunil
            cor="var(--viz-1)"
            etapas={[
              { nome: 'Leads', valor: dados.leadsGerados },
              { nome: 'Reuniões agendadas', valor: dados.agendados.length, conversao: pct(dados.taxaLeadAgend) },
              { nome: 'Reuniões realizadas', valor: dados.compareceram.length, conversao: pct(dados.taxaComparecimento) },
              { nome: 'Vendas', valor: dados.vendasFunil.length, conversao: pct(dados.taxaReuniaoVenda) },
            ]}
          />
          <p className="mt-3 border-t border-line/60 pt-2 text-[11px] text-foreground/45">
            De cada 100 leads, {Math.round((dados.leadsGerados > 0 ? dados.vendasFunil.length / dados.leadsGerados : 0) * 100)} viram
            venda pelo funil. Os {dados.noShow.length} no-shows ficam fora das reuniões realizadas.
          </p>
        </div>

        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Users className="h-4 w-4" />
            </span>
            Vendas por SDR
          </div>
          <GraficoRosca
            fatias={fatiasSdr}
            total={String(dados.vendas)}
            rotuloTotal="vendas"
            vazio="Nenhuma venda registrada neste mês"
          />
        </div>
      </div>

      {/* ---------------- receita + veredito ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <DollarSign className="h-4 w-4" />
            </span>
            Receita do mês
          </div>
          <GraficoBarras
            itens={[
              { nome: 'MRR novo (recorrente)', valor: dados.mrrCents, cor: 'var(--viz-1)', rotulo: money(dados.mrrCents) },
              { nome: 'Implementação (uma vez)', valor: dados.implCents, cor: 'var(--viz-2)', rotulo: money(dados.implCents) },
              { nome: 'Investimento + custos', valor: dados.custoTotalCents, cor: 'var(--viz-3)', rotulo: money(dados.custoTotalCents) },
            ]}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-center">
            <MiniNumero titulo="Entrou" valor={money(dados.entrouCents)} />
            <MiniNumero titulo="Projetado" valor={money(dados.projetadaCents)} />
            <MiniNumero titulo="ROI projetado" valor={pct(roiProjetado)} tom={roiProjetado >= 0 ? 'bom' : 'ruim'} />
          </div>
        </div>

        <div className="rounded-2xl bg-card p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-foreground">Veredito do mês</div>
          {veredito ? (
            <div className="space-y-3 text-sm">
              <p className="text-foreground/70">
                ROI projetado: <span className={cn('font-semibold', veredito.roiTom)}>{veredito.roi}</span>
                {' · '}cada R$ 1 investido devolveu {money(dados.custoTotalCents > 0 ? dados.entrouCents / (dados.custoTotalCents / 100) : 0)} no primeiro mês.
              </p>
              <p className="rounded-xl bg-elevate/[0.04] p-3 text-foreground/70">{veredito.gargalo}</p>
              <ul className="space-y-1.5 text-xs text-foreground/55">
                <li>Custo por lead {money(dados.cplCents)} · custo por venda {money(dados.cacCents)}</li>
                <li>
                  O cliente médio paga {money(dados.mrrMedioCents)} por mês — o CAC se paga em{' '}
                  {dados.mrrMedioCents > 0 ? (dados.cacCents / dados.mrrMedioCents).toFixed(1) : '—'} meses.
                </li>
                <li>
                  {dados.vendas - dados.vendasFunil.length > 0
                    ? `${dados.vendas - dados.vendasFunil.length} venda(s) do mês não vieram do funil de leads.`
                    : 'Todas as vendas do mês vieram do funil.'}
                </li>
              </ul>
            </div>
          ) : (
            <p className="py-6 text-center text-xs text-foreground/40">
              Preencha investimento e leads gerados do mês pra ver o veredito.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Bloco de edição dos números que ninguém calcula sozinho: o que foi gasto e o que se espera. */
function EditorDoMes({ month }: { month: CommercialMonth }) {
  const salvar = (patch: Parameters<typeof commercialMonthsService.update>[1]) =>
    void commercialMonthsService.update(month.id, patch)

  return (
    <div className="mb-4 grid gap-3 rounded-xl bg-elevate/[0.03] p-3 sm:grid-cols-2 lg:grid-cols-4">
      <CampoMoeda label="Investimento em tráfego" value={month.investimentoTrafego}
        onSave={(v) => salvar({ investimentoTrafego: v })} />
      <CampoMoeda label="Outros custos (entram no CAC)" value={month.custosExtras}
        hint="ferramentas, comissão, bônus, agência" onSave={(v) => salvar({ custosExtras: v })} />
      <CampoNumero label="Leads gerados" value={month.leadsGerados} onSave={(v) => salvar({ leadsGerados: v })} />
      <CampoNumero label="Permanência média (meses)" value={month.permanenciaMedia} step={0.5}
        onSave={(v) => salvar({ permanenciaMedia: v })} />
      <CampoNumero label="Meta de vendas" value={month.metaVendas} onSave={(v) => salvar({ metaVendas: v })} />
      <CampoMoeda label="Meta de MRR" value={month.metaMrr} onSave={(v) => salvar({ metaMrr: v })} />
      <CampoMoeda label="Meta de implementação" value={month.metaImpl}
        hint={`geral: ${formatBRLCents(parseBRLCents(month.metaMrr) + parseBRLCents(month.metaImpl))}`}
        onSave={(v) => salvar({ metaImpl: v })} />
      <CampoNumero label="Meta de leads" value={month.metaLeads} onSave={(v) => salvar({ metaLeads: v })} />
      <CampoNumero label="Meta de agendamentos" value={month.metaAgendamentos} onSave={(v) => salvar({ metaAgendamentos: v })} />
    </div>
  )
}

function CampoMoeda({ label, value, hint, onSave }: { label: string; value: string; hint?: string; onSave: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-foreground/55">{label}</span>
      <CurrencyField value={value} onSave={onSave}
        className="h-9 w-full rounded-lg bg-card px-3 text-right text-sm font-semibold text-foreground ring-1 ring-line" />
      {hint && <span className="mt-0.5 block text-[10px] text-foreground/35">{hint}</span>}
    </label>
  )
}

function CampoNumero({ label, value, step, onSave }: { label: string; value: number; step?: number; onSave: (v: number) => void }) {
  const [local, setLocal] = React.useState(String(value))
  React.useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-foreground/55">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step={step ?? 1}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => { const n = Number(local); if (!Number.isNaN(n) && n !== value) onSave(n) }}
        className="h-9 w-full rounded-lg bg-card px-3 text-right text-sm font-semibold text-foreground outline-none ring-1 ring-line focus:ring-accent/40"
      />
    </label>
  )
}

function Kpi({ titulo, valor, nota, tom, editavel, onEditar }: {
  titulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim'; editavel?: boolean; onEditar?: () => void
}) {
  return (
    <div className="rounded-xl bg-elevate/[0.03] p-3">
      <div className="flex items-center gap-1">
        <p className="truncate text-[10px] font-medium uppercase tracking-wider text-foreground/45">{titulo}</p>
        {editavel && (
          <button type="button" onClick={onEditar} title="Editar os custos que entram nessa conta"
            className="shrink-0 text-foreground/30 hover:text-accent">
            <Pencil className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
      <p className={cn(
        'mt-1 truncate text-lg font-semibold tabular-nums',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
      {nota && <p className="truncate text-[10px] text-foreground/40">{nota}</p>}
    </div>
  )
}

function MiniNumero({ titulo, valor, tom }: { titulo: string; valor: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-foreground/40">{titulo}</p>
      <p className={cn(
        'text-sm font-semibold tabular-nums',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
    </div>
  )
}
