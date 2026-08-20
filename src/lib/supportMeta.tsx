import * as React from 'react'
import { Calendar, Clock, ListTodo, StickyNote } from 'lucide-react'
import type { ReminderKind, ReminderPriority, ReminderStatus } from '@/types/ticket'

// Metadados compartilhados entre a visão Lista e a visão Kanban do Suporte —
// ficam aqui pra que os dois modos usem exatamente os mesmos rótulos e cores.

export const KIND_META: Record<ReminderKind, { label: string; icon: React.ReactNode }> = {
  task: { label: 'Tarefa', icon: <ListTodo className="h-3.5 w-3.5" /> },
  pending: { label: 'Pendência', icon: <Clock className="h-3.5 w-3.5" /> },
  meeting: { label: 'Reunião', icon: <Calendar className="h-3.5 w-3.5" /> },
  note: { label: 'Anotação', icon: <StickyNote className="h-3.5 w-3.5" /> },
}

/** Rótulos das etapas built-in — usados só como fallback quando a coluna não
 *  está (ou não está mais) cadastrada em `support_columns`. */
export const STATUS_META: Record<string, { label: string }> = {
  todo: { label: 'A fazer' },
  doing: { label: 'Fazendo' },
  waiting: { label: 'Aguardando técnico' },
  done: { label: 'Concluído' },
}

export const STATUS_ORDER: ReminderStatus[] = ['todo', 'doing', 'waiting', 'done']

/** Nome de exibição de uma etapa: o cadastrado na coluna, senão o built-in,
 *  senão a própria key (coluna apagada / dado antigo). */
export function statusLabel(status: string | undefined, labels: Map<string, string>): string {
  const key = status ?? 'todo'
  return labels.get(key) ?? STATUS_META[key]?.label ?? key
}

export const PRIORITY_META: Record<
  ReminderPriority,
  { label: string; chip: string; dot: string; header: string }
> = {
  high: {
    label: 'Alta',
    chip: 'bg-danger/10 text-danger ring-danger/30',
    dot: 'bg-danger',
    header: 'text-danger',
  },
  normal: {
    label: 'Média',
    chip: 'bg-warning/10 text-warning ring-warning/30',
    dot: 'bg-warning',
    header: 'text-warning',
  },
  low: {
    label: 'Baixa',
    chip: 'bg-elevate/[0.06] text-foreground/50 ring-line',
    dot: 'bg-foreground/30',
    header: 'text-foreground/45',
  },
}

export const PRIORITY_ORDER: ReminderPriority[] = ['high', 'normal', 'low']

/** Data "até fazer" formatada curta (DD/MM e hora se houver). */
export function fmtDue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return time === '00:00' ? date : `${date} ${time}`
}

// ── Helpers de data ───────────────────────────────────────────────────────────
export type Bucket = 'overdue' | 'today' | 'week' | 'month' | 'later' | 'none'

export function bucketOf(dueAt?: string | null): Bucket {
  if (!dueAt) return 'none'
  const d = new Date(dueAt)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  const eow = new Date(endToday)
  eow.setDate(eow.getDate() + ((7 - eow.getDay()) % 7))
  const eom = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  if (d < startToday) return 'overdue'
  if (d <= endToday) return 'today'
  if (d <= eow) return 'week'
  if (d <= eom) return 'month'
  return 'later'
}

/** Cor/realce do prazo conforme atraso. */
export function dueChipCls(dueAt?: string | null): string {
  const b = bucketOf(dueAt)
  if (b === 'overdue') return 'bg-danger/15 text-danger ring-danger/30'
  if (b === 'today') return 'bg-warning/15 text-warning ring-warning/30'
  return 'bg-accent/10 text-accent ring-accent/20'
}
