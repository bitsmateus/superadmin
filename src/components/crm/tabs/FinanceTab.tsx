import * as React from 'react'
import {
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
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { db } from '@/services/db'
import { asaasApi, type AsaasCustomer } from '@/services/asaas'
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
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [syncing, setSyncing] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState<Payment | null>(null)
  const [confirmUnlink, setConfirmUnlink] = React.useState(false)

  const payments = client.payments ?? []
  const links = client.extraLinks ?? []

  // Ao abrir a aba, se o cliente já está vinculado ao Asaas mas não tem
  // pagamentos em memória (ex.: após restart do servidor), sincroniza
  // automaticamente sem precisar clicar novamente.
  React.useEffect(() => {
    if (!client.asaasCustomerId) return
    if (payments.length > 0) return
    setSyncing(true)
    syncPaymentsForClient(client)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[finance] auto-sync on open failed', err)
      })
      .finally(() => setSyncing(false))
  // Executa apenas quando o cliente muda ou o vínculo muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id, client.asaasCustomerId])

  const onSyncNow = async () => {
    if (!client.asaasCustomerId) return
    setSyncing(true)
    try {
      const r = await syncPaymentsForClient(client)
      toast.success(
        `Asaas sincronizado: ${r.inserted} novo(s), ${r.updated} atualizado(s).`,
      )
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao sincronizar com Asaas'))
    } finally {
      setSyncing(false)
    }
  }

  const onUnlink = () => setConfirmUnlink(true)

  const confirmUnlinkAction = () => {
    unlinkAsaasCustomer(client.id)
    setConfirmUnlink(false)
    toast.success('Vínculo Asaas removido')
  }

  const sorted = React.useMemo(
    () =>
      [...payments].sort((a, b) => {
        const ad = a.paidAt ?? a.dueDate ?? a.createdAt ?? ''
        const bd = b.paidAt ?? b.dueDate ?? b.createdAt ?? ''
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

  const removePayment = (p: Payment) => {
    setConfirmDelete(p)
  }

  const confirmDeletePayment = () => {
    if (!confirmDelete) return
    const nextList = (client.payments ?? []).filter((p) => p.id !== confirmDelete.id)
    db.updateClient(client.id, { payments: nextList })
    db.addLog(client.id, 'Pagamento removido')
    setConfirmDelete(null)
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

      {/* Asaas */}
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
                onClick={onUnlink}
                aria-label="Desvincular Asaas"
                className="rounded-md p-2 text-foreground/40 hover:bg-danger/10 hover:text-danger"
                title="Desvincular Asaas"
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
                <tr className="text-left text-[11px] uppercase tracking-wider text-foreground/40">
                  <th className="py-2 pr-3 font-normal">Tipo</th>
                  <th className="py-2 pr-3 font-normal">Valor</th>
                  <th className="py-2 pr-3 font-normal">Vencimento</th>
                  <th className="py-2 pr-3 font-normal">Pago em</th>
                  <th className="py-2 pr-3 font-normal">Método</th>
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
                    <td className="py-2 pr-3 tabular-nums">
                      R$ {p.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 pr-3 text-foreground/60">{formatDateShort(p.dueDate)}</td>
                    <td className="py-2 pr-3">
                      {p.paidAt ? (
                        <Badge tone="success" dot>{formatDateShort(p.paidAt)}</Badge>
                      ) : (
                        <Badge tone="warning" dot>Em aberto</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-foreground/60">
                      {p.method ? METHOD_LABEL[p.method] : '—'}
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          aria-label="Editar"
                          className="rounded-md p-1.5 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removePayment(p)}
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

      <LinkAsaasModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        client={client}
        onLinked={async (customer) => {
          linkAsaasCustomer(client.id, customer.id)
          setLinkOpen(false)
          toast.success(`Vinculado: ${customer.name}`)
          // Já roda um primeiro sync
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
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDeletePayment}>
              Remover
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/75">
          Remover este pagamento de{' '}
          <strong className="text-foreground">
            R${' '}
            {(confirmDelete?.value ?? 0).toLocaleString('pt-BR', {
              minimumFractionDigits: 2,
            })}
          </strong>
          ? A ação não pode ser desfeita.
        </p>
      </Modal>

      <Modal
        open={confirmUnlink}
        onClose={() => setConfirmUnlink(false)}
        title="Desvincular Asaas"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmUnlink(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmUnlinkAction}>
              Desvincular
            </Button>
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
    <div className="rounded-xl border border-line bg-elevate/[0.02] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-foreground/45">
          {label}
        </span>
        <span
          className={`grid h-6 w-6 place-items-center rounded-md ring-1 ${tones[tone]}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">
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
              className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{l.label}</div>
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
                className="rounded-md p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger"
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

// ---------- Modal de vínculo Asaas ----------

function LinkAsaasModal({
  open,
  onClose,
  client,
  onLinked,
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
    // Sugere busca inicial pelo email do cliente
    const initial = client.email || client.company || client.name
    setQuery(initial ?? '')
    setResults([])
    setTouched(false)
    if (initial) {
      // executa busca automática
      void doSearch(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id])

  const doSearch = async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    setTouched(true)
    try {
      const looksEmail = /@/.test(q)
      const looksDoc = /^\d{11,14}$/.test(q.replace(/\D+/g, ''))
      const res = await asaasApi.listCustomers(
        looksEmail
          ? { email: q.trim(), limit: 20 }
          : looksDoc
            ? { cpfCnpj: q.replace(/\D+/g, ''), limit: 20 }
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doSearch(query)
          }}
        />
        <Button variant="secondary" onClick={() => doSearch(query)} loading={searching}>
          Buscar
        </Button>
      </div>

      <div className="mt-4 space-y-1.5">
        {!touched && (
          <p className="text-xs text-foreground/45">
            Use o e-mail cadastrado no Asaas pra match exato.
          </p>
        )}
        {touched && results.length === 0 && !searching && (
          <EmptyState
            title="Nenhum cliente encontrado"
            description="Tente outro termo ou peça pro admin verificar o ambiente Asaas em Configurações."
          />
        )}
        {results.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5"
          >
            <div className="min-w-0">
              <div className="text-sm text-foreground truncate">{c.name}</div>
              <div className="text-xs text-foreground/55 truncate">
                {c.email || '—'}
                {c.cpfCnpj && <> · CPF/CNPJ {c.cpfCnpj}</>}
              </div>
            </div>
            <Button size="sm" variant="primary" onClick={() => onLinked(c)}>
              Vincular
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

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
