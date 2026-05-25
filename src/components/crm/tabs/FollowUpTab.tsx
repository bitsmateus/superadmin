import * as React from 'react'
import {
  Bell,
  CheckCircle2,
  Clock,
  Phone,
  PlusCircle,
  Send,
  Smile,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { db } from '@/services/db'
import { useCurrentUser } from '@/hooks/useClients'
import { isPast, isSameDay, timeAgo } from '@/lib/time'
import { cn, formatDate } from '@/lib/utils'
import type { Client, FollowUp } from '@/types/client'

export function FollowUpTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [manualOpen, setManualOpen] = React.useState(false)

  const update = (next: FollowUp[]) => {
    db.updateClient(client.id, { followUps: next })
  }

  const markSent = (fu: FollowUp) => {
    const next = client.followUps.map((f) =>
      f.id === fu.id ? { ...f, sentAt: new Date().toISOString() } : f,
    )
    update(next)
    db.addLog(client.id, `Follow-up dia ${fu.dayNumber} enviado`)
    toast.success(`Dia ${fu.dayNumber} marcado como enviado`)
  }

  const toggleResponded = (fu: FollowUp) => {
    const next = client.followUps.map((f) =>
      f.id === fu.id ? { ...f, responded: !f.responded } : f,
    )
    update(next)
  }

  const saveMessage = (fu: FollowUp) => {
    const next = client.followUps.map((f) =>
      f.id === fu.id ? { ...f, message: draft } : f,
    )
    update(next)
    setEditing(null)
    setDraft('')
    db.addLog(client.id, `Mensagem do follow-up dia ${fu.dayNumber} editada`)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2.5 text-sm text-white/85">
        <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          Os alertas de follow-up aparecem no <strong>Dashboard</strong> nos
          dias 3, 7, 15 e 30 após a entrega, lembrando você de entrar em
          contato com o cliente.
        </span>
      </div>

      {(client.followUps ?? []).length === 0 ? (
        <Section>
          <p className="text-sm text-white/55">
            Os follow-ups são agendados automaticamente quando você concluir a
            entrega.
          </p>
        </Section>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-5">
          {(client.followUps ?? []).map((fu) => {
            const state = fuState(fu)
            const isEditing = editing === fu.id
            return (
              <li key={fu.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[27px] top-1 grid h-4 w-4 place-items-center rounded-full ring-4 ring-card',
                    state === 'sent'
                      ? 'bg-success'
                      : state === 'today'
                        ? 'bg-accent animate-pulse'
                        : state === 'late'
                          ? 'bg-danger'
                          : 'bg-white/30',
                  )}
                />
                <div className="rounded-xl border border-line bg-white/[0.02] p-3">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        Dia {fu.dayNumber}
                      </span>
                      <span className="text-[11px] text-white/45">
                        {formatDate(fu.scheduledFor)}
                      </span>
                    </div>
                    <StateBadge state={state} fu={fu} />
                  </header>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditing(null)
                            setDraft('')
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => saveMessage(fu)}>
                          Salvar mensagem
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-white/85">
                      {fu.message}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <label className="mr-auto inline-flex items-center gap-1.5 text-[11px] text-white/55">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-[#4F8EF7]"
                        checked={Boolean(fu.responded)}
                        onChange={() => toggleResponded(fu)}
                      />
                      Cliente respondeu
                    </label>
                    {!isEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(fu.id)
                          setDraft(fu.message)
                        }}
                      >
                        Editar mensagem
                      </Button>
                    )}
                    {!fu.sentAt && (
                      <Button
                        size="sm"
                        onClick={() => markSent(fu)}
                        leftIcon={<Send className="h-3.5 w-3.5" />}
                      >
                        Marcar como enviado
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setManualOpen(true)}
          leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
        >
          Registrar contato manual
        </Button>
      </div>

      <ManualContactModal
        clientId={client.id}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        author={user}
      />
    </div>
  )
}

type FuState = 'scheduled' | 'today' | 'late' | 'sent'

function fuState(fu: FollowUp): FuState {
  if (fu.sentAt) return 'sent'
  const scheduled = new Date(fu.scheduledFor)
  const now = new Date()
  if (isSameDay(scheduled, now)) return 'today'
  if (isPast(fu.scheduledFor)) return 'late'
  return 'scheduled'
}

function StateBadge({ state, fu }: { state: FuState; fu: FollowUp }) {
  if (state === 'sent')
    return (
      <Badge tone="success" dot>
        Enviado · {timeAgo(fu.sentAt)}
      </Badge>
    )
  if (state === 'today')
    return (
      <Badge tone="info" dot>
        Hoje!
      </Badge>
    )
  if (state === 'late')
    return (
      <Badge tone="danger" dot>
        Atrasado
      </Badge>
    )
  return (
    <Badge tone="neutral" dot>
      Agendado
    </Badge>
  )
}

function ManualContactModal({
  clientId,
  open,
  onClose,
  author,
}: {
  clientId: string
  open: boolean
  onClose: () => void
  author: string
}) {
  const [date, setDate] = React.useState(() =>
    new Date().toISOString().slice(0, 16),
  )
  const [channel, setChannel] = React.useState<
    'WhatsApp' | 'E-mail' | 'Ligação' | 'Reunião'
  >('WhatsApp')
  const [note, setNote] = React.useState('')

  const submit = () => {
    if (!note.trim()) {
      toast.error('Descreva o que foi conversado.')
      return
    }
    const text = `[Contato manual · ${channel} · ${date}]\n${note.trim()}`
    db.addNote(clientId, text, author || 'Anônimo')
    db.addLog(clientId, `Contato manual via ${channel}`)
    toast.success('Contato registrado')
    setNote('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar contato manual"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit}>Registrar</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Data e hora"
          type="datetime-local"
          leftIcon={<Clock className="h-4 w-4" />}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select
          label="Canal"
          options={[
            { value: 'WhatsApp', label: 'WhatsApp' },
            { value: 'E-mail', label: 'E-mail' },
            { value: 'Ligação', label: 'Ligação' },
            { value: 'Reunião', label: 'Reunião' },
          ]}
          value={channel}
          onChange={(e) => setChannel(e.target.value as typeof channel)}
        />
      </div>
      <div className="mt-3">
        <Textarea
          label="Observação"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="O que foi conversado, próximos passos…"
        />
      </div>
    </Modal>
  )
}

// Unused-import suppressor (icons referenced only as types in tests)
export const _icons = [Smile, Phone, CheckCircle2]
