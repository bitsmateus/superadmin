import * as React from 'react'
import {
  CheckCircle2,
  Download,
  Handshake,
  ListChecks,
  PartyPopper,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { useServerById } from '@/store/authStore'
import {
  buildHandoffChecklist,
  setChecklistItem,
  toggleChecklistItem,
} from '@/constants/checklist'
import { buildFollowUps, DEFAULT_FOLLOWUP_TEMPLATES } from '@/constants/followup'
import { openAccessSheet } from '@/lib/accessSheet'
import { asText, cn, formatDate } from '@/lib/utils'
import type { Client, ChecklistItem } from '@/types/client'

export function DeliveryTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [deliveryDate, setDeliveryDate] = React.useState(
    client.deliveryDate ?? '',
  )
  const [deliveryNotes, setDeliveryNotes] = React.useState(
    client.deliveryNotes ?? '',
  )
  const tenantServer = useServerById(client.tenantServerId)

  React.useEffect(() => {
    setDeliveryDate(client.deliveryDate ?? '')
    setDeliveryNotes(client.deliveryNotes ?? '')
  }, [client.id])

  const handoff = client.deliveryHandoffChecklist ?? buildHandoffChecklist()

  const persistHandoff = (next: ChecklistItem[], log: string) => {
    db.updateClient(client.id, { deliveryHandoffChecklist: next })
    db.addLog(client.id, 'Handoff atualizado', log)
  }

  const toggleHandoff = (item: ChecklistItem) => {
    if (!item.checked && !user) {
      toast.error('Defina seu nome em Configurações antes de marcar itens.')
      return
    }
    const next = toggleChecklistItem(handoff, item.id, user)
    persistHandoff(next, `${item.label}: ${!item.checked ? 'concluído' : 'desmarcado'}`)
  }

  const downloadAccess = () => {
    const ok = openAccessSheet({ client, server: tenantServer })
    if (!ok) {
      toast.error('Pop-up bloqueado — libere para baixar os acessos')
      return
    }
    if (!handoff.find((i) => i.id === 'handoff_access_sent')?.checked) {
      const next = setChecklistItem(handoff, 'handoff_access_sent', true, user)
      db.updateClient(client.id, { deliveryHandoffChecklist: next })
      db.addLog(client.id, 'Acessos enviados', 'Folha de acessos gerada para impressão/PDF')
    }
    toast.success('Folha de acessos aberta — salve como PDF')
  }

  const saveMeeting = () => {
    db.updateClient(client.id, {
      deliveryDate: deliveryDate || undefined,
      deliveryNotes: deliveryNotes || undefined,
    })
    db.addLog(client.id, 'Reunião de treinamento atualizada')
    toast.success('Reunião salva')
    // Auto-check "Reunião agendada" once a date is recorded.
    if (deliveryDate && !handoff.find((i) => i.id === 'handoff_meeting_scheduled')?.checked) {
      const next = setChecklistItem(handoff, 'handoff_meeting_scheduled', true, user)
      db.updateClient(client.id, { deliveryHandoffChecklist: next })
    }
  }

  const completeDelivery = () => {
    const now = new Date()
    const followUps = buildFollowUps(
      client,
      now,
      db.getSettings().followUpTemplates
        ? {
            ...DEFAULT_FOLLOWUP_TEMPLATES,
            ...db.getSettings().followUpTemplates,
          }
        : DEFAULT_FOLLOWUP_TEMPLATES,
    )
    db.updateClient(client.id, {
      deliveryCompletedAt: now.toISOString(),
      stage: 'active',
      followUpActive: true,
      followUps,
    })
    db.addLog(client.id, 'Entrega concluída', 'Follow-ups dia 3/7/15/30 agendados')
    toast.success('Entrega concluída · cliente em acompanhamento')
  }

  const done = client.deliveryChecklist.filter((i) => i.checked).length
  const total = client.deliveryChecklist.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const canComplete = done === total && total > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-accent" />
          <span className="text-sm text-white/80">
            Checklist de criação da empresa
          </span>
          <span className="text-[11px] text-white/45">
            {done}/{total} concluídos
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-white/50">
            Editar em <span className="text-accent">Briefing → Automação</span>
          </span>
        </div>
      </div>

      <Section
        title={
          <span className="flex items-center gap-2">
            <Handshake className="h-3.5 w-3.5 text-accent" />
            Handoff ao cliente
          </span>
        }
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={downloadAccess}
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            Baixar acessos
          </Button>
        }
      >
        <ul className="space-y-1.5">
          {handoff.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
                item.checked
                  ? 'border-success/30 bg-success/[0.05]'
                  : 'border-line bg-white/[0.02] hover:bg-white/[0.04]',
              )}
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={() => toggleHandoff(item)}
                className="mt-0.5 h-4 w-4 accent-[#4F8EF7]"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm',
                    item.checked ? 'text-white/55 line-through' : 'text-white/90',
                  )}
                >
                  {item.label}
                </p>
                {item.checked && (
                  <p className="mt-0.5 text-[10px] text-white/40">
                    por {asText(item.checkedBy, '—')} em{' '}
                    {formatDate(item.checkedAt)}
                  </p>
                )}
                {item.id === 'handoff_access_sent' && !item.checked && (
                  <p className="mt-0.5 text-[10.5px] text-white/45">
                    Use "Baixar acessos" para gerar o PDF — marca automaticamente
                    ao baixar.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            <UserCircle2 className="h-3.5 w-3.5 text-accent" />
            Reunião de treinamento
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Data e hora"
            type="datetime-local"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <div className="mt-3">
          <Textarea
            label="Observações da reunião"
            value={deliveryNotes}
            onChange={(e) => setDeliveryNotes(e.target.value)}
            placeholder="O que foi treinado, dúvidas pendentes, próximos passos…"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="secondary" onClick={saveMeeting}>
            Salvar
          </Button>
        </div>
      </Section>

      <div className="flex flex-col items-stretch gap-2 rounded-xl border border-line bg-white/[0.02] p-4">
        {client.deliveryCompletedAt ? (
          <p className="text-sm text-success inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Entrega concluída em {formatDate(client.deliveryCompletedAt)}.
          </p>
        ) : (
          <>
            <p className="text-xs text-white/55">
              Conclui a entrega quando o checklist estiver 100% e o cliente
              tiver confirmado que está funcionando. Os follow-ups são
              agendados automaticamente para dias 3, 7, 15 e 30.
            </p>
            <div className="flex justify-end">
              <Button
                onClick={completeDelivery}
                disabled={!canComplete}
                leftIcon={<PartyPopper className="h-4 w-4" />}
              >
                Concluir entrega
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
