import * as React from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, Loader2, Plus, Settings2, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { useCommissionEntries, useCommissionTypes } from '@/hooks/useCommissions'
import {
  commissionsService,
  type CommissionEntry,
  type CommissionKind,
  type CommissionRole,
  type CommissionType,
} from '@/services/commissions'
import { formatBRLCents, parseBRLCents, prettifyCurrencyRaw, sanitizeCurrencyRaw } from '@/lib/currency'
import { addMonthsToId, currentMonthId, monthLabelPt, useMonthFilter } from '@/hooks/useMonthFilter'
import { cn, initials } from '@/lib/utils'

const ROLE_LABEL: Record<CommissionRole, string> = { sdr: 'SDR', suporte: 'Suporte' }
const TOTAL_NAMES = ['Luis', 'Jean', 'Arthur', 'Joao']

function rateLabel(t: Pick<CommissionType, 'kind' | 'rateCents' | 'ratePercent'>): string {
  return t.kind === 'fixed' ? formatBRLCents(t.rateCents ?? 0) : `${t.ratePercent ?? 0}%`
}

/** Comissões — aba "Gestão Interna" (Financeiro). 100% registro manual, de propósito: cada
 * venda/entrega/indicação vira um lançamento escolhido de um cardápio de tipos configurável, via
 * "Registrar comissão". Não lê nem escreve em lead_rows/clients/contracts. */
export function FinanceiroGestaoInternaPage() {
  const types = useCommissionTypes()
  const entries = useCommissionEntries()

  // Só mês atual + passado por padrão, "Adicionar mês" pra ir além — mesmo hook de Contrato/Vendas,
  // sem "Personalizado" (comissão é sempre pessoa-lançamento-MÊS, não intervalo livre).
  const filter = useMonthFilter([addMonthsToId(currentMonthId(), -1)])
  const month = filter.selected

  const [registerOpen, setRegisterOpen] = React.useState(false)
  const [typesOpen, setTypesOpen] = React.useState(false)

  const entriesInMonth = React.useMemo(() => entries.filter((e) => e.month === month), [entries, month])
  const bySdr = entriesInMonth.filter((e) => e.role === 'sdr')
  const bySuporte = entriesInMonth.filter((e) => e.role === 'suporte')

  // Total do mês por pessoa — só essas 4, na ordem pedida (soma SDR + Suporte, tanto faz o papel).
  const totalsByPerson = React.useMemo(() => {
    const totals = new Map<string, number>(TOTAL_NAMES.map((n) => [n, 0]))
    for (const e of entriesInMonth) {
      const match = TOTAL_NAMES.find((n) => n.toLowerCase() === e.person.trim().toLowerCase())
      if (match) totals.set(match, (totals.get(match) ?? 0) + e.amountCents)
    }
    return totals
  }, [entriesInMonth])

  const toggleStatus = (entry: CommissionEntry) => {
    void commissionsService.setEntryStatus(entry.id, entry.status === 'pago' ? 'pendente' : 'pago')
  }

  return (
    <>
      <TopBar
        title="Gestão Interna"
        subtitle="Financeiro"
        rightSlot={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setTypesOpen(true)} leftIcon={<Settings2 className="h-4 w-4" />}>
              Tipos de comissão
            </Button>
            <Button onClick={() => setRegisterOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
              Registrar comissão
            </Button>
          </div>
        }
      />
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-card p-3">
          {filter.months.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => filter.setSelected(m)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                month === m ? 'bg-accent/10 text-accent ring-1 ring-accent/20' : 'text-foreground/50 hover:bg-elevate/[0.04]',
              )}
            >
              {monthLabelPt(m)}
            </button>
          ))}
          <button
            type="button"
            onClick={filter.addMonth}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground/50 hover:bg-elevate/[0.04]"
          >
            <Plus className="h-3 w-3" /> Adicionar mês
          </button>
        </div>

        <EntriesTable title="Comissão SDR" entries={bySdr} onToggle={toggleStatus} types={types} />
        <EntriesTable title="Comissão Suporte" entries={bySuporte} onToggle={toggleStatus} types={types} />

        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Total por pessoa — {monthLabelPt(month)}</p>
          </div>
          <ul className="divide-y divide-line/60">
            {TOTAL_NAMES.map((name) => (
              <li key={name} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm font-medium text-foreground">{name}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatBRLCents(totalsByPerson.get(name) ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-foreground/40">
          Registro manual — cada venda/entrega/indicação é lançada aqui escolhendo um dos tipos
          configurados em "Registrar comissão".
        </p>
      </div>

      <RegisterEntryModal open={registerOpen} onClose={() => setRegisterOpen(false)} types={types} month={month} />
      <TypesModal open={typesOpen} onClose={() => setTypesOpen(false)} types={types} />
    </>
  )
}

function EntriesTable({
  title,
  entries,
  onToggle,
  types,
}: {
  title: string
  entries: CommissionEntry[]
  onToggle: (entry: CommissionEntry) => void
  types: CommissionType[]
}) {
  const total = entries.reduce((sum, e) => sum + e.amountCents, 0)
  const [deleting, setDeleting] = React.useState<CommissionEntry | null>(null)

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <span className="text-sm font-semibold tabular-nums text-foreground">{formatBRLCents(total)}</span>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">Nenhum lançamento nesse período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Pessoa</th>
                <th className="w-28 px-4 py-3">Contrato</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Referência</th>
                <th className="w-32 px-4 py-3 text-right">Valor</th>
                <th className="w-32 px-4 py-3 text-center">Status</th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const paid = e.status === 'pago'
                const incomplete = !e.typeId || e.amountCents <= 0
                return (
                  <tr
                    key={e.id}
                    className={cn('border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]', incomplete && 'bg-warning/[0.04]')}
                  >
                    <td className="px-4 py-3 text-sm">
                      <NomeCell entry={e} />
                    </td>
                    <td className="px-4 py-3">
                      <PersonCell entry={e} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void commissionsService.updateEntry(e.id, { contratoAssinado: !e.contratoAssinado })}
                        title={e.contratoAssinado ? 'Assinado — clique pra marcar como pendente' : 'Pendente — clique pra marcar como assinado'}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                          e.contratoAssinado ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning hover:bg-warning/15',
                        )}
                      >
                        {e.contratoAssinado ? 'Assinado' : 'Pendente'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <TypeCell entry={e} types={types} />
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <ReferenceCell entry={e} />
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-foreground">
                      <AmountCell entry={e} />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => onToggle(e)}
                        className={cn(
                          'mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                          paid ? 'bg-success/15 text-success hover:bg-success/25' : 'bg-warning/20 text-warning hover:bg-warning/30',
                        )}
                      >
                        {paid ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {paid ? 'Pago' : 'Pendente'}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <button
                        type="button"
                        onClick={() => setDeleting(e)}
                        title="Excluir lançamento"
                        className="grid h-7 w-7 place-items-center rounded text-foreground/30 hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir lançamento"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) void commissionsService.deleteEntry(deleting.id)
                setDeleting(null)
              }}
            >
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">
          Excluir a comissão de <strong>{deleting?.person}</strong> ({deleting?.typeLabel},{' '}
          {deleting && formatBRLCents(deleting.amountCents)})?
        </p>
      </Modal>
    </div>
  )
}

/** Nome do cliente/venda (mesmo nome da aba Vendas), editável no lugar. */
function NomeCell({ entry }: { entry: CommissionEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.nome)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value !== entry.nome) void commissionsService.updateEntry(entry.id, { nome: value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-full rounded-md border border-accent/40 bg-surface px-2 text-xs text-foreground outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(entry.nome); setEditing(true) }}
      className={cn('rounded px-1.5 py-0.5 text-left font-medium hover:bg-elevate/[0.06]', entry.nome ? 'text-foreground' : 'text-warning')}
    >
      {entry.nome || 'Definir nome…'}
    </button>
  )
}

/** Pessoa (quem recebe a comissão), editável no lugar — pra corrigir se registrou com o nome
 * errado, sem precisar apagar e recriar o lançamento inteiro. */
function PersonCell({ entry }: { entry: CommissionEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.person)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value.trim() && value !== entry.person) void commissionsService.updateEntry(entry.id, { person: value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-32 rounded-md border border-accent/40 bg-surface px-2 text-xs text-foreground outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(entry.person); setEditing(true) }}
      className="flex items-center gap-2.5 rounded px-1 py-0.5 hover:bg-elevate/[0.06]"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
        {initials(entry.person)}
      </span>
      <span className="text-sm font-medium text-foreground">{entry.person}</span>
    </button>
  )
}

/** Tipo de um lançamento, editável no lugar — clica no texto, escolhe na lista (do mesmo papel do
 * lançamento) e já salva. Trocar o tipo NÃO recalcula o valor sozinho (o valor já lançado é
 * intencional; se precisar ajustar, edita o valor à parte). */
function TypeCell({ entry, types }: { entry: CommissionEntry; types: CommissionType[] }) {
  const [editing, setEditing] = React.useState(false)
  const options = React.useMemo(
    () => types.filter((t) => t.role === entry.role && !t.archived).sort((a, b) => a.position - b.position),
    [types, entry.role],
  )

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={entry.typeId ?? ''}
        onBlur={() => setEditing(false)}
        onChange={(ev) => {
          const type = options.find((t) => t.id === ev.target.value)
          if (type) void commissionsService.updateEntry(entry.id, { typeId: type.id, typeLabel: type.label })
          setEditing(false)
        }}
        className="h-8 rounded-md border border-accent/40 bg-surface px-2 text-xs text-foreground outline-none"
      >
        <option value="" disabled>Selecionar…</option>
        {options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'rounded px-1.5 py-0.5 text-left hover:bg-elevate/[0.06]',
        entry.typeId ? 'text-foreground/70' : 'text-warning',
      )}
    >
      {entry.typeId ? entry.typeLabel : 'Escolher tipo…'}
    </button>
  )
}

/** Referência (nome do cliente/venda), editável no lugar. */
function ReferenceCell({ entry }: { entry: CommissionEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.reference)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value !== entry.reference) void commissionsService.updateEntry(entry.id, { reference: value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-full rounded-md border border-accent/40 bg-surface px-2 text-xs text-foreground outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(entry.reference); setEditing(true) }}
      className="rounded px-1.5 py-0.5 text-left text-foreground/55 hover:bg-elevate/[0.06]"
    >
      {entry.reference || '—'}
    </button>
  )
}

/** Valor do lançamento, editável no lugar (input simples, não o CurrencyField — aqui fecha só no
 * blur, sem o auto-save enquanto ainda digitando que o CurrencyField faz pra outras telas). */
function AmountCell({ entry }: { entry: CommissionEntry }) {
  const [editing, setEditing] = React.useState(false)
  // Sem "R$"/pontos de milhar enquanto edita — só dígitos e vírgula, igual o CurrencyField (evita
  // o bug de digitar "100" e virar R$1,00: sem passar pelo prettify, "100" ia direto pra
  // parseBRLCents como 100 CENTAVOS em vez de R$100,00).
  const [value, setValue] = React.useState(() => (entry.amountCents > 0 ? sanitizeCurrencyRaw(formatBRLCents(entry.amountCents)) : ''))

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
          const cents = parseBRLCents(value ? prettifyCurrencyRaw(value) : '')
          if (cents !== entry.amountCents) void commissionsService.updateEntry(entry.id, { amountCents: cents })
        }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-28 rounded-md border border-accent/40 bg-surface px-2 text-right text-xs text-foreground outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => { setValue(entry.amountCents > 0 ? sanitizeCurrencyRaw(formatBRLCents(entry.amountCents)) : ''); setEditing(true) }}
      className={cn('rounded px-1.5 py-0.5 hover:bg-elevate/[0.06]', entry.amountCents <= 0 && 'text-warning')}
    >
      {entry.amountCents > 0 ? formatBRLCents(entry.amountCents) : 'Definir valor…'}
    </button>
  )
}

function RegisterEntryModal({
  open,
  onClose,
  types,
  month,
}: {
  open: boolean
  onClose: () => void
  types: CommissionType[]
  month: string
}) {
  const [role, setRole] = React.useState<CommissionRole>('sdr')
  const [nome, setNome] = React.useState('')
  const [person, setPerson] = React.useState('')
  const [typeId, setTypeId] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [baseValue, setBaseValue] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [amountTouched, setAmountTouched] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const typesForRole = React.useMemo(
    () => types.filter((t) => t.role === role && !t.archived).sort((a, b) => a.position - b.position),
    [types, role],
  )
  const selectedType = typesForRole.find((t) => t.id === typeId) ?? null

  React.useEffect(() => {
    if (!open) return
    setRole('sdr')
    setNome('')
    setPerson('')
    setTypeId('')
    setReference('')
    setBaseValue('')
    setAmount('')
    setAmountTouched(false)
  }, [open])

  // Troca de papel invalida o tipo escolhido (cardápio é diferente).
  React.useEffect(() => { setTypeId(''); setAmountTouched(false) }, [role])

  // Recalcula o valor sozinho a partir do tipo/valor base — só enquanto a pessoa não mexeu no
  // campo de valor à mão (edição manual sempre vence, pra permitir ajuste caso a caso).
  React.useEffect(() => {
    if (!selectedType || amountTouched) return
    if (selectedType.kind === 'fixed') {
      setAmount(formatBRLCents(selectedType.rateCents ?? 0))
    } else {
      const baseCents = parseBRLCents(baseValue)
      const cents = Math.round((baseCents * (selectedType.ratePercent ?? 0)) / 100)
      setAmount(baseCents > 0 ? formatBRLCents(cents) : '')
    }
  }, [selectedType, baseValue, amountTouched])

  const submit = async () => {
    if (!person.trim()) { toast.error('Informe a pessoa.'); return }
    if (!selectedType) { toast.error('Escolha o tipo de comissão.'); return }
    const amountCents = parseBRLCents(amount)
    if (amountCents <= 0) { toast.error('Informe o valor da comissão.'); return }
    setSaving(true)
    try {
      await commissionsService.createEntry({
        nome: nome.trim(),
        person: person.trim(),
        role,
        typeId: selectedType.id,
        typeLabel: selectedType.label,
        reference: reference.trim(),
        baseValueCents: selectedType.kind === 'percent' ? parseBRLCents(baseValue) : null,
        amountCents,
        month,
      })
      toast.success('Comissão registrada.')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar comissão"
      description={`Mês: ${monthLabelPt(month)}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Registrar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['sdr', 'suporte'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                role === r ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60 hover:bg-elevate/[0.03]',
              )}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>

        <Input label="Nome (cliente/venda)" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: mesmo nome da aba Vendas" autoFocus />

        <Input label="Pessoa" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Ex.: Arthur" />

        <Select
          label="Tipo de comissão"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          options={[
            { value: '', label: 'Selecionar…' },
            ...typesForRole.map((t) => ({ value: t.id, label: `${t.label} (${rateLabel(t)})` })),
          ]}
        />

        {selectedType?.kind === 'percent' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">
              Valor da venda/mensalidade (base do {selectedType.ratePercent}%)
            </label>
            <CurrencyField
              value={baseValue}
              onSave={setBaseValue}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-foreground"
            />
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">
            Valor da comissão {selectedType?.kind === 'percent' ? '(calculado — pode ajustar)' : ''}
          </label>
          <CurrencyField
            value={amount}
            onSave={(v) => { setAmount(v); setAmountTouched(true) }}
            className="h-10 rounded-lg border border-line bg-surface px-3 text-foreground"
          />
        </div>

        <Input
          label="Referência (opcional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Ex.: nome do cliente/venda"
        />
      </div>
    </Modal>
  )
}

function TypesModal({ open, onClose, types }: { open: boolean; onClose: () => void; types: CommissionType[] }) {
  const [adding, setAdding] = React.useState<CommissionRole | null>(null)

  return (
    <Modal open={open} onClose={onClose} title="Tipos de comissão" size="lg">
      <div className="space-y-5">
        {(['sdr', 'suporte'] as const).map((role) => (
          <div key={role}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">{ROLE_LABEL[role]}</p>
              <Button size="sm" variant="ghost" onClick={() => setAdding(role)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
                Novo tipo
              </Button>
            </div>
            <ul className="space-y-1.5">
              {types
                .filter((t) => t.role === role)
                .sort((a, b) => a.position - b.position)
                .map((t) => (
                  <TypeRow key={t.id} type={t} />
                ))}
            </ul>
          </div>
        ))}
      </div>

      <NewTypeModal open={!!adding} role={adding} onClose={() => setAdding(null)} />
    </Modal>
  )
}

function TypeRow({ type }: { type: CommissionType }) {
  const [editing, setEditing] = React.useState(false)
  const [label, setLabel] = React.useState(type.label)
  const [kind, setKind] = React.useState<CommissionKind>(type.kind)
  const [rateValue, setRateValue] = React.useState(
    type.kind === 'fixed' ? formatBRLCents(type.rateCents ?? 0) : String(type.ratePercent ?? 0),
  )
  const [saving, setSaving] = React.useState(false)

  const startEdit = () => {
    setLabel(type.label)
    setKind(type.kind)
    setRateValue(type.kind === 'fixed' ? formatBRLCents(type.rateCents ?? 0) : String(type.ratePercent ?? 0))
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      await commissionsService.updateType(type.id, {
        label,
        kind,
        rateCents: kind === 'fixed' ? parseBRLCents(rateValue) : null,
        ratePercent: kind === 'percent' ? Number(rateValue.replace(',', '.')) || 0 : null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-accent/30 bg-accent/[0.03] p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-8 flex-1 rounded-md border border-line px-2 text-sm outline-none focus:border-accent"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CommissionKind)}
            className="h-8 rounded-md border border-line px-2 text-xs text-foreground/70 outline-none"
          >
            <option value="fixed">R$ fixo</option>
            <option value="percent">%</option>
          </select>
          <input
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
            placeholder={kind === 'fixed' ? 'R$ 0,00' : '0'}
            className="h-8 w-24 rounded-md border border-line px-2 text-sm outline-none focus:border-accent"
          />
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancelar</Button>
          <Button size="sm" onClick={save} loading={saving}>Salvar</Button>
        </div>
      </li>
    )
  }

  return (
    <li
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2',
        type.archived ? 'border-line/50 opacity-50' : 'border-line/60',
      )}
    >
      <button type="button" onClick={startEdit} className="min-w-0 flex-1 text-left text-sm text-foreground/85 hover:text-foreground">
        {type.label}
      </button>
      <span className="shrink-0 text-xs font-medium text-foreground/50">{rateLabel(type)}</span>
      <button
        type="button"
        onClick={() => void commissionsService.updateType(type.id, { archived: !type.archived })}
        title={type.archived ? 'Reativar' : 'Arquivar'}
        className="shrink-0 text-[11px] font-medium text-foreground/40 hover:text-danger"
      >
        {type.archived ? 'Reativar' : 'Arquivar'}
      </button>
    </li>
  )
}

function NewTypeModal({ open, role, onClose }: { open: boolean; role: CommissionRole | null; onClose: () => void }) {
  const [label, setLabel] = React.useState('')
  const [kind, setKind] = React.useState<CommissionKind>('fixed')
  const [rateValue, setRateValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setLabel('')
    setKind('fixed')
    setRateValue('')
  }, [open])

  const submit = async () => {
    if (!role || !label.trim()) { toast.error('Informe o nome do tipo.'); return }
    setSaving(true)
    try {
      await commissionsService.createType({
        role,
        label: label.trim(),
        kind,
        rateCents: kind === 'fixed' ? parseBRLCents(rateValue) : null,
        ratePercent: kind === 'percent' ? Number(rateValue.replace(',', '.')) || 0 : null,
      })
      toast.success('Tipo criado.')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Novo tipo — ${role ? ROLE_LABEL[role] : ''}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>Criar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Nome" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Venda cross-sell" autoFocus />
        <Select
          label="Formato"
          value={kind}
          onChange={(e) => setKind(e.target.value as CommissionKind)}
          options={[
            { value: 'fixed', label: 'Valor fixo (R$)' },
            { value: 'percent', label: 'Percentual (%)' },
          ]}
        />
        {kind === 'fixed' ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Valor fixo</label>
            <CurrencyField value={rateValue} onSave={setRateValue} className="h-10 rounded-lg border border-line bg-surface px-3 text-foreground" />
          </div>
        ) : (
          <Input label="Percentual (%)" value={rateValue} onChange={(e) => setRateValue(e.target.value)} placeholder="Ex.: 10" />
        )}
      </div>
    </Modal>
  )
}
