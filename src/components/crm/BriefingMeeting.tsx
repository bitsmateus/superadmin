import * as React from 'react'
import { toast } from 'sonner'
import { CalendarPlus, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/hooks/useAuth'
import { useAllReminders } from '@/hooks/useTickets'
import { ticketsService } from '@/services/tickets'
import { db } from '@/services/db'
import { formatDate } from '@/lib/utils'
import type { Client } from '@/types/client'

const TITLE_PREFIX = 'Reunião de briefing'

/** Agendar (ou reagendar) a reunião de briefing com o cliente — vira uma "reunião" em Tarefas. */
export function BriefingMeeting({ client }: { client: Client }) {
  const { profile } = useAuth()
  const reminders = useAllReminders()
  const existing = React.useMemo(
    () =>
      reminders
        .filter((r) => r.clientId === client.id && r.kind === 'meeting' && !r.completedAt && r.title.startsWith(TITLE_PREFIX))
        .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime())[0],
    [reminders, client.id],
  )

  const [open, setOpen] = React.useState(false)
  const [when, setWhen] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const openModal = () => {
    setWhen(existing?.dueAt ? toLocalInput(existing.dueAt) : '')
    setNotes(existing?.notes ?? '')
    setOpen(true)
  }

  const save = async () => {
    if (!when) {
      toast.error('Escolha a data e a hora')
      return
    }
    if (!profile?.id) {
      toast.error('Sessão sem usuário — entre de novo')
      return
    }
    setSaving(true)
    await ticketsService.upsertReminder({
      id: existing?.id,
      userId: existing?.userId ?? profile.id,
      clientId: client.id,
      title: `${TITLE_PREFIX} — ${client.company || client.name}`,
      notes: notes.trim() || undefined,
      dueAt: new Date(when).toISOString(),
      kind: 'meeting',
      status: existing?.status ?? 'todo',
      priority: 'normal',
    })
    setSaving(false)
    db.addLog(client.id, existing ? 'Reunião de briefing reagendada' : 'Reunião de briefing agendada', formatDate(new Date(when).toISOString()))
    toast.success(existing ? 'Reunião reagendada' : 'Reunião agendada')
    setOpen(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {existing?.dueAt && (
          <span className="inline-flex items-center gap-1.5 text-xs text-foreground/60">
            <CalendarClock className="h-3.5 w-3.5 text-accent" />
            Reunião: {formatDate(existing.dueAt)}
          </span>
        )}
        <Button size="sm" variant="secondary" onClick={openModal} leftIcon={<CalendarPlus className="h-3.5 w-3.5" />}>
          {existing ? 'Reagendar reunião' : 'Agendar reunião de briefing'}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={existing ? 'Reagendar reunião de briefing' : 'Agendar reunião de briefing'}
        description="A reunião aparece em Tarefas, na coluna do responsável."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={saving}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>
      </Modal>
    </>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
