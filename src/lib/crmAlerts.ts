import { daysSince, isSameDay } from './time'
import type { Client, FollowUp } from '@/types/client'

/**
 * Alertas exibidos no Dashboard principal. Focados no fluxo de
 * implementação/entrega + flags de tipo de implementação.
 */
export type AlertKind =
  | 'briefing_sent_waiting'
  | 'briefing_pending_send'
  | 'briefing_filled_no_setup'
  | 'setup_in_progress'
  | 'delivery_scheduled'
  | 'delivery_done_this_week'
  | 'followup_pending'
  | 'impl_api_oficial'
  | 'impl_ia'
  | 'impl_automacao_externa'

export interface CrmAlert {
  kind: AlertKind
  client: Client
  followUp?: FollowUp
  daysLate?: number
  title: string
  subtitle: string
  message?: string
  tone: 'danger' | 'warning' | 'info' | 'success'
  /** Optional ISO datetime used for sorting (e.g. delivery meetings, deadlines). */
  whenAt?: string
}

const SETUP_DEADLINE_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

export function computeAlerts(clients: Client[]): CrmAlert[] {
  const out: CrmAlert[] = []
  const now = new Date()
  const todayStart = startOfDay(now)
  const weekAgo = todayStart - 7 * DAY_MS

  for (const c of clients) {
    if (c.stage === 'churned') continue

    // ===== 0. Briefing enviado aguardando preenchimento =====
    // Link já foi gerado/enviado mas o cliente ainda não preencheu.
    if (
      c.briefingSentAt &&
      (c.briefingStatus === 'sent' || c.briefingStatus === 'revision') &&
      c.stage !== 'setup' &&
      c.stage !== 'delivery' &&
      c.stage !== 'active'
    ) {
      const days = daysSince(c.briefingSentAt)
      out.push({
        kind: 'briefing_sent_waiting',
        client: c,
        daysLate: days,
        tone: days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'info',
        title: `${c.company || c.name}`,
        subtitle:
          c.briefingStatus === 'revision'
            ? `Revisão solicitada há ${days} dia(s) · aguardando reenvio`
            : days > 0
              ? `Enviado há ${days} dia(s) · aguardando preenchimento`
              : 'Briefing enviado · aguardando preenchimento',
      })
    }

    // ===== 1. Aguardando envio do briefing =====
    // Cliente já passou da etapa de contrato (assinou) mas o briefing
    // ainda não foi enviado pra ele responder.
    if (
      c.contractSignedAt &&
      !c.briefingSentAt &&
      c.briefingStatus !== 'filled' &&
      c.briefingStatus !== 'approved' &&
      c.stage !== 'setup' &&
      c.stage !== 'delivery' &&
      c.stage !== 'active'
    ) {
      const days = daysSince(c.contractSignedAt)
      out.push({
        kind: 'briefing_pending_send',
        client: c,
        daysLate: days,
        tone: days >= 5 ? 'danger' : 'warning',
        title: `${c.company || c.name}`,
        subtitle:
          days > 0
            ? `Contrato assinado há ${days} dia(s) · briefing ainda não enviado`
            : 'Contrato assinado · enviar briefing',
      })
    }

    // ===== 2. Briefing preenchido sem início da configuração =====
    // Cliente respondeu o briefing (filled/approved) mas ainda não foi
    // movido pra etapa 'setup'.
    if (
      (c.briefingStatus === 'filled' || c.briefingStatus === 'approved') &&
      c.stage !== 'setup' &&
      c.stage !== 'delivery' &&
      c.stage !== 'active'
    ) {
      const ref =
        c.briefingApprovedAt ?? c.briefingSentAt ?? c.stageUpdatedAt
      const days = ref ? daysSince(ref) : 0
      out.push({
        kind: 'briefing_filled_no_setup',
        client: c,
        daysLate: days,
        tone: days >= 3 ? 'danger' : 'warning',
        title: `${c.company || c.name}`,
        subtitle:
          c.briefingStatus === 'approved'
            ? `Briefing aprovado${days > 0 ? ` há ${days} dia(s)` : ''} · iniciar configuração`
            : `Briefing preenchido${days > 0 ? ` há ${days} dia(s)` : ''} · revisar e iniciar configuração`,
      })
    }

    // ===== 3. Configuração em andamento =====
    // Cliente em stage 'setup'. Mostra prazo limite (stage_updated_at + 3 dias)
    // e qual etapa do checklist está pendente.
    if (c.stage === 'setup') {
      const startedAt = c.stageUpdatedAt
        ? new Date(c.stageUpdatedAt).getTime()
        : now.getTime()
      const deadlineMs = startedAt + SETUP_DEADLINE_DAYS * DAY_MS
      const deadlineDate = new Date(deadlineMs)
      const daysToDeadline = Math.ceil(
        (deadlineMs - now.getTime()) / DAY_MS,
      )
      const overdue = deadlineMs < now.getTime()

      const items = c.deliveryChecklist ?? []
      const total = items.length
      const done = items.filter((i) => i.checked).length
      const next = items.find((i) => !i.checked)

      const deadlineLabel = overdue
        ? `Atrasado ${Math.abs(daysToDeadline)} dia(s) · prazo era ${formatDate(deadlineDate)}`
        : daysToDeadline === 0
          ? `Vence hoje (${formatDate(deadlineDate)})`
          : `Prazo ${formatDate(deadlineDate)} (${daysToDeadline} dia(s))`

      const stepLabel =
        total > 0
          ? next
            ? `${done}/${total} · ${next.label}`
            : `${done}/${total} concluídos`
          : 'sem checklist'

      out.push({
        kind: 'setup_in_progress',
        client: c,
        daysLate: overdue ? Math.abs(daysToDeadline) : undefined,
        tone: overdue ? 'danger' : daysToDeadline <= 1 ? 'warning' : 'info',
        title: `${c.company || c.name}`,
        subtitle: `${stepLabel} · ${deadlineLabel}`,
        whenAt: new Date(deadlineMs).toISOString(),
      })
    }

    // ===== 4. Entrega agendada =====
    // Reunião/data de entrega marcada e ainda não concluída.
    if (
      c.deliveryDate &&
      !c.deliveryCompletedAt &&
      new Date(c.deliveryDate).getTime() >= todayStart
    ) {
      const when = new Date(c.deliveryDate)
      out.push({
        kind: 'delivery_scheduled',
        client: c,
        tone: isSameDay(when, now) ? 'info' : 'success',
        title: `${c.company || c.name}`,
        subtitle: formatScheduleLabel(when),
        whenAt: c.deliveryDate,
      })
    }

    // ===== 5. Entrega realizada nos últimos 7 dias =====
    if (
      c.deliveryCompletedAt &&
      new Date(c.deliveryCompletedAt).getTime() >= weekAgo
    ) {
      const when = new Date(c.deliveryCompletedAt)
      out.push({
        kind: 'delivery_done_this_week',
        client: c,
        tone: 'success',
        title: `${c.company || c.name}`,
        subtitle: `Entregue em ${formatDate(when)}`,
        whenAt: c.deliveryCompletedAt,
      })
    }

    // ===== 6. Follow-ups pendentes =====
    // Clientes ativos com mensagens de follow-up não enviadas.
    // Só entram no alerta os que já venceram (passaram os X dias) — os
    // agendados para o futuro ficam só na aba de follow-up do cliente.
    if (c.followUpActive && c.stage === 'active') {
      const now = Date.now()
      const due = (c.followUps ?? []).filter(
        (f) => !f.sentAt && new Date(f.scheduledFor).getTime() <= now,
      )
      for (const f of due) {
        out.push({
          kind: 'followup_pending',
          client: c,
          followUp: f,
          tone: 'warning',
          title: `${c.company || c.name}`,
          subtitle: `Follow-up dia ${f.dayNumber} · para enviar desde ${formatDate(new Date(f.scheduledFor))}`,
          message: f.message,
          whenAt: f.scheduledFor,
        })
      }
    }

    if (c.hasApiOficial) {
      out.push({
        kind: 'impl_api_oficial',
        client: c,
        tone: 'info',
        title: `${c.company || c.name}`,
        subtitle: c.stage === 'active' ? 'Ativo' : `Etapa: ${c.stage}`,
      })
    }
    if (c.hasIa) {
      out.push({
        kind: 'impl_ia',
        client: c,
        tone: 'info',
        title: `${c.company || c.name}`,
        subtitle: c.stage === 'active' ? 'Ativo' : `Etapa: ${c.stage}`,
      })
    }
    if (c.hasAutomacaoExterna) {
      out.push({
        kind: 'impl_automacao_externa',
        client: c,
        tone: 'info',
        title: `${c.company || c.name}`,
        subtitle: c.stage === 'active' ? 'Ativo' : `Etapa: ${c.stage}`,
      })
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

function startOfDay(d: Date): number {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c.getTime()
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
}

function formatScheduleLabel(d: Date): string {
  const date = formatDate(d)
  const time = d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${date} · ${time}`
}
