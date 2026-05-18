import { daysSince, isPast, isSameDay } from './time'
import type { Client, FollowUp } from '@/types/client'

export type AlertKind =
  | 'followup_today'
  | 'followup_late'
  | 'contract_no_signature'
  | 'briefing_no_response'
  | 'payment_overdue'
  | 'briefing_ready_to_setup'
  | 'delivery_meeting'
  | 'setup_pending_config'

export interface CrmAlert {
  kind: AlertKind
  client: Client
  followUp?: FollowUp
  daysLate?: number
  title: string
  subtitle: string
  message?: string
  tone: 'danger' | 'warning' | 'info' | 'success'
  /** Optional ISO datetime used for sorting (e.g. delivery meetings). */
  whenAt?: string
}

export function computeAlerts(clients: Client[]): CrmAlert[] {
  const out: CrmAlert[] = []
  const today = new Date()

  for (const c of clients) {
    if (c.stage === 'churned') continue

    // Follow-ups
    if (c.stage === 'active') {
      for (const fu of c.followUps) {
        if (fu.sentAt) continue
        const scheduled = new Date(fu.scheduledFor)
        if (isSameDay(scheduled, today)) {
          out.push({
            kind: 'followup_today',
            client: c,
            followUp: fu,
            tone: 'info',
            title: `${c.name} — ${c.company}`,
            subtitle: `Follow-up do dia ${fu.dayNumber}`,
            message: fu.message,
          })
        } else if (isPast(fu.scheduledFor)) {
          const days = daysSince(fu.scheduledFor)
          out.push({
            kind: 'followup_late',
            client: c,
            followUp: fu,
            daysLate: days,
            tone: 'danger',
            title: `${c.name} — ${c.company}`,
            subtitle: `Follow-up dia ${fu.dayNumber} · ${days} dias de atraso`,
            message: fu.message,
          })
        }
      }
    }

    // Contract enviado há +3 dias sem assinatura
    if (c.contractSentAt && !c.contractSignedAt) {
      const days = daysSince(c.contractSentAt)
      if (days >= 3) {
        out.push({
          kind: 'contract_no_signature',
          client: c,
          daysLate: days,
          tone: 'danger',
          title: `Cobrar assinatura de ${c.name}`,
          subtitle: `Contrato enviado há ${days} dias`,
        })
      }
    }

    // Briefing enviado há +5 dias sem resposta
    if (
      c.briefingSentAt &&
      (c.briefingStatus === 'sent' || c.briefingStatus === 'revision')
    ) {
      const days = daysSince(c.briefingSentAt)
      if (days >= 5) {
        out.push({
          kind: 'briefing_no_response',
          client: c,
          daysLate: days,
          tone: 'warning',
          title: `Briefing pendente de ${c.name}`,
          subtitle: `Enviado há ${days} dias sem resposta`,
        })
      }
    }

    // Pagamento vencido
    if (c.paymentStatus === 'overdue') {
      out.push({
        kind: 'payment_overdue',
        client: c,
        tone: 'danger',
        title: `Pagamento vencido: ${c.name}`,
        subtitle: c.company,
      })
    }

    // Briefing aprovado e ainda na etapa briefing
    if (c.briefingStatus === 'approved' && c.stage === 'briefing') {
      out.push({
        kind: 'briefing_ready_to_setup',
        client: c,
        tone: 'success',
        title: `Pronto para configurar: ${c.name}`,
        subtitle: 'Briefing aprovado — avançar para configuração',
      })
    }

    // Reunião de entrega agendada (hoje ou no futuro, ainda não concluída)
    if (
      c.deliveryDate &&
      !c.deliveryCompletedAt &&
      new Date(c.deliveryDate).getTime() >= startOfToday(today)
    ) {
      const when = new Date(c.deliveryDate)
      out.push({
        kind: 'delivery_meeting',
        client: c,
        tone: isSameDay(when, today) ? 'info' : 'success',
        title: `${c.name} — ${c.company}`,
        subtitle: formatScheduleLabel(when),
        whenAt: c.deliveryDate,
      })
    }

    // Configurações pendentes (cliente em setup com checklist incompleto)
    if (c.stage === 'setup') {
      const items = c.deliveryChecklist ?? []
      const total = items.length
      const done = items.filter((i) => i.checked).length
      if (total > 0 && done < total) {
        const next = items.find((i) => !i.checked)
        out.push({
          kind: 'setup_pending_config',
          client: c,
          tone: 'warning',
          title: `${c.name} — ${c.company}`,
          subtitle: `Configuração ${done}/${total}${next ? ` · ${next.label}` : ''}`,
        })
      }
    }
  }

  // Order: danger > warning > info > success
  const toneRank: Record<CrmAlert['tone'], number> = {
    danger: 0,
    warning: 1,
    info: 2,
    success: 3,
  }
  return out.sort((a, b) => toneRank[a.tone] - toneRank[b.tone])
}

function startOfToday(today: Date): number {
  const d = new Date(today)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function formatScheduleLabel(d: Date): string {
  const date = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
  const time = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} · ${time}`
}
