import * as React from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import {
  CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Copy, FileText, LayoutDashboard, Loader2,
  Plus, Repeat, Shuffle, Trash2, Users, Wallet, X,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { addMonthsToId, currentMonthId, monthIdBounds, monthLabelPt, useMonthFilter, type MonthFilter } from '@/hooks/useMonthFilter'
import { usePayableEntries, usePayableGroups } from '@/hooks/usePayables'
import {
  payablesService, type PayableCategoria, type PayableEntry, type PayableGroup, type PayableStatus,
} from '@/services/payables'
import { useCommissionEntries } from '@/hooks/useCommissions'
import { commissionsService, type CommissionEntry, type CommissionRole } from '@/services/commissions'
import { formatBRLCents, parseBRLCents, prettifyCurrencyRaw, sanitizeCurrencyRaw } from '@/lib/currency'
import { cn } from '@/lib/utils'

const MAX_BOLETO_BYTES = 10 * 1024 * 1024

const STATUS_LABEL: Record<PayableStatus, string> = { a_pagar: 'A pagar', agendado: 'Agendado', pago: 'Pago' }
const STATUS_STYLE: Record<PayableStatus, string> = {
  a_pagar: 'bg-danger/15 text-danger',
  agendado: 'bg-warning/20 text-warning',
  pago: 'bg-success/15 text-success',
}

const CATEGORIA_LABEL: Record<PayableCategoria, string> = { fixo: 'Fixo', variavel: 'Variável' }
const CATEGORIA_STYLE: Record<PayableCategoria, string> = {
  fixo: 'bg-accent/15 text-accent',
  variavel: 'bg-warning/20 text-warning',
}

const ROLE_LABEL: Record<CommissionRole, string> = { sdr: 'SDR', suporte: 'Suporte' }

const GROUP_COLORS = ['#4F8EF7', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#64748B']

const MONTH_NAMES_FULL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
function monthFullLabelPt(id: string): string {
  const [y, m] = id.split('-').map(Number)
  return `${MONTH_NAMES_FULL[m - 1] ?? id} ${y}`
}

type Tab = 'geral' | 'fixas' | 'variaveis' | 'comissoes'
const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'geral', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'fixas', label: 'Fixas', icon: Repeat },
  { key: 'variaveis', label: 'Variáveis', icon: Shuffle },
  { key: 'comissoes', label: 'Comissões', icon: Users },
]

/** Um grupo/comissão "pertence" ao mês selecionado — normal (um mês só) ou personalizado
 * (intervalo livre, compara o mês inteiro contra o intervalo). */
function monthInFilter(month: string | null, filter: MonthFilter): boolean {
  if (!month) return false
  if (filter.customMode) {
    const { from, to } = filter.bounds
    const bounds = monthIdBounds(month)
    if (from && bounds.to < from) return false
    if (to && bounds.from > to) return false
    return true
  }
  return month === filter.selected
}

/** Contas a Pagar (Financeiro) — controle financeiro completo, separado por mês: grupos criados à
 * mão (ex.: "Setembro 2026"), cada um com seu mês, navegados em abas por categoria (Fixas,
 * Variáveis) + uma aba Comissões que só reflete o que já está lançado na Gestão Interna (contrato
 * Assinado — o resto fica lá, não duplica edição aqui). */
export function FinanceiroContasPagarPage() {
  const groups = usePayableGroups()
  const entries = usePayableEntries()
  const commissionEntries = useCommissionEntries()
  const [newGroupOpen, setNewGroupOpen] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>('geral')
  const filter = useMonthFilter([addMonthsToId(currentMonthId(), -1)])

  const groupsInMonth = React.useMemo(
    () => groups.filter((g) => monthInFilter(g.month, filter)).slice().sort((a, b) => a.position - b.position),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, filter.selected, filter.customMode, filter.customFrom, filter.customTo],
  )
  const groupIdsInMonth = React.useMemo(() => new Set(groupsInMonth.map((g) => g.id)), [groupsInMonth])
  const entriesInMonth = React.useMemo(
    () => entries.filter((e) => groupIdsInMonth.has(e.groupId)),
    [entries, groupIdsInMonth],
  )
  const commissionsInMonth = React.useMemo(
    () => commissionEntries.filter((c) => c.contratoAssinado && monthInFilter(c.month, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commissionEntries, filter.selected, filter.customMode, filter.customFrom, filter.customTo],
  )

  const monthHint = filter.customMode ? 'no período selecionado' : `em ${monthLabelPt(filter.selected)}`
  const defaultMonth = filter.customMode ? currentMonthId() : filter.selected

  return (
    <>
      <TopBar
        title="Contas a Pagar"
        subtitle="Financeiro"
        rightSlot={
          tab !== 'comissoes' ? (
            <Button onClick={() => setNewGroupOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
              Novo grupo
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <MonthFilterBar filter={filter} />

        <OverviewCards entries={entriesInMonth} commissions={commissionsInMonth} />

        <TabNav tab={tab} setTab={setTab} />

        {tab === 'geral' && (
          <GroupsList groups={groupsInMonth} entries={entriesInMonth} monthHint={monthHint} onNewGroup={() => setNewGroupOpen(true)} />
        )}
        {tab === 'fixas' && (
          <GroupsList groups={groupsInMonth} entries={entriesInMonth} categoria="fixo" monthHint={monthHint} onNewGroup={() => setNewGroupOpen(true)} />
        )}
        {tab === 'variaveis' && (
          <GroupsList groups={groupsInMonth} entries={entriesInMonth} categoria="variavel" monthHint={monthHint} onNewGroup={() => setNewGroupOpen(true)} />
        )}
        {tab === 'comissoes' && <ComissoesTab entries={commissionsInMonth} monthHint={monthHint} />}
      </div>
      <NewGroupModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} defaultMonth={defaultMonth} />
    </>
  )
}

/** "Pago" usa o Real quando preenchido (senão o Previsto, pra não ficar em branco por esquecimento
 * de preencher). Reaproveitado tanto na visão geral (todos os grupos) quanto no resumo de cada
 * grupo (só os itens dele) — mesma conta, escopo diferente. */
function computeStats(entries: PayableEntry[]) {
  let previsto = 0, pago = 0, pendente = 0, fixo = 0, variavel = 0
  for (const e of entries) {
    previsto += e.previstoCents
    if (e.status === 'pago') pago += e.realCents ?? e.previstoCents
    else pendente += e.previstoCents
    if (e.categoria === 'fixo') fixo += e.previstoCents
    else if (e.categoria === 'variavel') variavel += e.previstoCents
  }
  return { previsto, pago, pendente, fixo, variavel }
}

function computeCommissionStats(commissionEntries: CommissionEntry[]) {
  let total = 0, pago = 0, pendente = 0
  for (const c of commissionEntries) {
    total += c.amountCents
    if (c.status === 'pago') pago += c.amountCents
    else pendente += c.amountCents
  }
  return { total, pago, pendente }
}

/** Visão geral no topo — soma os grupos do mês selecionado + as comissões assinadas do mesmo mês,
 * pra ter noção do total de contas a pagar sem precisar somar de cabeça nem abrir a Gestão Interna. */
function OverviewCards({ entries, commissions }: { entries: PayableEntry[]; commissions: CommissionEntry[] }) {
  const totals = React.useMemo(() => computeStats(entries), [entries])
  const commTotals = React.useMemo(() => computeCommissionStats(commissions), [commissions])
  const previstoGeral = totals.previsto + commTotals.total
  const pagoGeral = totals.pago + commTotals.pago
  const pendenteGeral = totals.pendente + commTotals.pendente

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <OverviewCard icon={<Wallet className="h-4 w-4" />} label="Previsto (total)" value={formatBRLCents(previstoGeral)} tone="info" />
      <OverviewCard icon={<CheckCircle2 className="h-4 w-4" />} label="Pago" value={formatBRLCents(pagoGeral)} tone="success" />
      <OverviewCard icon={<CalendarClock className="h-4 w-4" />} label="A pagar / agendado" value={formatBRLCents(pendenteGeral)} tone="warning" />
      <OverviewCard icon={<Repeat className="h-4 w-4" />} label="Fixo" value={formatBRLCents(totals.fixo)} tone="info" />
      <OverviewCard icon={<Shuffle className="h-4 w-4" />} label="Variável" value={formatBRLCents(totals.variavel)} tone="warning" />
      <OverviewCard icon={<Users className="h-4 w-4" />} label="Comissões (assinadas)" value={formatBRLCents(commTotals.total)} tone="purple" />
    </div>
  )
}

function OverviewCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'info' | 'success' | 'warning' | 'purple'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    purple: 'bg-purple-500/10 text-purple-500 ring-purple-500/20',
  }
  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
        <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1', tones[tone])}>{icon}</span>
      </div>
      <div className="mt-2.5 truncate text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function TabNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="flex flex-wrap gap-1 overflow-x-auto no-scrollbar border-b border-line">
      {TABS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
            tab === key ? 'border-accent text-accent' : 'border-transparent text-foreground/50 hover:text-foreground/80',
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}

function GroupsList({
  groups, entries, categoria, monthHint, onNewGroup,
}: {
  groups: PayableGroup[]
  entries: PayableEntry[]
  categoria?: PayableCategoria
  monthHint: string
  onNewGroup: () => void
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-foreground/40">
        <p>Nenhum grupo {monthHint}.</p>
        <button type="button" onClick={onNewGroup} className="mt-2 font-medium text-accent hover:underline">
          Criar um grupo novo
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} entries={entries.filter((e) => e.groupId === g.id)} categoria={categoria} />
      ))}
    </div>
  )
}

function GroupCard({
  group, entries, categoria,
}: { group: PayableGroup; entries: PayableEntry[]; categoria?: PayableCategoria }) {
  const [open, setOpen] = React.useState(true)
  const [deleting, setDeleting] = React.useState(false)
  const [duplicating, setDuplicating] = React.useState(false)
  const filtered = categoria ? entries.filter((e) => e.categoria === categoria) : entries
  const sorted = filtered.slice().sort((a, b) => a.position - b.position)

  const totals = sorted.reduce(
    (acc, e) => ({
      previsto: acc.previsto + e.previstoCents,
      comissao: acc.comissao + (e.comissaoCents ?? 0),
      real: acc.real + (e.realCents ?? 0),
    }),
    { previsto: 0, comissao: 0, real: 0 },
  )
  const stats = React.useMemo(() => computeStats(sorted), [sorted])

  const addItem = () => {
    void payablesService.createEntry({ groupId: group.id, elemento: '', previstoCents: 0, categoria: categoria ?? null })
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card" style={{ borderLeft: `4px solid ${group.color}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-wrap items-center gap-2">
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', !open && '-rotate-90')} />
          <GroupNameField group={group} />
          <GroupMonthField group={group} />
          <span className="shrink-0 text-xs text-foreground/40">{sorted.length} item(ns)</span>
          {sorted.length > 0 && (
            <span className="shrink-0 rounded-full bg-elevate/[0.06] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground/70">
              {formatBRLCents(stats.previsto)}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={addItem} leftIcon={<Plus className="h-3.5 w-3.5" />}>
            Item
          </Button>
          <button
            type="button"
            onClick={() => setDuplicating(true)}
            title="Duplicar pra um mês novo"
            className="grid h-8 w-8 place-items-center rounded text-foreground/30 hover:bg-accent/10 hover:text-accent"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDeleting(true)}
            title="Excluir grupo"
            className="grid h-8 w-8 place-items-center rounded text-foreground/30 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {open && sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-elevate/[0.015] px-4 py-2">
          <StatChip label="Pago" value={stats.pago} tone="success" />
          <StatChip label="A pagar/agendado" value={stats.pendente} tone="warning" />
          {!categoria && (
            <>
              <span className="mx-1 h-3.5 w-px shrink-0 bg-line" />
              <StatChip label="Fixo" value={stats.fixo} tone="info" />
              <StatChip label="Variável" value={stats.variavel} tone="warning" />
            </>
          )}
        </div>
      )}

      {open && (
        <div className="overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2.5">Elemento</th>
                <th className="w-32 px-3 py-2.5 text-right">Previsto</th>
                <th className="w-32 px-3 py-2.5 text-right">Comissão</th>
                <th className="w-32 px-3 py-2.5 text-right">Real</th>
                <th className="w-32 px-3 py-2.5">Status</th>
                <th className="w-36 px-3 py-2.5">Data</th>
                <th className="w-40 px-3 py-2.5">Boleto</th>
                <th className="px-3 py-2.5">Notas</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-xs text-foreground/40">
                    {categoria ? `Nenhum item ${CATEGORIA_LABEL[categoria].toLowerCase()} nesse grupo.` : 'Nenhum item nesse grupo.'}
                  </td>
                </tr>
              ) : (
                sorted.map((e) => <EntryRow key={e.id} entry={e} />)
              )}
            </tbody>
            {sorted.length > 0 && (
              <tfoot>
                <tr className="border-t border-line bg-elevate/[0.02] text-sm font-semibold">
                  <td className="px-4 py-2.5 text-foreground/60">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatBRLCents(totals.previsto)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatBRLCents(totals.comissao)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatBRLCents(totals.real)}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Excluir grupo"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => { void payablesService.deleteGroup(group.id); setDeleting(false) }}>
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">
          Excluir o grupo <strong>{group.name}</strong> e os {entries.length} item(ns) dentro dele? Essa ação não pode ser desfeita.
        </p>
      </Modal>

      <DuplicateGroupModal open={duplicating} onClose={() => setDuplicating(false)} group={group} entries={entries} />
    </div>
  )
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'info' }) {
  const tones = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    info: 'bg-accent/10 text-accent',
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', tones[tone])}>
      {label}
      <span className="font-semibold tabular-nums">{formatBRLCents(value)}</span>
    </span>
  )
}

function GroupNameField({ group }: { group: PayableGroup }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(group.name)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value.trim() && value !== group.name) void payablesService.updateGroup(group.id, { name: value.trim() }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-7 min-w-0 rounded border border-accent/40 bg-surface px-2 text-sm font-semibold text-foreground outline-none"
      />
    )
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setValue(group.name); setEditing(true) }}
      className="truncate text-sm font-semibold text-foreground hover:underline"
    >
      {group.name}
    </span>
  )
}

/** Pill com o mês do grupo + setas pra mudar de mês sem precisar abrir modal nenhum — o mês é o
 * que decide em que aba de mês (MonthFilterBar) esse grupo aparece. */
function GroupMonthField({ group }: { group: PayableGroup }) {
  const month = group.month ?? currentMonthId()
  const step = (delta: number) => { void payablesService.updateGroup(group.id, { month: addMonthsToId(month, delta) }) }
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-elevate/[0.06] py-0.5 pl-0.5 pr-1.5 text-xs font-medium text-foreground/60"
    >
      <button type="button" onClick={() => step(-1)} title="Mês anterior" className="grid h-5 w-5 place-items-center rounded-full hover:bg-elevate/[0.1] hover:text-foreground">
        <ChevronLeft className="h-3 w-3" />
      </button>
      {monthLabelPt(month)}
      <button type="button" onClick={() => step(1)} title="Próximo mês" className="grid h-5 w-5 place-items-center rounded-full hover:bg-elevate/[0.1] hover:text-foreground">
        <ChevronRight className="h-3 w-3" />
      </button>
    </span>
  )
}

function MonthStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line px-1">
      <button
        type="button"
        onClick={() => onChange(addMonthsToId(value, -1))}
        className="grid h-8 w-8 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-[92px] text-center text-sm font-medium text-foreground">{monthLabelPt(value)}</span>
      <button
        type="button"
        onClick={() => onChange(addMonthsToId(value, 1))}
        className="grid h-8 w-8 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function EntryRow({ entry }: { entry: PayableEntry }) {
  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
      <td className="px-4 py-2 text-sm"><ElementoCell entry={entry} /></td>
      <td className="px-3 py-2 text-right text-sm"><MoneyCell entry={entry} field="previstoCents" /></td>
      <td className="px-3 py-2 text-right text-sm"><MoneyCell entry={entry} field="comissaoCents" /></td>
      <td className="px-3 py-2 text-right text-sm"><MoneyCell entry={entry} field="realCents" /></td>
      <td className="px-3 py-2 text-sm"><StatusCell entry={entry} /></td>
      <td className="px-3 py-2 text-sm"><DateCell entry={entry} /></td>
      <td className="px-3 py-2 text-sm"><BoletoCell entry={entry} /></td>
      <td className="px-3 py-2 text-sm"><NotasCell entry={entry} /></td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={() => { if (window.confirm(`Excluir "${entry.elemento || 'este item'}"?`)) void payablesService.deleteEntry(entry.id) }}
          title="Excluir item"
          className="grid h-7 w-7 place-items-center rounded text-foreground/30 hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  )
}

/** Nome + descrição (fornecedor, condição, vencimento...) do item, editados juntos — a descrição
 * fica "dentro" do elemento em vez de uma coluna própria, pra caber mais informação sem alargar
 * a tabela. A categoria (Fixo/Variável) mora aqui do lado também, como uma etiqueta pequena. */
function ElementoCell({ entry }: { entry: PayableEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [nome, setNome] = React.useState(entry.elemento)
  const [desc, setDesc] = React.useState(entry.descricao)
  const wrapRef = React.useRef<HTMLDivElement>(null)

  const startEdit = () => {
    setNome(entry.elemento)
    setDesc(entry.descricao)
    setEditing(true)
  }

  const save = () => {
    const patch: { elemento?: string; descricao?: string } = {}
    if (nome !== entry.elemento) patch.elemento = nome
    if (desc !== entry.descricao) patch.descricao = desc
    if (Object.keys(patch).length) void payablesService.updateEntry(entry.id, patch)
  }

  if (editing) {
    return (
      <div
        ref={wrapRef}
        onBlur={(e) => {
          if (wrapRef.current && !wrapRef.current.contains(e.relatedTarget as Node)) { setEditing(false); save() }
        }}
        className="min-w-[240px] space-y-1.5 rounded-lg border border-accent/40 bg-surface p-2"
      >
        <input
          autoFocus
          value={nome}
          onChange={(ev) => setNome(ev.target.value)}
          placeholder="Nome do item"
          onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
          className="h-8 w-full rounded-md border border-line bg-card px-2 text-sm font-medium text-foreground outline-none focus:border-accent"
        />
        <textarea
          value={desc}
          onChange={(ev) => setDesc(ev.target.value)}
          placeholder="Descrição — fornecedor, condição, vencimento…"
          rows={2}
          className="w-full resize-none rounded-md border border-line bg-card px-2 py-1.5 text-xs text-foreground/70 outline-none focus:border-accent"
        />
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1.5">
      <CategoriaBadge entry={entry} />
      <button
        type="button"
        onClick={startEdit}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded px-1 py-0.5 text-left hover:bg-elevate/[0.06]"
      >
        <span className={cn('text-sm text-foreground', !entry.elemento && 'text-foreground/35')}>
          {entry.elemento || 'Nome do item…'}
        </span>
        {entry.descricao && <span className="max-w-[300px] truncate text-xs text-foreground/40">{entry.descricao}</span>}
      </button>
    </div>
  )
}

function CategoriaBadge({ entry }: { entry: PayableEntry }) {
  return (
    <select
      value={entry.categoria ?? ''}
      onChange={(e) => void payablesService.updateEntry(entry.id, { categoria: (e.target.value || null) as PayableCategoria | null })}
      title="Fixo ou Variável"
      className={cn(
        'h-6 shrink-0 rounded-full border-0 px-2 text-[10px] font-semibold uppercase tracking-wide outline-none',
        entry.categoria ? CATEGORIA_STYLE[entry.categoria] : 'bg-elevate/[0.06] text-foreground/35',
      )}
    >
      <option value="" className="bg-card text-foreground">—</option>
      <option value="fixo" className="bg-card text-foreground">Fixo</option>
      <option value="variavel" className="bg-card text-foreground">Variável</option>
    </select>
  )
}

function MoneyCell({ entry, field }: { entry: PayableEntry; field: 'previstoCents' | 'comissaoCents' | 'realCents' }) {
  const current = entry[field]
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(() => (current ? sanitizeCurrencyRaw(formatBRLCents(current)) : ''))

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="decimal"
        value={value}
        onFocus={(ev) => ev.target.select()}
        onChange={(ev) => setValue(sanitizeCurrencyRaw(ev.target.value))}
        onBlur={() => {
          setEditing(false)
          const cents = value ? parseBRLCents(prettifyCurrencyRaw(value)) : (field === 'previstoCents' ? 0 : null)
          if (cents === current) return
          if (field === 'previstoCents') void payablesService.updateEntry(entry.id, { previstoCents: cents ?? 0 })
          else if (field === 'comissaoCents') void payablesService.updateEntry(entry.id, { comissaoCents: cents })
          else void payablesService.updateEntry(entry.id, { realCents: cents })
        }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-28 rounded-md border border-accent/40 bg-surface px-2 text-right text-sm text-foreground outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setValue(current ? sanitizeCurrencyRaw(formatBRLCents(current)) : ''); setEditing(true) }}
      className={cn('rounded px-1.5 py-0.5 hover:bg-elevate/[0.06]', current == null && 'text-foreground/35')}
    >
      {current != null ? formatBRLCents(current) : '—'}
    </button>
  )
}

function StatusCell({ entry }: { entry: PayableEntry }) {
  return (
    <select
      value={entry.status}
      onChange={(e) => void payablesService.updateEntry(entry.id, { status: e.target.value as PayableStatus })}
      className={cn('h-7 rounded-full border-0 px-2.5 text-xs font-medium outline-none', STATUS_STYLE[entry.status])}
    >
      {(Object.keys(STATUS_LABEL) as PayableStatus[]).map((s) => (
        <option key={s} value={s} className="bg-card text-foreground">{STATUS_LABEL[s]}</option>
      ))}
    </select>
  )
}

function DateCell({ entry }: { entry: PayableEntry }) {
  return (
    <DatePickerField
      value={entry.data}
      onChange={(next) => void payablesService.updateEntry(entry.id, { data: next })}
      placeholder="Sem data"
      className="h-8 rounded-md px-1.5 text-xs hover:bg-elevate/[0.06]"
    />
  )
}

function NotasCell({ entry }: { entry: PayableEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.notas)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value !== entry.notas) void payablesService.updateEntry(entry.id, { notas: value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-full min-w-[140px] rounded-md border border-accent/40 bg-surface px-2 text-sm text-foreground outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setValue(entry.notas); setEditing(true) }}
      className="w-full rounded px-1.5 py-0.5 text-left text-foreground/55 hover:bg-elevate/[0.06]"
    >
      {entry.notas || '—'}
    </button>
  )
}

function BoletoCell({ entry }: { entry: PayableEntry }) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [loading, setLoading] = React.useState(false)

  const handleFile = async (file: File) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) { toast.error('Só é possível anexar arquivos PDF.'); return }
    if (file.size > MAX_BOLETO_BYTES) {
      toast.error(`"${file.name}" passa de ${Math.round(MAX_BOLETO_BYTES / 1024 / 1024)}MB.`)
      return
    }
    setLoading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      await payablesService.updateEntry(entry.id, { boletoData: dataUrl, boletoFilename: file.name })
    } catch {
      toast.error('Falha ao ler o arquivo — tenta de novo.')
    } finally {
      setLoading(false)
    }
  }

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void handleFile(file)
  }

  const open = async () => {
    let data = entry.boletoData
    if (!data) {
      await payablesService.loadFullEntry(entry.id)
      data = payablesService.getEntries().find((e) => e.id === entry.id)?.boletoData ?? null
    }
    if (data) window.open(data, '_blank')
  }

  if (entry.boletoFilename) {
    return (
      <div className="flex items-center gap-1">
        <button type="button" onClick={open} className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-elevate/[0.06]">
          <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="max-w-[100px] truncate text-xs text-foreground/70">{entry.boletoFilename}</span>
        </button>
        <button
          type="button"
          onClick={() => void payablesService.updateEntry(entry.id, { boletoData: null, boletoFilename: null })}
          title="Remover boleto"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-foreground/30 hover:bg-danger/10 hover:text-danger"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-xs text-foreground/50 hover:border-accent/40 hover:text-accent"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        Anexar
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={pickFile} />
    </>
  )
}

/** Comissões (Financeiro > Contas a Pagar) — só reflete o que a Gestão Interna já tem lançado com
 * contrato Assinado (é o que de fato vira conta a pagar). Não duplica os campos de edição —
 * "Nome"/"Pessoa"/"Tipo" ficam só na Gestão Interna, aqui só toggla Pago/Pendente, que é o que
 * importa pro controle de pagamento. */
function ComissoesTab({ entries, monthHint }: { entries: CommissionEntry[]; monthHint: string }) {
  const bySdr = entries.filter((e) => e.role === 'sdr')
  const bySuporte = entries.filter((e) => e.role === 'suporte')

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-foreground/40">
        <p>Nenhuma comissão assinada {monthHint}.</p>
        <p className="mx-auto mt-1 max-w-md">
          Comissões com contrato ainda não assinado não entram aqui — acompanhe pendências na{' '}
          <Link to="/financeiro/gestao-interna" className="text-accent hover:underline">Gestão Interna</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <CommissionRoleCard title={`Comissão ${ROLE_LABEL.sdr}`} entries={bySdr} />
      <CommissionRoleCard title={`Comissão ${ROLE_LABEL.suporte}`} entries={bySuporte} />
      <p className="text-xs text-foreground/40">
        Mostrando só comissões com contrato Assinado — são as que realmente entram como conta a pagar. Pra
        registrar uma comissão nova, editar valores ou tipos, use a{' '}
        <Link to="/financeiro/gestao-interna" className="text-accent hover:underline">Gestão Interna</Link>.
      </p>
    </div>
  )
}

function CommissionRoleCard({ title, entries }: { title: string; entries: CommissionEntry[] }) {
  const total = entries.reduce((sum, e) => sum + e.amountCents, 0)
  if (entries.length === 0) return null
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="shrink-0 rounded-full bg-elevate/[0.06] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground/70">
          {formatBRLCents(total)}
        </span>
      </div>
      <div className="overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2.5">Nome</th>
              <th className="px-3 py-2.5">Pessoa</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="w-32 px-3 py-2.5 text-right">Valor</th>
              <th className="w-32 px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                <td className="px-4 py-2 text-sm text-foreground">{e.nome || '—'}</td>
                <td className="px-3 py-2 text-sm text-foreground/70">{e.person}</td>
                <td className="px-3 py-2 text-sm text-foreground/70">{e.typeLabel}</td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-foreground">{formatBRLCents(e.amountCents)}</td>
                <td className="px-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => void commissionsService.setEntryStatus(e.id, e.status === 'pago' ? 'pendente' : 'pago')}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      e.status === 'pago' ? 'bg-success/10 text-success hover:bg-success/15' : 'bg-warning/10 text-warning hover:bg-warning/15',
                    )}
                  >
                    {e.status === 'pago' ? 'Pago' : 'Pendente'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NewGroupModal({ open, onClose, defaultMonth }: { open: boolean; onClose: () => void; defaultMonth: string }) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(GROUP_COLORS[0])
  const [month, setMonth] = React.useState(defaultMonth)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(monthFullLabelPt(defaultMonth))
    setColor(GROUP_COLORS[0])
    setMonth(defaultMonth)
  }, [open, defaultMonth])

  const submit = async () => {
    if (!name.trim()) { toast.error('Informe o nome do grupo.'); return }
    setSaving(true)
    try {
      await payablesService.createGroup({ name: name.trim(), color, month })
      toast.success('Grupo criado.')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo grupo"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Criar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Ex.: "Setembro 2026" ou "Folha de pagamento"'
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Mês</label>
          <MonthStepper value={month} onChange={setMonth} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Cor</label>
          <div className="flex flex-wrap gap-2">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                className={cn('h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-card', color === c ? 'ring-foreground/50' : 'ring-transparent')}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function DuplicateGroupModal({
  open, onClose, group, entries,
}: { open: boolean; onClose: () => void; group: PayableGroup; entries: PayableEntry[] }) {
  const [name, setName] = React.useState('')
  const [month, setMonth] = React.useState('')
  const [onlyFixo, setOnlyFixo] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const fixoCount = entries.filter((e) => e.categoria === 'fixo').length

  React.useEffect(() => {
    if (!open) return
    const next = addMonthsToId(group.month ?? currentMonthId(), 1)
    setMonth(next)
    setName(monthFullLabelPt(next))
    setOnlyFixo(true)
  }, [open, group.month])

  const submit = async () => {
    if (!name.trim()) { toast.error('Informe o nome do novo grupo.'); return }
    setSaving(true)
    try {
      await payablesService.duplicateGroup(group.id, name.trim(), { onlyFixo, month })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Duplicar pra um mês novo"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Duplicar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground/60">
          Cria um grupo novo já com os itens de <strong>{group.name}</strong>, prontos pra editar — sem precisar
          digitar tudo de novo. Cada item copiado nasce com status "A pagar", sem data, boleto ou valor real.
        </p>
        <Input
          label="Nome do novo grupo"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder='Ex.: "Outubro 2026"'
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Mês</label>
          <MonthStepper value={month} onChange={setMonth} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">O que copiar</label>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setOnlyFixo(true)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                onlyFixo ? 'border-accent bg-accent/5 text-foreground' : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
              )}
            >
              <span className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2', onlyFixo ? 'border-accent bg-accent' : 'border-line')} />
              <span>
                <span className="block font-medium">Só os itens Fixo</span>
                <span className="block text-xs text-foreground/50">
                  {fixoCount} item(ns) — aluguel, contabilidade, folha... o que se repete todo mês.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setOnlyFixo(false)}
              className={cn(
                'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                !onlyFixo ? 'border-accent bg-accent/5 text-foreground' : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
              )}
            >
              <span className={cn('mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2', !onlyFixo ? 'border-accent bg-accent' : 'border-line')} />
              <span>
                <span className="block font-medium">Todos os itens</span>
                <span className="block text-xs text-foreground/50">{entries.length} item(ns), incluindo Variável.</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
