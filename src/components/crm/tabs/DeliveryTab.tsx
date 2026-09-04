import * as React from 'react'
import {
  CheckCircle2,
  Copy,
  Download,
  Handshake,
  LayoutTemplate,
  ListChecks,
  Mail,
  Megaphone,
  PartyPopper,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { templateRequestsApi } from '@/api/templateRequests'
import { massCampaignPortalApi } from '@/api/massCampaigns'
import { useServerById } from '@/store/authStore'
import {
  buildHandoffChecklist,
  setChecklistItem,
  toggleChecklistItem,
} from '@/constants/checklist'
import { buildFollowUps, DEFAULT_FOLLOWUP_TEMPLATES } from '@/constants/followup'
import {
  openAccessEmail,
  buildAccessEmail,
  buildAccessDeliveryEmail,
  buildWelcomeMessage,
  renderAccessSheetHtml,
} from '@/lib/accessSheet'
import { asText, cn, formatDate, slugify } from '@/lib/utils'
import type { Client, ChecklistItem } from '@/types/client'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(((reader.result as string) || '').split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function DeliveryTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [downloadingAccess, setDownloadingAccess] = React.useState(false)
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

  const downloadAccess = async () => {
    setDownloadingAccess(true)
    let blob: Blob
    try {
      const html = renderAccessSheetHtml({ client, server: tenantServer })
      blob = await api.postForBlob(`/api/clients/${client.id}/access-pdf`, { html })
    } catch (err) {
      toast.error(`Falha ao gerar o PDF de acessos: ${(err as Error).message}`)
      return
    } finally {
      setDownloadingAccess(false)
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `acessos-${slugify(client.company || client.name || 'cliente')}.pdf`
    a.click()
    URL.revokeObjectURL(url)

    if (!handoff.find((i) => i.id === 'handoff_access_sent')?.checked) {
      const next = setChecklistItem(handoff, 'handoff_access_sent', true, user)
      db.updateClient(client.id, { deliveryHandoffChecklist: next })
      db.addLog(client.id, 'Acessos enviados', 'PDF de acessos baixado')
    }
    toast.success('PDF de acessos baixado')

    void sendAccessEmailAutomatically(blob)
  }

  // Ao baixar os acessos, manda automaticamente por SMTP também (se o cliente tiver e-mail e o
  // servidor tiver SMTP configurado em Configurações), com o mesmo PDF que acabou de baixar em
  // anexo — não bloqueia nem falha o download: é um "bônus" em segundo plano, avisado por um toast
  // separado.
  const sendAccessEmailAutomatically = async (pdfBlob: Blob) => {
    if (!client.email?.trim()) return
    try {
      const { subject, html } = buildAccessDeliveryEmail({ client, server: tenantServer })
      const attachmentBase64 = await blobToBase64(pdfBlob)
      await api.post(`/api/clients/${client.id}/send-access-email`, {
        to: client.email.trim(),
        subject,
        html,
        attachmentBase64,
        attachmentFilename: 'acessos.pdf',
      })
      toast.success(`E-mail de acessos enviado automaticamente para ${client.email}`)
    } catch (err) {
      toast.message(
        `Acessos baixados, mas o envio automático por e-mail falhou (${(err as Error).message}).`,
      )
    }
  }

  const copyWelcomeMessage = async () => {
    try {
      await navigator.clipboard.writeText(buildWelcomeMessage(client))
      toast.success('Mensagem de boas-vindas copiada')
    } catch {
      toast.error('Não foi possível copiar — copie manualmente')
    }
  }

  // Gera (ou reaproveita) o link público de criar template do WhatsApp e copia pra área de
  // transferência — a equipe manda pro cliente depois da entrega. O cliente preenche sozinho
  // (propósito, texto com variáveis, botões) e o backend cria o template direto na Meta.
  const copyTemplateLink = async () => {
    try {
      const { token } = await templateRequestsApi.create(client.id)
      const link = `${window.location.origin}/template/${token}`
      await navigator.clipboard.writeText(link)
      toast.success('Link de criação de template copiado')
    } catch (err) {
      toast.error(`Falha ao gerar o link: ${(err as Error).message}`)
    }
  }

  // Link fixo (não expira, não se consome com o uso) do portal de disparo em massa — o cliente
  // volta nele toda vez que quiser importar uma planilha nova e mandar uma campanha.
  const copyMassCampaignLink = async () => {
    try {
      const { token } = await massCampaignPortalApi.create(client.id)
      const link = `${window.location.origin}/laundry/${token}`
      await navigator.clipboard.writeText(link)
      toast.success('Link do portal de disparo em massa copiado')
    } catch (err) {
      toast.error(`Falha ao gerar o link: ${(err as Error).message}`)
    }
  }

  const emailAccess = () => {
    if (!client.email?.trim()) {
      toast.error('Cliente sem e-mail cadastrado (Visão Geral).')
      return
    }
    openAccessEmail({ client, server: tenantServer })
    if (!handoff.find((i) => i.id === 'handoff_access_sent')?.checked) {
      const next = setChecklistItem(handoff, 'handoff_access_sent', true, user)
      db.updateClient(client.id, { deliveryHandoffChecklist: next })
      db.addLog(client.id, 'Acessos enviados', `E-mail de acessos aberto para ${client.email}`)
    }
    toast.success('E-mail de acessos pronto no seu cliente de e-mail')
  }

  const saveMeeting = () => {
    // Monta tudo num único patch pra evitar race entre dois UPDATEs em
    // sequência (o segundo capturava state stale do primeiro).
    const patch: Partial<Client> = {
      deliveryDate: deliveryDate || undefined,
      deliveryNotes: deliveryNotes || undefined,
    }
    if (
      deliveryDate &&
      !handoff.find((i) => i.id === 'handoff_meeting_scheduled')?.checked
    ) {
      patch.deliveryHandoffChecklist = setChecklistItem(
        handoff,
        'handoff_meeting_scheduled',
        true,
        user,
      )
    }
    // Agendar a reunião de entrega tira o cliente da Configuração e o leva
    // para a etapa de Entrega. Só avança quem está em Configuração (setup) —
    // não pula etapas anteriores nem regride quem já está adiante.
    const willAdvance = Boolean(deliveryDate) && (client.stage === 'setup' || client.stage === 'setup_done')
    if (willAdvance) patch.stage = 'delivery'
    db.updateClient(client.id, patch)
    db.addLog(client.id, 'Reunião de treinamento atualizada')
    if (willAdvance) {
      db.addLog(client.id, 'Etapa: Entrega', 'Avançado automaticamente ao agendar a reunião de entrega')
    }
    toast.success('Reunião salva')
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
      stage: 'delivered',
      followUpActive: true,
      followUps,
    })
    db.addLog(
      client.id,
      'Entrega concluída',
      'Movido para Entregas Recentes · follow-ups dia 3/7/15/30 agendados',
    )
    toast.success('Entrega concluída · em Entregas Recentes (mova p/ Ativo em ~30 dias)')
  }

  const checklist = client.deliveryChecklist ?? []
  const done = checklist.filter((i) => i.checked).length
  const total = checklist.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const canComplete = done === total && total > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-elevate/[0.02] px-4 py-3">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-accent" />
          <span className="text-sm text-foreground/80">
            Checklist de criação da empresa
          </span>
          <span className="text-[11px] text-foreground/45">
            {done}/{total} concluídos
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-elevate/[0.06]">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] text-foreground/50">
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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={copyWelcomeMessage}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
            >
              Copiar mensagem
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={emailAccess}
              leftIcon={<Mail className="h-3.5 w-3.5" />}
            >
              Enviar por e-mail
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={downloadAccess}
              loading={downloadingAccess}
              leftIcon={!downloadingAccess ? <Download className="h-3.5 w-3.5" /> : undefined}
            >
              Baixar acessos
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={copyTemplateLink}
              leftIcon={<LayoutTemplate className="h-3.5 w-3.5" />}
            >
              Copiar link de template
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={copyMassCampaignLink}
              leftIcon={<Megaphone className="h-3.5 w-3.5" />}
            >
              Copiar link de disparo em massa
            </Button>
          </div>
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
                  : 'border-line bg-elevate/[0.02] hover:bg-elevate/[0.04]',
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
                    item.checked ? 'text-foreground/55 line-through' : 'text-foreground/90',
                  )}
                >
                  {item.label}
                </p>
                {item.checked && (
                  <p className="mt-0.5 text-[10px] text-foreground/40">
                    por {asText(item.checkedBy, '—')} em{' '}
                    {formatDate(item.checkedAt)}
                  </p>
                )}
                {item.id === 'handoff_access_sent' && !item.checked && (
                  <p className="mt-0.5 text-[10.5px] text-foreground/45">
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

      <div className="flex flex-col items-stretch gap-2 rounded-xl border border-line bg-elevate/[0.02] p-4">
        {client.deliveryCompletedAt ? (
          <p className="text-sm text-success inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Entrega concluída em {formatDate(client.deliveryCompletedAt)}.
          </p>
        ) : (
          <>
            <p className="text-xs text-foreground/55">
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
