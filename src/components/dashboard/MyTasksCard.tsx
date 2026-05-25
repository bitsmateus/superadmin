import * as React from 'react'
import {
  Bell,
  CheckCircle2,
  Clock,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useOpenReminders } from '@/hooks/useTickets'
import { useClients } from '@/hooks/useClients'
import { ticketsService } from '@/services/tickets'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/time'

/** Card "Minhas tarefas" pro Dashboard. */
export function MyTasksCard() {
  const { profile } = useAuth()
  const reminders = useOpenReminders(profile?.id)
  const [creating, setCreating] = React.useState(false)

  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const today = reminders.filter((r) => new Date(r.dueAt) <= todayEnd)
  const upcoming = reminders.filter((r) => new Date(r.dueAt) > todayEnd)

  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-medium text-white">
          <Bell className="h-4 w-4 text-accent" />
          Minhas tarefas
        </h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCreating(true)}
          leftIcon={<Plus className="h-3.5 w-3.5" />}
        >
          Novo
        </Button>
      </header>

      {reminders.length === 0 ? (
        <EmptyState
          title="Sem tarefas pendentes"
          description="Adicione lembretes pra clientes específicos ou geral. Aparecem aqui quando a data chegar."
        />
      ) : (
        <div className="space-y-4">
          {today.length > 0 && (
            <Group label={`Para hoje · ${today.length}`} tone="warning">
              {today.map((r) => (
                <ReminderRow key={r.id} reminder={r} />
              ))}
            </Group>
          )}
          {upcoming.length > 0 && (
            <Group label={`Próximas · ${upcoming.length}`} tone="info">
              {upcoming.slice(0, 5).map((r) => (
                <ReminderRow key={r.id} reminder={r} />
              ))}
            </Group>
          )}
        </div>
      )}

      <CreateReminderModal open={creating} onClose={() => setCreating(false)} />
    </section>
  )
}

function Group({
  label,
  tone,
  children,
}: {
  label: string
  tone: 'warning' | 'info'
  children: React.ReactNode
}) {
  return (
    <div>
      <div
        className={cn(
          'mb-1.5 text-[10px] uppercase tracking-wider',
          tone === 'warning' ? 'text-warning' : 'text-white/45',
        )}
      >
        {label}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}

function ReminderRow({
  reminder,
}: {
  reminder: import('@/types/ticket').Reminder
}) {
  const clients = useClients()
  const client = reminder.clientId
    ? clients.find((c) => c.id === reminder.clientId)
    : null
  const due = new Date(reminder.dueAt)
  const overdue = due < new Date()

  return (
    <li
      className={cn(
        'group flex items-start justify-between gap-2 rounded-lg border px-3 py-2',
        overdue
          ? 'border-warning/30 bg-warning/[0.04]'
          : 'border-line bg-white/[0.02]',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm text-white">{reminder.title}</div>
        <div className="mt-0.5 text-[11px] text-white/55 inline-flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {overdue ? 'Atrasada ' : ''}
            {timeAgo(reminder.dueAt)}
          </span>
          {client && (
            <span className="text-white/40">
              · {client.company || client.name}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={async () => {
            await ticketsService.completeReminder(reminder.id)
            toast.success('Tarefa concluída')
          }}
          title="Concluir"
          className="rounded-md p-1 text-white/55 hover:bg-success/10 hover:text-success"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={async () => {
            await ticketsService.deleteReminder(reminder.id)
          }}
          title="Remover"
          className="rounded-md p-1 text-white/40 hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  )
}

function CreateReminderModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { profile } = useAuth()
  const clients = useClients()
  const [title, setTitle] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [dueAt, setDueAt] = React.useState('')
  const [clientId, setClientId] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setTitle('')
    setNotes('')
    const t = new Date()
    t.setHours(t.getHours() + 1, 0, 0, 0)
    setDueAt(toLocalInput(t))
    setClientId('')
  }, [open])

  const submit = async () => {
    if (!profile) return
    if (!title.trim() || !dueAt) {
      toast.error('Preencha título e data.')
      return
    }
    setSaving(true)
    await ticketsService.upsertReminder({
      userId: profile.id,
      title: title.trim(),
      notes: notes.trim() || undefined,
      clientId: clientId || undefined,
      dueAt: new Date(dueAt).toISOString(),
    })
    setSaving(false)
    onClose()
    toast.success('Tarefa criada')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova tarefa"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Criar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="O que fazer?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ligar pro João sobre renovação"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Quando"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
          <Select
            label="Cliente (opcional)"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            options={[
              { value: '', label: '— sem cliente —' },
              ...clients
                .slice()
                .sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name))
                .map((c) => ({ value: c.id, label: c.company || c.name })),
            ]}
          />
        </div>
        <Textarea
          label="Notas (opcional)"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
