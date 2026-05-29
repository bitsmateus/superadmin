import * as React from 'react'
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Copy,
  FileText,
  MessageSquare,
  Settings2,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ClientDrawer } from '@/components/crm/ClientDrawer'
import { useClients } from '@/hooks/useClients'
import { computeAlerts, type AlertKind, type CrmAlert } from '@/lib/crmAlerts'
import { db } from '@/services/db'
import { STAGE_COLORS } from '@/constants/stageColors'
import { cn } from '@/lib/utils'

interface PanelDef {
  key: string
  title: string
  description: string
  kinds: AlertKind[]
  icon: React.ReactNode
  tone: 'info' | 'warning' | 'danger' | 'success'
}

const PANELS: PanelDef[] = [
  {
    key: 'briefing_sent_waiting',
    title: 'Briefing enviado aguardando preenchimento',
    description: 'Link enviado ao cliente · aguardando resposta',
    kinds: ['briefing_sent_waiting'],
    icon: <FileText className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'briefing_done',
    title: 'Briefing preenchido aguardando configuração',
    description: 'Briefing respondido — aguardando início da configuração',
    kinds: ['briefing_filled_no_setup'],
    icon: <Sparkles className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'setup',
    title: 'Em configuração',
    description: 'Clientes na etapa de configuração',
    kinds: ['setup_in_progress'],
    icon: <Settings2 className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'delivery',
    title: 'Reunião de entrega agendada',
    description: 'Reuniões e datas de entrega marcadas',
    kinds: ['delivery_scheduled'],
    icon: <Calendar className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'delivered',
    title: 'Reunião entregue',
    description: 'Clientes entregues nos últimos 7 dias',
    kinds: ['delivery_done_this_week'],
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    tone: 'success',
  },
  {
    key: 'followup',
    title: 'Follow-up de mensagem',
    description: 'Clientes ativos com follow-ups pendentes',
    kinds: ['followup_pending'],
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'impl_api_oficial',
    title: 'API Oficial',
    description: 'Clientes com integração de API oficial',
    kinds: ['impl_api_oficial'],
    icon: <Zap className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'impl_ia',
    title: 'IA',
    description: 'Clientes com inteligência artificial',
    kinds: ['impl_ia'],
    icon: <Bot className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'impl_automacao',
    title: 'Automação',
    description: 'Clientes com automação externa',
    kinds: ['impl_automacao_externa'],
    icon: <Settings2 className="h-3.5 w-3.5" />,
    tone: 'info',
  },
]

export function AlertsPanel() {
  const clients = useClients()
  const alerts = React.useMemo(() => computeAlerts(clients), [clients])
  const [openId, setOpenId] = React.useState<string | null>(null)

  const grouped = React.useMemo(() => {
    const map = new Map<string, CrmAlert[]>()
    for (const p of PANELS) map.set(p.key, [])
    for (const a of alerts) {
      for (const p of PANELS) {
        if (p.kinds.includes(a.kind)) {
          map.get(p.key)!.push(a)
          break
        }
      }
    }
    // Sort delivery by date
    const delivery = map.get('delivery')
    if (delivery) {
      delivery.sort((a, b) => {
        const ta = a.whenAt ? new Date(a.whenAt).getTime() : 0
        const tb = b.whenAt ? new Date(b.whenAt).getTime() : 0
        return ta - tb
      })
    }
    return map
  }, [alerts])

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {PANELS.map((panel) => (
          <PanelCard
            key={panel.key}
            panel={panel}
            alerts={grouped.get(panel.key) ?? []}
            onOpen={setOpenId}
          />
        ))}
      </div>

      <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function PanelCard({
  panel,
  alerts,
  onOpen,
}: {
  panel: PanelDef
  alerts: CrmAlert[]
  onOpen: (id: string) => void
}) {
  const toneClasses = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    success: 'bg-success/10 text-success ring-success/20',
  }[panel.tone]

  const badgeTone = alerts.length === 0 ? 'neutral' : panel.tone

  return (
    <section className="flex flex-col rounded-2xl border border-line bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1',
              toneClasses,
            )}
          >
            {panel.icon}
          </span>
          <div>
            <h3 className="text-sm font-medium text-foreground">{panel.title}</h3>
            <p className="text-[11px] text-foreground/45">{panel.description}</p>
          </div>
        </div>
        <Badge tone={badgeTone} dot={alerts.length > 0}>
          {alerts.length}
        </Badge>
      </header>

      {alerts.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-foreground/35">
          Nenhum cliente nesta situação
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => (
            <AlertRow
              key={`${panel.key}-${a.client.id}-${a.kind}-${a.followUp?.id ?? a.whenAt ?? ''}`}
              alert={a}
              onOpen={() => onOpen(a.client.id)}
              showStage={panel.key.startsWith('impl_')}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function AlertRow({
  alert,
  onOpen,
  showStage,
}: {
  alert: CrmAlert
  onOpen: () => void
  showStage?: boolean
}) {
  const markSent = () => {
    if (!alert.followUp) return
    const next = (alert.client.followUps ?? []).map((f) =>
      f.id === alert.followUp!.id
        ? { ...f, sentAt: new Date().toISOString() }
        : f,
    )
    db.updateClient(alert.client.id, { followUps: next })
    db.addLog(
      alert.client.id,
      `Follow-up dia ${alert.followUp.dayNumber} enviado`,
    )
    toast.success('Marcado como enviado')
  }

  const copyMessage = async () => {
    const text = alert.message ?? alert.followUp?.message
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Mensagem copiada')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const stageStyle = showStage ? STAGE_COLORS[alert.client.stage] : null

  return (
    <li className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-elevate/[0.02]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{alert.title}</p>
          {stageStyle && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: stageStyle.bg, color: stageStyle.text }}
            >
              {stageStyle.label}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-foreground/55">{alert.subtitle}</p>
        {alert.message && (
          <p className="mt-1 line-clamp-2 text-[11px] text-foreground/45">
            {alert.message.length > 110
              ? alert.message.slice(0, 110) + '…'
              : alert.message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {alert.followUp && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyMessage}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
            >
              Copiar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={markSent}
              leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
            >
              Enviado
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={onOpen}
          rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
        >
          Abrir
        </Button>
      </div>
    </li>
  )
}
