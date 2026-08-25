import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import type { LeadLabelField, LeadRow } from '@/types/leadBoard'

export type FilterField = 'tipo' | 'diaContato' | 'status' | 'sdr' | 'retornar' | 'createdAt'

export interface FilterRule {
  id: string
  field: FilterField
  operator: string
  value: string
  value2: string
}

const FIELD_LABELS: Record<FilterField, string> = {
  tipo: 'Tipo',
  diaContato: 'Dia de contato',
  status: 'Status',
  sdr: 'SDR',
  retornar: 'Retornar',
  createdAt: 'Log de criação',
}

const FIELD_KIND: Record<FilterField, 'label' | 'date'> = {
  tipo: 'label',
  diaContato: 'label',
  status: 'label',
  sdr: 'label',
  retornar: 'date',
  createdAt: 'date',
}

const LABEL_OPERATORS = [
  { value: 'is', label: 'é' },
  { value: 'is_not', label: 'não é' },
  { value: 'is_empty', label: 'está vazio' },
  { value: 'is_not_empty', label: 'não está vazio' },
]

const DATE_OPERATORS = [
  { value: 'is', label: 'a data é' },
  { value: 'is_not', label: 'a data não é' },
  { value: 'between', label: 'está entre' },
  { value: 'after', label: 'é após' },
  { value: 'before', label: 'é antes' },
  { value: 'on_or_after', label: 'é em ou após' },
  { value: 'on_or_before', label: 'é em ou antes' },
]

function newRule(): FilterRule {
  return { id: crypto.randomUUID(), field: 'status', operator: 'is', value: '', value2: '' }
}

function dayKey(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

/** Todas as regras precisam bater (E) pra linha aparecer. */
export function matchesLeadFilters(row: LeadRow, rules: FilterRule[]): boolean {
  return rules.every((rule) => {
    if (FIELD_KIND[rule.field] === 'label') {
      const val = row[rule.field] as string
      switch (rule.operator) {
        case 'is': return !rule.value || val === rule.value
        case 'is_not': return !rule.value || val !== rule.value
        case 'is_empty': return !val
        case 'is_not_empty': return !!val
        default: return true
      }
    }
    const key = dayKey(row[rule.field] as string)
    switch (rule.operator) {
      case 'is': return !rule.value || key === rule.value
      case 'is_not': return !rule.value || key !== rule.value
      case 'between': return !rule.value || !rule.value2 || (key >= rule.value && key <= rule.value2)
      case 'after': return !rule.value || key > rule.value
      case 'before': return !rule.value || key < rule.value
      case 'on_or_after': return !rule.value || key >= rule.value
      case 'on_or_before': return !rule.value || key <= rule.value
      default: return true
    }
  })
}

const selectClass =
  'h-8 rounded-md border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent'

function FilterRuleRow({
  rule,
  onChange,
  onRemove,
  pageId,
}: {
  rule: FilterRule
  onChange: (patch: Partial<FilterRule>) => void
  onRemove: () => void
  pageId: string
}) {
  const kind = FIELD_KIND[rule.field]
  const labels = useLeadLabels(kind === 'label' ? (rule.field as LeadLabelField) : 'status', pageId)
  const operators = kind === 'label' ? LABEL_OPERATORS : DATE_OPERATORS
  const needsValue = rule.operator !== 'is_empty' && rule.operator !== 'is_not_empty'
  const needsValue2 = rule.operator === 'between'

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-elevate/[0.02] p-2.5">
      <span className="text-xs text-foreground/40">Onde</span>
      <select
        value={rule.field}
        onChange={(e) => {
          const field = e.target.value as FilterField
          const nextKind = FIELD_KIND[field]
          onChange({ field, operator: nextKind === 'label' ? 'is' : 'is', value: '', value2: '' })
        }}
        className={selectClass}
      >
        {(Object.keys(FIELD_LABELS) as FilterField[]).map((f) => (
          <option key={f} value={f}>{FIELD_LABELS[f]}</option>
        ))}
      </select>
      <select
        value={rule.operator}
        onChange={(e) => onChange({ operator: e.target.value })}
        className={selectClass}
      >
        {operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && (
        kind === 'label' ? (
          <select value={rule.value} onChange={(e) => onChange({ value: e.target.value })} className={selectClass}>
            <option value="">Selecione…</option>
            {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
          </select>
        ) : (
          <input
            type="date"
            value={rule.value}
            onChange={(e) => onChange({ value: e.target.value })}
            className={selectClass}
          />
        )
      )}
      {needsValue2 && (
        <input
          type="date"
          value={rule.value2}
          onChange={(e) => onChange({ value2: e.target.value })}
          className={selectClass}
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remover filtro"
        className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded text-foreground/35 hover:bg-danger/10 hover:text-danger"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export interface LeadFiltersModalProps {
  open: boolean
  onClose: () => void
  rules: FilterRule[]
  onChange: (rules: FilterRule[]) => void
  visibleCount: number
  totalCount: number
  pageId: string
}

export function LeadFiltersModal({ open, onClose, rules, onChange, visibleCount, totalCount, pageId }: LeadFiltersModalProps) {
  const addRule = () => onChange([...rules, newRule()])
  const updateRule = (id: string, patch: Partial<FilterRule>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id))

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Filtros avançados"
      description={
        rules.length === 0
          ? `Mostrando tudo — ${totalCount} nome${totalCount === 1 ? '' : 's'}`
          : `Mostrando ${visibleCount} de ${totalCount} nome${totalCount === 1 ? '' : 's'}`
      }
    >
      <div className="space-y-2.5">
        {rules.length === 0 && (
          <p className="text-xs text-foreground/40">Nenhum filtro ainda.</p>
        )}
        {rules.map((rule) => (
          <FilterRuleRow
            key={rule.id}
            rule={rule}
            onChange={(patch) => updateRule(rule.id, patch)}
            onRemove={() => removeRule(rule.id)}
            pageId={pageId}
          />
        ))}
        <Button variant="ghost" size="sm" onClick={addRule} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Novo filtro
        </Button>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={!rules.length}>
          Limpar todos
        </Button>
        <Button onClick={onClose}>Aplicar</Button>
      </div>
    </Modal>
  )
}
