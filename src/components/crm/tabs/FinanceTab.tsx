import * as React from 'react'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock3,
  CreditCard,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  Unlink,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { db } from '@/services/db'
import { asaasApi, paymentStatusFromAsaas, type AsaasCustomer } from '@/services/asaas'
import {
  linkAsaasCustomer,
  syncPaymentsForClient,
  unlinkAsaasCustomer,
} from '@/services/asaasSync'
import { extractErrorMessage } from '@/api/client'
import { formatDateShort } from '@/lib/utils'
import type {
  Client,
  ExtraLink,
  Payment,
  PaymentType,
} from '@/types/client'

const TYPE_LABEL: Record<PaymentType, string> = {
  implementation: 'Implementação',
  monthly: 'Mensalidade',
  other: 'Outro',
}

export function FinanceTab({ client }: { client: Client }) {
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Payment | null>(null)
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<Payment | null>(null)
  const [confirmUnlink, setConfirmUnlink] = React.useState(false)

  // Cobrança (Asaas) state — moved from ContractTab
  const [implValue, setImplValue] = React.useState(client.implementationValue?.toString() ?? '')
  const [monthly, setMonthly] = React.useState(client.monthlyValue?.toString() ?? '')
  const [dueDay, setDueDay] = React.useState(client.dueDay?.toString() ?? '')
  const [creatingCharge, setCreatingCharge] = React.useState(false)
  const [checkingPayment, setCheckingPayment] = React.useState(false)

  React.useEffect(() => {
    setImplValue(client.implementationValue?.toString() ?? '')
    setMonthly(client.monthlyValue?.toString() ?? '')
    setDueDay(client.dueDay?.toString() ?? '')
  }, [client.id])

  const payments = client.payments ?? []

  // Auto-sync on open when linked but no payments loaded
  React.useEffect(() => {
    if (!client.asaasCustomerId) return
    if (payments.length > 0) return
    setSyncing(true)
    syncPaymentsForClient(client)
      .catch((err) => console.warn('[finance] auto-sync on open failed', err))
      .finally(() => setSyncing(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, client.asaasCustomerId])

  // ── Cobrança helpers ──────────────────────────────────────────────────────

  const maybeAdvance = (
    base: Partial<Client>,
    signedAt: string | null | undefined,
    paymentId: string | null | undefined,
  ): Partial<Client> => {
    const signed = signedAt ?? client.contractSignedAt
    const payment = paymentId ?? client.asaasPaymentId
    if (client.stage === 'contract' && signed && payment) {
      return { ...base, stage: 'briefing' }
    }
    return base
  }

  const saveFinancials = () => {
    db.updateClient(client.id, {
      implementationValue: implValue ? Number(implValue) : undefined,
      monthlyValue: monthly ? Number(monthly) : undefined,
      dueDay: dueDay ? Number(dueDay) : undefined,
    })
    db.addLog(client.id, 'Valores financeiros atualizados')
    toast.success('Valores salvos')
  }

  const createCharge = async () => {
    if (!implValue || !monthly) {
      toast.error('Informe valor de implementação e mensalidade.')
      return
    }
    setCreatingCharge(true)
    try {
      let asaasCustomerId = client.asaasCustomerId
      if (!asaasCustomerId) {
        const customer = await asaasApi.createCustomer({
          name: client.name,
          email: client.email,
          phone: client.phone,
          mobilePhone: client.phone,
        })
        asaasCustomerId = customer.id
      }
      const today = new Date()
      const payment = await asaasApi.createPayment({
        customer: asaasCustomerId!,
        value: Number(implValue),
        dueDate: today.toISOString().slice(0, 10),
        description: `Implementação — ${client.company}`,
      })
      const nextDue = new Date(today)
      if (dueDay) {
        const clampedDay = Math.min(Math.max(Number(dueDay), 1), 28)
        nextDue.setDate(clampedDay)
      } else {
        nextDue.setMonth(nextDue.getMonth() + 1)
      }
      if (nextDue.getTime() <= today.getTime()) nextDue.setMonth(nextDue.getMonth() + 1)

      const subscription = await asaasApi.createSubscription({
        customer: asaasCustomerId!,
        value: Number(monthly),
        nextDueDate: nextDue.toISOString().slice(0, 10),
        description: `Mensalidade — ${client.company}`,
      })

      const patch = maybeAdvance(
        {
          asaasCustomerId,
          asaasPaymentId: payment.id,
          asaasSubscriptionId: subscription.id,
          implementationValue: Number(implValue),
          monthlyValue: Number(monthly),
          dueDay: dueDay ? Number(dueDay) : undefined,
          paymentStatus: paymentStatusFromAsaas(payment.status),
          lastPaymentCheck: new Date().toISOString(),
        },
        null,
        payment.id,
      )
      db.updateClient(client.id, patch)
      db.addLog(client.id, 'Cobrança criada no Asaas', `Impl: R$ ${implValue} · Mensal: R$ ${monthly}`)
      toast.success(patch.stage === 'briefing'
        ? 'Cobrança criada · etapa avançada para Briefing'
        : 'Cobrança criada no Asaas')
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao criar cobrança'))
    } finally {
      setCreatingCharge(false)
    }
  }

  const checkPayment = async () => {
    if (!client.asaasPaymentId) {
      toast.error('Nenhuma cobrança Asaas vinculada.')
      return
    }
    setCheckingPayment(true)
    try {
      const payment = await asaasApi.getPayment(client.asaasPaymentId)
      const status = paymentStatusFromAsaas(payment.status)
      db.updateClient(client.id, { paymentStatus: status, lastPaymentCheck: new Date().toISOString() })
      db.addLog(client.id, 'Status de pagamento verificado', payment.status)
      toast.success(`Status: ${payment.status}`)
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao verificar pagamento'))
    } finally {
      setCheckingPayment(false)
    }
  }

  // ── Sync / Asaas ─────────────────────────────────────────────────────────

  const onSyncNow = async () => {
    if (!client.asaasCustomerId) return
    setSyncing(true)
    try {
      const r = await syncPaymentsForClient(client)
      toast.success(`Asaas sincronizado: ${r.inserted} novo(s), ${r.updated} atualizado(s).`)
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao sincronizar com Asaas'))
    } finally {
      setSyncing(false)
    }
  }

  const confirmUnlinkAction = () => {
    unlinkAsaasCustomer(client.id)
    setConfirmUnlink(false)
    toast.success('Vínculo Asaas removido')
  }

  // ── Pagamentos ────────────────────────────────────────────────────────────

  const sorted = React.useMemo(
    () =>
      [...payments].sort((a, b) => {
        const ad = a.paidAt ?? a.dueDate ?? a.createdAt ?? ''
        const bd = b.paidAt ?? b.dueDate ?? b.createdAt ?? ''
        return bd.localeCompare(ad)
      }),
    [payments],
  )

  const totalPaid = sorted.reduce((acc, p) => (p.paidAt ? acc + (p.value || 0) : acc), 0)
  const totalPending = sorted.reduce((acc, p) => (p.paidAt ? acc : acc + (p.value || 0)), 0)

  const upsertPayment = (next: Payment) => {
    const current = client.payments ?? []
    const idx = current.findIndex((p) => p.id === next.id)
    const nextList =
      idx === -1
        ? [next, ...current]
        : current.map((p) => (p.id === next.id ? next : p))
    db.updateClient(client.id, { payments: nextList })
    db.addLog(
      client.id,
      idx === -1 ? 'Pagamento registrado' : 'Pagamento atualizado',
      `${TYPE_LABEL[next.type]} · R$ ${next.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    )
    toast.success(idx === -1 ? 'Pagamento registrado' : 'Pagamento atualizado')
  }

  const confirmDeletePayment = () => {
    if (!confirmDelete) return
    const nextList = (client.payments ?? []).filter((p) => p.id !== confirmDelete.id)
    db.updateClient(client.id, { payments: nextList })
    db.addLog(client.id, 'Pagamento removido')
    setConfirmDelete(null)
    toast.success('Pagamento removido')
  }

  const paymentTone =
    client.paymentStatus === 'paid' ? 'success'
    : client.paymentStatus === 'overdue' ? 'danger'
    : 'warning'

  return (
    <div className="space-y-5">
      {/* Resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Mensalidade"
          value={client.monthlyValue
            ? `R$ ${client.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : '—'}
          tone="info"
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Total pago"
          value={`R$ ${totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          tone="success"
        />
        <SummaryCard
          icon={<Clock3 className="h-4 w-4" />}
          label="A receber"
          value={`R$ ${totalPending.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          tone="warning"
        />
      </div>

      {/* Pagamento vencido */}
      {client.paymentStatus === 'overdue' && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Pagamento vencido — considere bloquear o tenant até regularizar.</span>
        </div>
      )}

      {/* Cobrança (Asaas) — movido do Contrato */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5 text-accent" />
            Cobrança (Asaas)
          </span>
        }
        action={
          client.paymentStatus ? (
            <Badge tone={paymentTone} dot>
              {client.paymentStatus === 'paid' ? 'Pago'
                : client.paymentStatus === 'overdue' ? 'Vencido'
                : 'Pendente'}
            </Badge>
          ) : null
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Implementação (R$)"
            type="number"
            inputMode="decimal"
            value={implValue}
            onChange={(e) => setImplValue(e.target.value)}
          />
          <Input
            label="Mensalidade (R$)"
            type="number"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
          />
          <Input
            label="Dia de vencimento"
            type="number"
            min={1}
            max={31}
            leftIcon={<Calendar className="h-4 w-4" />}
            value={dueDay}
            onChange={(e) => {
              const raw = e.target.value
              if (!raw) { setDueDay(''); return }
              setDueDay(String(Math.min(Math.max(Number(raw), 1), 31)))
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/40">
          <span>
            {client.asaasCustomerId
              ? `Cliente Asaas: ${client.asaasCustomerId}`
              : 'Sem cliente Asaas vinculado'}
            {client.lastPaymentCheck && <> · última verificação: {formatDateShort(client.lastPaymentCheck)}</>}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={saveFinancials}>
              Salvar valores
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={checkPayment}
              loading={checkingPayment}
              leftIcon={!checkingPayment ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
              disabled={!client.asaasPaymentId}
            >
              Verificar pagamento
            </Button>
            <Button
              size="sm"
              onClick={createCharge}
              loading={creatingCharge}
              leftIcon={!creatingCharge ? <CreditCard className="h-3.5 w-3.5" /> : undefined}
            >
              Criar cobrança no Asaas
            </Button>
          </div>
        </div>
      </Section>

      {/* Asaas vínculo */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-elevate/[0.02] px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
            <CreditCard className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Asaas</div>
            <div className="text-xs text-foreground/55 truncate">
              {client.asaasCustomerId
                ? `Vinculado · ${client.asaasCustomerId}`
                : 'Sem vínculo — vincule pra importar pagamentos existentes'}
              {client.lastPaymentCheck && client.asaasCustomerId && (
                <> · última verificação {formatDateShort(client.lastPaymentCheck)}</>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {client.asaasCustomerId ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={syncing}
                onClick={onSyncNow}
                leftIcon={!syncing ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
              >
                Sincronizar
              </Button>
              <button
                type="button"
                onClick={() => setConfirmUnlink(true)}
                aria-label="Desvincular Asaas"
                className="rounded-md p-2 text-foreground/40 hover:bg-danger/10 hover:text-danger"
              >
                <Unlink className="h-4 w-4" />
              </button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setLinkOpen(true)}
              leftIcon={<Link2 className="h-3.5 w-3.5" />}
            >
              Vincular Asaas
            </Button>
          )}
        </div>
      </div>

      {/* Pagamentos manuais */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <CreditCard className="h-3.5 w-3.5 text-accent" />
            Pagamentos
          </span>
        }
        action={
          <Button
            size="sm"
            variant="primary"
            onClick={() => { setEditing(null); setModalOpen(true) }}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Registrar
          </Button>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState
            title="Sem pagamentos registrados"
            description="Adicione mensalidades, implementação ou outros valores recebidos."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-foreground/40">
                  <th className="py-2 pr-3 font-normal">Tipo</th>
                  <th className="py-2 pr-3 font-normal">Valor</th>
                  <th className="py-2 pr-3 font-normal">Data</th>
                  <th className="py-2 pr-3 font-normal">Pago via</th>
                  <th className="py-2 pr-3 font-normal">Descrição</th>
                  <th className="py-2 pr-0 text-right font-normal">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((p) => (
                  <tr key={p.id} className="text-foreground/85">
                    <td className="py-2 pr-3">
                      <Badge tone={p.type === 'implementation' ? 'info' : p.type === 'monthly' ? 'success' : 'neutral'}>
                        {TYPE_LABEL[p.type]}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums font-medium">
                      R$ {p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 pr-3">
                      {p.paidAt ? (
                        <Badge tone="success" dot>{formatDateShort(p.paidAt)}</Badge>
                      ) : (
                        <Badge tone="warning" dot>Em aberto</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-foreground/60 max-w-[100px] truncate">
                      {p.paidVia ?? '—'}
                    </td>
                    <td className="py-2 pr-3 text-foreground/60 max-w-[140px] truncate">
                      {p.reference ?? '—'}
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { setEditing(p); setModalOpen(true) }}
                          aria-label="Editar"
                          className="rounded-md p-1.5 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(p)}
                          aria-label="Remover"
                          className="rounded-md p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Links extras */}
      <ExtraLinksSection client={client} links={client.extraLinks ?? []} />

      {/* Notas financeiras */}
      <FinanceNotesSection client={client} />

      {/* Modais */}
      <PaymentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
        defaultMonthly={client.monthlyValue}
        defaultImplementation={client.implementationValue}
        onSubmit={(p) => { upsertPayment(p); setModalOpen(false) }}
      />

      <LinkAsaasModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        client={client}
        onLinked={async (customer) => {
          linkAsaasCustomer(client.id, customer.id)
          setLinkOpen(false)
          toast.success(`Vinculado: ${customer.name}`)
          try {
            setSyncing(true)
            const r = await syncPaymentsForClient({ ...client, asaasCustomerId: customer.id })
            toast.success(`${r.inserted} pagamento(s) importado(s) do Asaas.`)
          } catch (err) {
            toast.error(extractErrorMessage(err, 'Falha ao importar pagamentos'))
          } finally {
            setSyncing(false)
          }
        }}
      />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remover pagamento"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmDeletePayment}>Remover</Button>
          </>
        }
      >
        <p className="text-sm text-foreground/75">
          Remover este pagamento de{' '}
          <strong className="text-foreground">
            R$ {(confirmDelete?.value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </strong>?
          A ação não pode ser desfeita.
        </p>
      </Modal>

      <Modal
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        title="Desvincular Asaas"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmUnlink(false)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmUnlinkAction}>Desvincular</Button>
          </>
        }
      >
        <p className="text-sm text-foreground/75">
          Remove o vínculo com o cliente Asaas. Pagamentos já importados
          continuam no histórico. Você pode vincular novamente depois.
        </p>
      </Modal>
    </div>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'info' | 'success' | 'warning'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  }
  return (
    <div className="rounded-xl border border-line bg-elevate/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
        <span className={`grid h-6 w-6 place-items-center rounded-md ring-1 ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

// ─── PaymentModal (simplificado: valor, pago via, descrição, data) ────────────

function PaymentModal({
  open,
  onClose,
  initial,
  defaultMonthly,
  defaultImplementation,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  initial: Payment | null
  defaultMonthly?: number
  defaultImplementation?: number
  onSubmit: (p: Payment) => void
}) {
  const [type, setType] = React.useState<PaymentType>('monthly')
  const [value, setValue] = React.useState('')
  const [paidVia, setPaidVia] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [paidAt, setPaidAt] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setType(initial.type)
      setValue(initial.value?.toString() ?? '')
      setPaidVia(initial.paidVia ?? '')
      setReference(initial.reference ?? '')
      setPaidAt(initial.paidAt ?? '')
    } else {
      setType('monthly')
      setValue(defaultMonthly ? String(defaultMonthly) : '')
      setPaidVia('')
      setReference('')
      setPaidAt(new Date().toISOString().slice(0, 10))
    }
  }, [open, initial, defaultMonthly])

  React.useEffect(() => {
    if (initial) return
    if (type === 'monthly' && defaultMonthly) setValue(String(defaultMonthly))
    if (type === 'implementation' && defaultImplementation) setValue(String(defaultImplementation))
  }, [type, initial, defaultMonthly, defaultImplementation])

  const submit = () => {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) {
      toast.error('Informe um valor maior que zero.')
      return
    }
    const next: Payment = {
      id: initial?.id ?? db.newId(),
      type,
      value: num,
      paidVia: paidVia.trim() || undefined,
      reference: reference.trim() || undefined,
      paidAt: paidAt || undefined,
      method: initial?.method,
      dueDate: initial?.dueDate,
      note: initial?.note,
      source: initial?.source ?? 'manual',
      createdAt: initial?.createdAt ?? new Date().toISOString(),
    }
    onSubmit(next)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar pagamento' : 'Registrar pagamento'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit}>{initial ? 'Salvar' : 'Registrar'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Tipo"
            value={type}
            onChange={(e) => setType(e.target.value as PaymentType)}
            options={[
              { value: 'monthly', label: 'Mensalidade' },
              { value: 'implementation', label: 'Implementação' },
              { value: 'other', label: 'Outro' },
            ]}
          />
          <Input
            label="Valor (R$)"
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="0,00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <Input
          label="Pago via"
          placeholder="Ex.: Infinity Tape, Sicredi, Pix manual…"
          value={paidVia}
          onChange={(e) => setPaidVia(e.target.value)}
        />
        <Input
          label="Descrição"
          placeholder="Ex.: Mensalidade Maio/2026"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Input
          label="Data do pagamento (vazio = em aberto)"
          type="date"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
      </div>
    </Modal>
  )
}

// ─── ExtraLinks ───────────────────────────────────────────────────────────────

function ExtraLinksSection({ client, links }: { client: Client; links: ExtraLink[] }) {
  const [label, setLabel] = React.useState('')
  const [url, setUrl] = React.useState('')

  const add = () => {
    const l = label.trim()
    const u = url.trim()
    if (!l || !u) { toast.error('Informe rótulo e URL.'); return }
    db.updateClient(client.id, { extraLinks: [...links, { id: db.newId(), label: l, url: u }] })
    db.addLog(client.id, 'Link adicionado', l)
    setLabel('')
    setUrl('')
    toast.success('Link adicionado')
  }

  const remove = (id: string) => {
    db.updateClient(client.id, { extraLinks: links.filter((x) => x.id !== id) })
    db.addLog(client.id, 'Link removido')
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-accent" />
          Links e referências
        </span>
      }
    >
      {links.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{l.label}</div>
                <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-xs text-accent hover:underline block">
                  {l.url}
                </a>
              </div>
              <button type="button" onClick={() => remove(l.id)} aria-label="Remover" className="rounded-md p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <Input placeholder="Rótulo" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button variant="secondary" onClick={add} leftIcon={<Plus className="h-3.5 w-3.5" />}>Adicionar</Button>
      </div>
    </Section>
  )
}

// ─── FinanceNotes ─────────────────────────────────────────────────────────────

function FinanceNotesSection({ client }: { client: Client }) {
  const [value, setValue] = React.useState(client.financeNotes ?? '')
  React.useEffect(() => setValue(client.financeNotes ?? ''), [client.id])

  const save = () => {
    const trimmed = value.trim()
    if (trimmed === (client.financeNotes ?? '')) return
    db.updateClient(client.id, { financeNotes: trimmed || undefined })
    db.addLog(client.id, 'Notas financeiras atualizadas')
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <StickyNote className="h-3.5 w-3.5 text-accent" />
          Anotações financeiras
        </span>
      }
    >
      <Textarea
        rows={3}
        placeholder="Detalhes do acordo, descontos, observações de cobrança…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
      />
    </Section>
  )
}

// ─── LinkAsaasModal ───────────────────────────────────────────────────────────

function LinkAsaasModal({
  open, onClose, client, onLinked,
}: {
  open: boolean
  onClose: () => void
  client: Client
  onLinked: (customer: AsaasCustomer) => void
}) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<AsaasCustomer[]>([])
  const [searching, setSearching] = React.useState(false)
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const initial = client.email || client.company || client.name
    setQuery(initial ?? '')
    setResults([])
    setTouched(false)
    if (initial) void doSearch(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id])

  const doSearch = async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setSearching(true)
    setTouched(true)
    try {
      const looksEmail = /@/.test(q)
      const looksDoc = /^\d{11,14}$/.test(q.replace(/\D+/g, ''))
      const res = await asaasApi.listCustomers(
        looksEmail ? { email: q.trim(), limit: 20 }
        : looksDoc ? { cpfCnpj: q.replace(/\D+/g, ''), limit: 20 }
        : { name: q.trim(), limit: 20 },
      )
      setResults(res.data)
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao buscar no Asaas'))
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vincular cliente Asaas"
      description="Busque o cliente existente no Asaas por e-mail, CPF/CNPJ ou nome."
      size="lg"
    >
      <div className="flex gap-2">
        <Input
          placeholder="email@exemplo.com ou CPF ou nome"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(query) }}
        />
        <Button variant="secondary" onClick={() => doSearch(query)} loading={searching}>Buscar</Button>
      </div>
      <div className="mt-4 space-y-1.5">
        {!touched && <p className="text-xs text-foreground/45">Use o e-mail cadastrado no Asaas pra match exato.</p>}
        {touched && results.length === 0 && !searching && (
          <EmptyState title="Nenhum cliente encontrado" description="Tente outro termo ou verifique o ambiente Asaas em Configurações." />
        )}
        {results.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{c.name}</div>
              <div className="text-xs text-foreground/55 truncate">
                {c.email || '—'}
                {c.cpfCnpj && <> · CPF/CNPJ {c.cpfCnpj}</>}
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => onLinked(c)}>Vincular</Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
