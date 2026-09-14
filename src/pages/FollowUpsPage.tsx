import * as React from 'react'
import { Bell, Copy, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { db } from '@/services/db'
import { useClients } from '@/hooks/useClients'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDate } from '@/lib/utils'
import type { Client, FollowUp } from '@/types/client'

interface PendingItem {
  client: Client
  followUp: FollowUp
}

/** Mesma regra do resumo diário do WhatsApp (ver server/src/jobs/followUpDigest.ts): cliente com
 *  follow-up ativo, em Entregas Recentes ou Ativo, com um item do checklist sem `sentAt` e cuja
 *  data já chegou. */
function pendingFollowUps(clients: Client[]): PendingItem[] {
  const nowMs = Date.now()
  const out: PendingItem[] = []
  for (const client of clients) {
    if (!client.followUpActive) continue
    if (client.stage !== 'active' && client.stage !== 'delivered') continue
    for (const followUp of client.followUps ?? []) {
      if (!followUp.sentAt && followUp.scheduledFor && new Date(followUp.scheduledFor).getTime() <= nowMs) {
        out.push({ client, followUp })
      }
    }
  }
  return out.sort(
    (a, b) => new Date(a.followUp.scheduledFor).getTime() - new Date(b.followUp.scheduledFor).getTime(),
  )
}

export function FollowUpsPage() {
  const clients = useClients()
  const pending = React.useMemo(() => pendingFollowUps(clients), [clients])
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')

  const markSent = (item: PendingItem) => {
    const next = item.client.followUps.map((f) =>
      f.id === item.followUp.id ? { ...f, sentAt: new Date().toISOString() } : f,
    )
    db.updateClient(item.client.id, { followUps: next })
    db.addLog(item.client.id, `Follow-up dia ${item.followUp.dayNumber} enviado`)
    const empresa = item.client.company?.trim() || item.client.name
    toast.success(`Dia ${item.followUp.dayNumber} marcado como enviado — ${empresa}`)
  }

  const copyMessage = async (item: PendingItem) => {
    const ok = await copyToClipboard(item.followUp.message)
    if (ok) toast.success('Mensagem copiada!')
    else toast.error('Não foi possível copiar. Selecione o texto manualmente.')
  }

  const saveMessage = (item: PendingItem) => {
    const next = item.client.followUps.map((f) => (f.id === item.followUp.id ? { ...f, message: draft } : f))
    db.updateClient(item.client.id, { followUps: next })
    db.addLog(item.client.id, `Mensagem do follow-up dia ${item.followUp.dayNumber} editada`)
    setEditingId(null)
    setDraft('')
  }

  return (
    <>
      <TopBar title="Follow-ups" subtitle={`${pending.length} pendente(s)`} />

      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="flex items-start gap-2 rounded-lg border border-accent/20 bg-accent/[0.05] px-3 py-2.5 text-sm text-foreground/85">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span>
            Todos os clientes com uma mensagem de follow-up vencida (dias 3, 7, 15 ou 30 após a entrega) esperando
            envio — de qualquer cliente, num lugar só. Copie a mensagem, mande manualmente pelo WhatsApp e marque
            como enviado. O mesmo grupo de suporte já recebe um lembrete automático todo dia às 10h.
          </span>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            icon={<MessageCircle className="h-6 w-6" />}
            title="Nenhum follow-up pendente"
            description="Tudo em dia — assim que uma mensagem vencer, ela aparece aqui."
          />
        ) : (
          <ol className="space-y-3">
            {pending.map((item) => {
              const isEditing = editingId === item.followUp.id
              const empresa = item.client.company?.trim() || item.client.name
              return (
                <li key={item.followUp.id} className="rounded-xl border border-danger/25 bg-danger/[0.03] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{empresa}</span>
                      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                        Dia {item.followUp.dayNumber}
                      </span>
                      <span className="text-[11px] text-foreground/45">
                        Venceu em {formatDate(item.followUp.scheduledFor)}
                      </span>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(null)
                            setDraft('')
                          }}
                        >
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => saveMessage(item)}>
                          Salvar mensagem
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-line/60 bg-card px-2.5 py-2 text-sm text-foreground/85">
                      {item.followUp.message}
                    </p>
                  )}

                  {!isEditing && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(item.followUp.id)
                          setDraft(item.followUp.message)
                        }}
                      >
                        Editar mensagem
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copyMessage(item)}
                        leftIcon={<Copy className="h-3.5 w-3.5" />}
                      >
                        Copiar mensagem
                      </Button>
                      <Button size="sm" onClick={() => markSent(item)}>
                        Marcar como enviado
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </>
  )
}
