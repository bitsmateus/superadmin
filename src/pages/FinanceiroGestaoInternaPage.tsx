import * as React from 'react'
import { Check, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { useLeadBoards, useLeadRows } from '@/hooks/useLeadBoards'
import { useClients } from '@/hooks/useClients'
import { useCommissionPayments, useCommissionRates } from '@/hooks/useCommissions'
import { commissionsService, type CommissionRole, type CommissionStatus } from '@/services/commissions'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { currentMonthId, addMonthsToId, monthLabelPt } from '@/hooks/useMonthFilter'
import { cn, initials } from '@/lib/utils'

// Mesma lista usada em Vendas ("Quem fechou a venda") — é a única fonte de nomes disponível hoje
// pra atribuir comissão. Sem separação formal entre "quem é SDR" e "quem é Suporte" no sistema:
// as duas tabelas abaixo usam o mesmo grupo de nomes, cada uma com sua própria conta.
const NAMES = ['Arthur', 'Luis', 'Ian', 'Mateus']

function monthOptions(): string[] {
  const cur = currentMonthId()
  return Array.from({ length: 6 }, (_, i) => addMonthsToId(cur, -i))
}

/** Comissões — aba "Gestão Interna" (Financeiro). Só LÊ vendas (quadro is_vendas) e entregas
 * (clients.deliveryCompletedAt) que já existem — não escreve nelas, não muda nada nas outras
 * abas. O que essa tela grava é só: os valores de comissão configurados, e o status
 * pago/pendente por pessoa+papel+mês (granularidade pessoa-mês, não por venda individual). */
export function FinanceiroGestaoInternaPage() {
  const boards = useLeadBoards()
  const vendasBoard = React.useMemo(() => boards.find((b) => b.isVendas), [boards])
  const vendasRows = useLeadRows(vendasBoard?.id ?? '')
  const clients = useClients()
  const rates = useCommissionRates()
  const payments = useCommissionPayments()

  const [month, setMonth] = React.useState(() => currentMonthId())

  const sdrCounts = React.useMemo(() => {
    const map = new Map<string, number>(NAMES.map((n) => [n, 0]))
    for (const r of vendasRows) {
      if (r.vendaRevertida) continue
      if ((r.fechamento || r.createdAt).slice(0, 7) !== month) continue
      if (map.has(r.sdr)) map.set(r.sdr, (map.get(r.sdr) ?? 0) + 1)
    }
    return map
  }, [vendasRows, month])

  const suporteDeliveryCounts = React.useMemo(() => {
    const map = new Map<string, number>(NAMES.map((n) => [n, 0]))
    for (const c of clients) {
      if (!c.deliveryCompletedAt) continue
      if (c.deliveryCompletedAt.slice(0, 7) !== month) continue
      const name = c.responsavelEntrega ?? ''
      if (map.has(name)) map.set(name, (map.get(name) ?? 0) + 1)
    }
    return map
  }, [clients, month])

  const suporteAvulsaCounts = React.useMemo(() => {
    const map = new Map<string, number>(NAMES.map((n) => [n, 0]))
    for (const r of vendasRows) {
      if (r.vendaRevertida || r.veioDoFunil) continue
      if ((r.fechamento || r.createdAt).slice(0, 7) !== month) continue
      if (map.has(r.sdr)) map.set(r.sdr, (map.get(r.sdr) ?? 0) + 1)
    }
    return map
  }, [vendasRows, month])

  const statusFor = (person: string, role: CommissionRole): CommissionStatus =>
    payments.find((p) => p.person === person && p.role === role && p.month === month)?.status ?? 'pendente'

  const togglePayment = (person: string, role: CommissionRole) => {
    const next = statusFor(person, role) === 'pago' ? 'pendente' : 'pago'
    void commissionsService.setPaymentStatus(person, role, month, next)
  }

  return (
    <>
      <TopBar title="Gestão Interna" subtitle="Financeiro" />
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card p-3">
          <div className="flex items-center gap-1.5">
            {monthOptions().map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(m)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  month === m ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
                )}
              >
                {monthLabelPt(m)}
              </button>
            ))}
          </div>
        </div>

        <RatesCard rates={rates} />

        <CommissionTable
          title="Comissão SDR"
          description={`R$ por venda fechada no mês × ${formatBRLCents(rates.sdrPerSaleCents)}`}
          rows={NAMES.map((person) => {
            const count = sdrCounts.get(person) ?? 0
            return { person, count, valueCents: count * rates.sdrPerSaleCents }
          })}
          role="sdr"
          statusFor={statusFor}
          onToggle={togglePayment}
          countLabel="vendas"
        />

        <CommissionTable
          title="Comissão Suporte"
          description={`Entregas × ${formatBRLCents(rates.suportePerDeliveryCents)} + vendas avulsas × ${formatBRLCents(rates.suportePerVendaAvulsaCents)}`}
          rows={NAMES.map((person) => {
            const deliveries = suporteDeliveryCounts.get(person) ?? 0
            const avulsas = suporteAvulsaCounts.get(person) ?? 0
            return {
              person,
              count: deliveries + avulsas,
              valueCents: deliveries * rates.suportePerDeliveryCents + avulsas * rates.suportePerVendaAvulsaCents,
              detail: `${deliveries} entrega(s) · ${avulsas} venda(s) avulsa(s)`,
            }
          })}
          role="suporte"
          statusFor={statusFor}
          onToggle={togglePayment}
          countLabel="itens"
        />

        <p className="text-[11px] text-foreground/40">
          Contagem sempre ao vivo em cima das vendas e entregas já registradas no sistema — essa
          tela não cria nem move nada nas outras abas, só lê. O que fica salvo aqui é o valor de
          comissão configurado e o status pago/pendente de cada pessoa no mês.
        </p>
      </div>
    </>
  )
}

function RatesCard({ rates }: { rates: ReturnType<typeof useCommissionRates> }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="mb-3 text-sm font-semibold text-foreground">Valores de comissão</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <RateField
          label="Por venda (SDR)"
          value={rates.sdrPerSaleCents}
          onSave={(cents) => void commissionsService.updateRates({ sdrPerSaleCents: cents })}
        />
        <RateField
          label="Por entrega (Suporte)"
          value={rates.suportePerDeliveryCents}
          onSave={(cents) => void commissionsService.updateRates({ suportePerDeliveryCents: cents })}
        />
        <RateField
          label="Por venda avulsa (Suporte)"
          value={rates.suportePerVendaAvulsaCents}
          onSave={(cents) => void commissionsService.updateRates({ suportePerVendaAvulsaCents: cents })}
        />
      </div>
    </div>
  )
}

function RateField({ label, value, onSave }: { label: string; value: number; onSave: (cents: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-foreground/50">{label}</label>
      <CurrencyField
        value={formatBRLCents(value)}
        onSave={(next) => onSave(parseBRLCents(next))}
        className="h-9 rounded-lg border border-line px-3 text-sm text-foreground/70 focus:border-accent"
      />
    </div>
  )
}

function CommissionTable({
  title,
  description,
  rows,
  role,
  statusFor,
  onToggle,
  countLabel,
}: {
  title: string
  description: string
  rows: { person: string; count: number; valueCents: number; detail?: string }[]
  role: CommissionRole
  statusFor: (person: string, role: CommissionRole) => CommissionStatus
  onToggle: (person: string, role: CommissionRole) => void
  countLabel: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-[11px] text-foreground/45">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-3">Pessoa</th>
              <th className="w-32 px-4 py-3 text-right">{countLabel}</th>
              <th className="w-40 px-4 py-3 text-right">Comissão</th>
              <th className="w-36 px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = statusFor(r.person, role)
              const paid = status === 'pago'
              return (
                <tr key={r.person} className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
                        {initials(r.person)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-foreground">{r.person}</div>
                        {r.detail && <div className="text-[11px] text-foreground/40">{r.detail}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-sm tabular-nums">{r.count}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-foreground">
                    {formatBRLCents(r.valueCents)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onToggle(r.person, role)}
                      disabled={r.valueCents === 0}
                      className={cn(
                        'mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-40',
                        paid ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-warning/20 text-warning hover:bg-warning/30',
                      )}
                    >
                      {paid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      {paid ? 'Pago' : 'Pendente'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
