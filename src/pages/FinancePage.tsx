import * as React from 'react'
import {
  AlertTriangle,
  CalendarRange,
  CreditCard,
  Download,
  ExternalLink,
  Repeat,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Navigate, useNavigate } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { AsaasImportModal } from '@/components/crm/AsaasImportModal'
import { useClients } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'
import { isBooted } from '@/services/db'
import { formatDateShort } from '@/lib/utils'
import type { Client, Payment } from '@/types/client'

type Range = '30d' | 'mtd' | 'ytd' | 'custom'

const TYPE_LABEL = {
  implementation: 'Implementação',
  monthly: 'Mensalidade',
  other: 'Outro',
} as const

const METHOD_LABEL = {
  pix: 'Pix',
  boleto: 'Boleto',
  card: 'Cartão',
  transfer: 'Transferência',
  asaas: 'Asaas',
  other: 'Outro',
} as const

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
function startOfYear(d = new Date()): Date {
  return new Date(d.getFullYear(), 0, 1)
}
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
function brl(n: number): string {
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
function monthLabel(d: Date): string {
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
}

export function FinancePage() {
  const { profile, loading } = useAuth()
  const navigate = useNavigate()
  const clients = useClients()

  const [range, setRange] = React.useState<Range>('mtd')
  const [from, setFrom] = React.useState<string>(toISODate(startOfMonth()))
  const [to, setTo] = React.useState<string>(toISODate(new Date()))
  const [importOpen, setImportOpen] = React.useState(false)

  React.useEffect(() => {
    const now = new Date()
    if (range === 'mtd') {
      setFrom(toISODate(startOfMonth(now)))
      setTo(toISODate(now))
    } else if (range === '30d') {
      setFrom(toISODate(daysAgo(30)))
      setTo(toISODate(now))
    } else if (range === 'ytd') {
      setFrom(toISODate(startOfYear(now)))
      setTo(toISODate(now))
    }
  }, [range])

  const allPayments = React.useMemo(
    () =>
      clients.flatMap((c) =>
        (c.payments ?? []).map((p) => ({ payment: p, client: c })),
      ),
    [clients],
  )

  const mrr = React.useMemo(
    () =>
      clients
        .filter((c) => c.stage !== 'churned' && (c.monthlyValue ?? 0) > 0)
        .reduce((acc, c) => acc + (c.monthlyValue ?? 0), 0),
    [clients],
  )

  const chartData = React.useMemo(() => {
    const buckets: { label: string; key: string; impl: number; monthly: number }[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      buckets.push({ label: monthLabel(d), key, impl: 0, monthly: 0 })
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]))
    for (const { payment } of allPayments) {
      if (!payment.paidAt) continue
      const d = new Date(payment.paidAt)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const i = idx.get(k)
      if (i === undefined) continue
      if (payment.type === 'implementation') buckets[i].impl += payment.value
      else buckets[i].monthly += payment.value
    }
    return buckets
  }, [allPayments])

  if (loading) {
    return (
      <div className="grid h-full place-items-center p-10 text-sm text-white/55">
        Carregando…
      </div>
    )
  }
  if (!canSeeFinancials(profile?.role)) {
    return <Navigate to="/" replace />
  }
  if (!isBooted()) {
    return (
      <div className="px-8 py-6 space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // Filtra pelo período (usa paidAt)
  const fromDate = new Date(from + 'T00:00:00')
  const toDate = new Date(to + 'T23:59:59')
  const inRange = (iso: string | undefined): boolean => {
    if (!iso) return false
    const t = new Date(iso).getTime()
    return t >= fromDate.getTime() && t <= toDate.getTime()
  }

  const paidInRange = allPayments.filter(({ payment }) => inRange(payment.paidAt))

  const implThisPeriod = paidInRange
    .filter(({ payment }) => payment.type === 'implementation')
    .reduce((acc, { payment }) => acc + payment.value, 0)
  const monthlyThisPeriod = paidInRange
    .filter(({ payment }) => payment.type === 'monthly')
    .reduce((acc, { payment }) => acc + payment.value, 0)
  const totalThisPeriod = paidInRange.reduce((acc, { payment }) => acc + payment.value, 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = allPayments.filter(({ payment }) => {
    if (payment.paidAt) return false
    if (!payment.dueDate) return false
    return new Date(payment.dueDate).getTime() < today.getTime()
  })
  const overdueTotal = overdue.reduce((acc, { payment }) => acc + payment.value, 0)

  const txInPeriod = [...paidInRange]
    .sort((a, b) =>
      (b.payment.paidAt ?? '').localeCompare(a.payment.paidAt ?? ''),
    )
    .slice(0, 100)

  return (
    <>
      <TopBar
        title="Financeiro"
        subtitle="MRR, implementações e inadimplência"
        rightSlot={
          <Button
            variant="secondary"
            onClick={() => setImportOpen(true)}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Importar do Asaas
          </Button>
        }
      />

      <AsaasImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />

      <div className="px-8 py-6 space-y-5">
        {/* Filtro de período */}
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-line bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-white/40" />
            <RangePill active={range === 'mtd'} onClick={() => setRange('mtd')}>
              Este mês
            </RangePill>
            <RangePill active={range === '30d'} onClick={() => setRange('30d')}>
              Últimos 30 dias
            </RangePill>
            <RangePill active={range === 'ytd'} onClick={() => setRange('ytd')}>
              Este ano
            </RangePill>
            <RangePill active={range === 'custom'} onClick={() => setRange('custom')}>
              Custom
            </RangePill>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              label="De"
              type="date"
              value={from}
              onChange={(e) => {
                setRange('custom')
                setFrom(e.target.value)
              }}
              containerClassName="w-36"
            />
            <Input
              label="Até"
              type="date"
              value={to}
              onChange={(e) => {
                setRange('custom')
                setTo(e.target.value)
              }}
              containerClassName="w-36"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => exportCsv(txInPeriod)}
              disabled={txInPeriod.length === 0}
            >
              Exportar CSV
            </Button>
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={<Repeat className="h-4 w-4" />}
            tone="info"
            label="MRR atual"
            value={brl(mrr)}
            hint={`${clients.filter((c) => c.stage !== 'churned' && (c.monthlyValue ?? 0) > 0).length} cliente(s)`}
          />
          <Metric
            icon={<TrendingUp className="h-4 w-4" />}
            tone="success"
            label="Implementação no período"
            value={brl(implThisPeriod)}
            hint={`${paidInRange.filter((x) => x.payment.type === 'implementation').length} pagamento(s)`}
          />
          <Metric
            icon={<Wallet className="h-4 w-4" />}
            tone="success"
            label="Mensalidades no período"
            value={brl(monthlyThisPeriod)}
            hint={`${paidInRange.filter((x) => x.payment.type === 'monthly').length} pagamento(s)`}
          />
          <Metric
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={overdue.length > 0 ? 'danger' : 'neutral'}
            label="Inadimplência"
            value={brl(overdueTotal)}
            hint={`${overdue.length} cobrança(s) vencida(s)`}
          />
        </div>

        {/* Gráfico 12 meses */}
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Últimos 12 meses</h3>
            <div className="flex items-center gap-3 text-[11px] text-white/55">
              <LegendDot color="rgba(99,102,241,0.85)" /> Mensalidades
              <LegendDot color="rgba(34,197,94,0.85)" /> Implementação
            </div>
          </div>
          <MonthlyChart data={chartData} />
        </div>

        {/* Inadimplência */}
        {overdue.length > 0 && (
          <div className="rounded-xl border border-danger/30 bg-danger/[0.05] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4" />
                Cobranças vencidas
              </h3>
              <Badge tone="danger">{overdue.length}</Badge>
            </div>
            <ul className="space-y-1.5">
              {overdue.slice(0, 6).map(({ payment, client }) => (
                <li
                  key={payment.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-danger/20 bg-bg/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-white">
                      {client.company || client.name}
                    </div>
                    <div className="text-xs text-white/55">
                      {TYPE_LABEL[payment.type]} · venceu em {formatDateShort(payment.dueDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-sm text-white">
                      {brl(payment.value)}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/clients?open=${client.id}`)}
                      className="rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
                      aria-label="Abrir cliente"
                      title="Abrir cliente"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Transações no período */}
        <div className="rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-white">
              <CreditCard className="h-3.5 w-3.5 text-accent" />
              Transações no período
            </h3>
            <Badge tone="neutral">{txInPeriod.length}</Badge>
          </div>
          {txInPeriod.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Sem pagamentos no período"
                description="Ajuste o intervalo de datas ou registre pagamentos nas abas Financeiro dos clientes."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Pago em</TH>
                  <TH>Cliente</TH>
                  <TH>Tipo</TH>
                  <TH>Valor</TH>
                  <TH>Método</TH>
                  <TH>Ref.</TH>
                </tr>
              </THead>
              <TBody>
                {txInPeriod.map(({ payment, client }) => (
                  <TR key={payment.id}>
                    <TD className="text-white/85">{formatDateShort(payment.paidAt)}</TD>
                    <TD>
                      <div className="text-sm text-white">
                        {client.company || client.name}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {client.name}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={payment.type === 'implementation' ? 'info' : payment.type === 'monthly' ? 'success' : 'neutral'}>
                        {TYPE_LABEL[payment.type]}
                      </Badge>
                    </TD>
                    <TD className="tabular-nums text-white">{brl(payment.value)}</TD>
                    <TD className="text-white/60">
                      {payment.method ? METHOD_LABEL[payment.method] : '—'}
                    </TD>
                    <TD className="text-white/55">{payment.reference ?? '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {txInPeriod.length > 0 && (
            <div className="border-t border-line px-4 py-2.5 flex items-center justify-end gap-4 text-sm">
              <span className="text-white/55">Total no período</span>
              <span className="tabular-nums font-semibold text-white">
                {brl(totalThisPeriod)}
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function Metric({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  tone: 'info' | 'success' | 'danger' | 'warning' | 'neutral'
}) {
  const tones: Record<typeof tone, string> = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    neutral: 'bg-white/[0.04] text-white/55 ring-white/10',
  }
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/45">
          {label}
        </span>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ring-1 ${tones[tone]}`}>
          {icon}
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-white tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-[11px] text-white/45">{hint}</div>
      )}
    </div>
  )
}

function RangePill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors ' +
        (active
          ? 'bg-white/[0.08] text-white ring-1 ring-line'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white')
      }
    >
      {children}
    </button>
  )
}

function LegendDot({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color }}
      />
    </span>
  )
}

function MonthlyChart({
  data,
}: {
  data: { label: string; impl: number; monthly: number }[]
}) {
  const max = Math.max(1, ...data.map((d) => d.impl + d.monthly))
  const w = 760
  const h = 220
  const pad = { l: 44, r: 12, t: 10, b: 28 }
  const barW = (w - pad.l - pad.r) / data.length
  const innerW = barW * 0.62

  const gridLines = 4

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full min-w-[640px]"
        preserveAspectRatio="none"
      >
        {/* Grid */}
        {Array.from({ length: gridLines + 1 }).map((_, i) => {
          const y = pad.t + ((h - pad.t - pad.b) / gridLines) * i
          const v = max - (max / gridLines) * i
          return (
            <g key={i}>
              <line
                x1={pad.l}
                x2={w - pad.r}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y + 3}
                fontSize={10}
                fill="rgba(255,255,255,0.35)"
                textAnchor="end"
              >
                {Math.round(v / 1000)}k
              </text>
            </g>
          )
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const total = d.impl + d.monthly
          const totalH = ((h - pad.t - pad.b) * total) / max
          const monthlyH = ((h - pad.t - pad.b) * d.monthly) / max
          const x = pad.l + barW * i + (barW - innerW) / 2
          const yBase = h - pad.b
          return (
            <g key={i}>
              {/* monthly (bottom) */}
              <rect
                x={x}
                y={yBase - monthlyH}
                width={innerW}
                height={monthlyH}
                fill="rgba(99,102,241,0.85)"
                rx={3}
              />
              {/* impl (top) */}
              <rect
                x={x}
                y={yBase - totalH}
                width={innerW}
                height={totalH - monthlyH}
                fill="rgba(34,197,94,0.85)"
                rx={3}
              />
              <text
                x={x + innerW / 2}
                y={h - pad.b + 14}
                fontSize={10}
                fill="rgba(255,255,255,0.45)"
                textAnchor="middle"
              >
                {d.label}
              </text>
              {total > 0 && (
                <title>
                  {d.label}: {brl(total)} ({brl(d.impl)} impl · {brl(d.monthly)} mensal)
                </title>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function exportCsv(
  rows: { payment: Payment; client: Client }[],
) {
  const header = ['pago_em', 'cliente', 'empresa', 'tipo', 'valor', 'metodo', 'referencia', 'observacao']
  const lines = [header.join(';')]
  for (const { payment, client } of rows) {
    const cells = [
      payment.paidAt ?? '',
      client.name,
      client.company,
      TYPE_LABEL[payment.type],
      payment.value.toFixed(2).replace('.', ','),
      payment.method ? METHOD_LABEL[payment.method] : '',
      payment.reference ?? '',
      (payment.note ?? '').replace(/[\r\n;]+/g, ' '),
    ]
    lines.push(cells.map(csvEscape).join(';'))
  }
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `financeiro_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(v: string): string {
  if (/[";\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}
