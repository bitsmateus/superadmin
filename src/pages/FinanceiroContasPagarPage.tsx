import * as React from 'react'
import { toast } from 'sonner'
import { ChevronDown, FileText, Loader2, Plus, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { usePayableEntries, usePayableGroups } from '@/hooks/usePayables'
import { payablesService, type PayableEntry, type PayableGroup, type PayableStatus } from '@/services/payables'
import { formatBRLCents, parseBRLCents, prettifyCurrencyRaw, sanitizeCurrencyRaw } from '@/lib/currency'
import { cn } from '@/lib/utils'

const MAX_BOLETO_BYTES = 10 * 1024 * 1024

const STATUS_LABEL: Record<PayableStatus, string> = { a_pagar: 'A pagar', agendado: 'Agendado', pago: 'Pago' }
const STATUS_STYLE: Record<PayableStatus, string> = {
  a_pagar: 'bg-danger/15 text-danger',
  agendado: 'bg-warning/20 text-warning',
  pago: 'bg-success/15 text-success',
}

const GROUP_COLORS = ['#4F8EF7', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#64748B']

/** Contas a Pagar (Financeiro) — board estilo Monday: lista contínua de grupos criados à mão
 * (ex.: "Abril 2026", "Folha de pagamento"), cada um com seus itens. Sem filtro de mês — tudo
 * visível de uma vez, igual o board original que serviu de referência. */
export function FinanceiroContasPagarPage() {
  const groups = usePayableGroups()
  const entries = usePayableEntries()
  const [newGroupOpen, setNewGroupOpen] = React.useState(false)

  return (
    <>
      <TopBar
        title="Contas a Pagar"
        subtitle="Financeiro"
        rightSlot={
          <Button onClick={() => setNewGroupOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Novo grupo
          </Button>
        }
      />
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-foreground/40">
            Nenhum grupo ainda — crie um pra começar (ex.: "Abril 2026" ou "Folha de pagamento").
          </div>
        ) : (
          groups
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((g) => (
              <GroupCard key={g.id} group={g} entries={entries.filter((e) => e.groupId === g.id)} />
            ))
        )}
      </div>
      <NewGroupModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} />
    </>
  )
}

function GroupCard({ group, entries }: { group: PayableGroup; entries: PayableEntry[] }) {
  const [open, setOpen] = React.useState(true)
  const [deleting, setDeleting] = React.useState(false)
  const sorted = entries.slice().sort((a, b) => a.position - b.position)

  const totals = sorted.reduce(
    (acc, e) => ({
      previsto: acc.previsto + e.previstoCents,
      comissao: acc.comissao + (e.comissaoCents ?? 0),
      real: acc.real + (e.realCents ?? 0),
    }),
    { previsto: 0, comissao: 0, real: 0 },
  )

  const addItem = () => {
    void payablesService.createEntry({ groupId: group.id, elemento: '', previstoCents: 0 })
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card" style={{ borderLeft: `4px solid ${group.color}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 items-center gap-2">
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-foreground/40 transition-transform', !open && '-rotate-90')} />
          <GroupNameField group={group} />
          <span className="shrink-0 text-xs text-foreground/40">{sorted.length} item(ns)</span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={addItem} leftIcon={<Plus className="h-3.5 w-3.5" />}>
            Item
          </Button>
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
                  <td colSpan={9} className="px-4 py-6 text-center text-xs text-foreground/40">Nenhum item nesse grupo.</td>
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
          Excluir o grupo <strong>{group.name}</strong> e os {sorted.length} item(ns) dentro dele? Essa ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
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

function ElementoCell({ entry }: { entry: PayableEntry }) {
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(entry.elemento)

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        onBlur={() => { setEditing(false); if (value !== entry.elemento) void payablesService.updateEntry(entry.id, { elemento: value }) }}
        onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur() }}
        className="h-8 w-full min-w-[160px] rounded-md border border-accent/40 bg-surface px-2 text-sm text-foreground outline-none"
      />
    )
  }
  return (
    <button
      type="button"
      onClick={() => { setValue(entry.elemento); setEditing(true) }}
      className={cn('w-full rounded px-1.5 py-0.5 text-left hover:bg-elevate/[0.06]', !entry.elemento && 'text-foreground/35')}
    >
      {entry.elemento || 'Nome do item…'}
    </button>
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
    <input
      type="date"
      value={entry.data ?? ''}
      onChange={(e) => void payablesService.updateEntry(entry.id, { data: e.target.value || null })}
      className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
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

function NewGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(GROUP_COLORS[0])
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName('')
    setColor(GROUP_COLORS[0])
  }, [open])

  const submit = async () => {
    if (!name.trim()) { toast.error('Informe o nome do grupo.'); return }
    setSaving(true)
    try {
      await payablesService.createGroup({ name: name.trim(), color })
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
          placeholder='Ex.: "Abril 2026" ou "Folha de pagamento"'
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
        />
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
