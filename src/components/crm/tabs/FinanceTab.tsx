import * as React from 'react'
import {
  CheckCircle2,
  Clock3,
  CreditCard,
  Link2,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { db } from '@/services/db'
import { formatDateShort } from '@/lib/utils'
import type {
  Client,
  ExtraLink,
  Payment,
  PaymentMethod,
  PaymentType,
} from '@/types/client'

const TYPE_LABEL: Record<PaymentType, string> = {
  implementation: 'Implementação',
  monthly: 'Mensalidade',
  other: 'Outro',
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  card: 'Cartão',
  transfer: 'Transferência',
  asaas: 'Asaas',
  other: 'Outro',
}

export function FinanceTab({ client }: { client: Client }) {
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Payment | null>(null)

  const payments = client.payments ?? []
  const links = client.extraLinks ?? []

  const sorted = React.useMemo(
    () =>
      [...payments].sort((a, b) => {
        const ad = a.paidAt ?? a.dueDate ?? a.createdAt
        const bd = b.paidAt ?? b.dueDate ?? b.createdAt
        return bd.localeCompare(ad)
      }),
    [payments],
  )

  const totalPaid = sorted.reduce(
    (acc, p) => (p.paidAt ? acc + (p.value || 0) : acc),
    0,
  )
  const totalPending = sorted.reduce(
    (acc, p) => (p.paidAt ? acc : acc + (p.value || 0)),
    0,
  )

  const openNew = () => {
    setEditing(null)
    setModalOpen(true)
  }
  const openEdit = (p: Payment) => {
    setEditing(p)
    setModalOpen(true)
  }

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

  const removePayment = (id: string) => {
    if (!confirm('Remover este registro de pagamento?')) return
    const nextList = (client.payments ?? []).filter((p) => p.id !== id)
    db.updateClient(client.id, { payments: nextList })
    db.addLog(client.id, 'Pagamento removido')
    toast.success('Pagamento removido')
  }

  return (
    <div className="space-y-5">
      {/* Resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Mensalidade"
          value={
            client.monthlyValue
              ? `R$ ${client.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
              : '—'
          }
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

      {/* Pagamentos */}
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
            onClick={openNew}
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
                <tr className="text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="py-2 pr-3 font-normal">Tipo</th>
                  <th className="py-2 pr-3 font-normal">Valor</th>
                  <th className="py-2 pr-3 font-normal">Vencimento</th>
                  <th className="py-2 pr-3 font-normal">Pago em</th>
                  <th className="py-2 pr-3 font-normal">Método</th>
                  <th className="py-2 pr-0 text-right font-normal">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {sorted.map((p) => (
                  <tr key={p.id} className="text-white/85">
                    <td className="py-2 pr-3">
                      <Badge tone={p.type === 'implementation' ? 'info' : p.type === 'monthly' ? 'success' : 'neutral'}>
                        {TYPE_LABEL[p.type]}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      R$ {p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 pr-3 text-white/60">{formatDateShort(p.dueDate)}</td>
                    <td className="py-2 pr-3">
                      {p.paidAt ? (
                        <Badge tone="success" dot>{formatDateShort(p.paidAt)}</Badge>
                      ) : (
                        <Badge tone="warning" dot>Em aberto</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-white/60">
                      {p.method ? METHOD_LABEL[p.method] : '—'}
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          aria-label="Editar"
                          className="rounded-md p-1.5 text-white/50 hover:bg-white/[0.06] hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePayment(p.id)}
                          aria-label="Remover"
                          className="rounded-md p-1.5 text-white/40 hover:bg-danger/10 hover:text-danger"
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
      <ExtraLinksSection client={client} links={links} />

      {/* Notas livres */}
      <FinanceNotesSection client={client} />

      <PaymentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
        defaultMonthly={client.monthlyValue}
        defaultImplementation={client.implementationValue}
        onSubmit={(p) => {
          upsertPayment(p)
          setModalOpen(false)
        }}
      />
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
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
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-white/45">
          {label}
        </span>
        <span
          className={`grid h-6 w-6 place-items-center rounded-md ring-1 ${tones[tone]}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums text-white">
        {value}
      </div>
    </div>
  )
}

// ---------- Modal de pagamento ----------

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
  const [dueDate, setDueDate] = React.useState('')
  const [paidAt, setPaidAt] = React.useState('')
  const [method, setMethod] = React.useState<PaymentMethod | ''>('')
  const [reference, setReference] = React.useState('')
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setType(initial.type)
      setValue(initial.value?.toString() ?? '')
      setDueDate(initial.dueDate ?? '')
      setPaidAt(initial.paidAt ?? '')
      setMethod(initial.method ?? '')
      setReference(initial.reference ?? '')
      setNote(initial.note ?? '')
    } else {
      setType('monthly')
      setValue(defaultMonthly ? String(defaultMonthly) : '')
      setDueDate(new Date().toISOString().slice(0, 10))
      setPaidAt(new Date().toISOString().slice(0, 10))
      setMethod('pix')
      setReference('')
      setNote('')
    }
  }, [open, initial, defaultMonthly])

  // Quando troca o tipo no modo "novo", sugere valor padrão.
  React.useEffect(() => {
    if (initial) return
    if (type === 'monthly' && defaultMonthly) setValue(String(defaultMonthly))
    if (type === 'implementation' && defaultImplementation)
      setValue(String(defaultImplementation))
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
      dueDate: dueDate || undefined,
      paidAt: paidAt || undefined,
      method: method || undefined,
      reference: reference.trim() || undefined,
      note: note.trim() || undefined,
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
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>{initial ? 'Salvar' : 'Registrar'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Input
          label="Vencimento"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Input
          label="Pago em (vazio = em aberto)"
          type="date"
          value={paidAt}
          onChange={(e) => setPaidAt(e.target.value)}
        />
        <Select
          label="Método"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
          options={[
            { value: '', label: '—' },
            { value: 'pix', label: 'Pix' },
            { value: 'boleto', label: 'Boleto' },
            { value: 'card', label: 'Cartão' },
            { value: 'transfer', label: 'Transferência' },
            { value: 'asaas', label: 'Asaas' },
            { value: 'other', label: 'Outro' },
          ]}
        />
        <Input
          label="Referência (opcional)"
          placeholder="Ex.: Mensalidade Mai/2026"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <div className="mt-3">
        <Textarea
          label="Observação"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Modal>
  )
}

// ---------- Links extras ----------

function ExtraLinksSection({
  client,
  links,
}: {
  client: Client
  links: ExtraLink[]
}) {
  const [label, setLabel] = React.useState('')
  const [url, setUrl] = React.useState('')

  const add = () => {
    const l = label.trim()
    const u = url.trim()
    if (!l || !u) {
      toast.error('Informe rótulo e URL.')
      return
    }
    const next: ExtraLink = { id: db.newId(), label: l, url: u }
    db.updateClient(client.id, { extraLinks: [...links, next] })
    db.addLog(client.id, 'Link adicionado', l)
    setLabel('')
    setUrl('')
    toast.success('Link adicionado')
  }

  const remove = (id: string) => {
    db.updateClient(client.id, {
      extraLinks: links.filter((x) => x.id !== id),
    })
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
            <li
              key={l.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-white">{l.label}</div>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-xs text-accent hover:underline block"
                >
                  {l.url}
                </a>
              </div>
              <button
                type="button"
                onClick={() => remove(l.id)}
                aria-label="Remover"
                className="rounded-md p-1.5 text-white/40 hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <Input
          placeholder="Rótulo (ex.: Contrato 2026)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button variant="secondary" onClick={add} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Adicionar
        </Button>
      </div>
    </Section>
  )
}

// ---------- Notas livres ----------

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
