import * as React from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  CreditCard,
  FileText,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ClientDrawer } from '@/components/crm/ClientDrawer'
import { useClients } from '@/hooks/useClients'
import { computeAlerts, type AlertKind, type CrmAlert } from '@/lib/crmAlerts'
import { db } from '@/services/db'
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
    key: 'meetings',
    title: 'Reuniões de entrega',
    description: 'Treinamentos agendados — hoje e nos próximos dias',
    kinds: ['delivery_meeting'],
    icon: <Calendar className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'config_pending',
    title: 'Configurações pendentes de preenchimento',
    description: 'Clientes na etapa de configuração com checklist em aberto',
    kinds: ['setup_pending_config'],
    icon: <Settings2 className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'followups',
    title: 'Follow-ups do dia',
    description: 'Mensagens para enviar hoje ou em atraso',
    kinds: ['followup_today', 'followup_late'],
    icon: <Send className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'contracts',
    title: 'Contratos sem assinatura',
    description: 'Enviados há 3+ dias e ainda pendentes',
    kinds: ['contract_no_signature'],
    icon: <FileText className="h-3.5 w-3.5" />,
    tone: 'danger',
  },
  {
    key: 'briefings',
    title: 'Briefings sem resposta',
    description: 'Enviados há 5+ dias sem retorno do cliente',
    kinds: ['briefing_no_response'],
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'payments',
    title: 'Pagamentos vencidos',
    description: 'Cobranças marcadas como vencidas no Asaas',
    kinds: ['payment_overdue'],
    icon: <CreditCard className="h-3.5 w-3.5" />,
    tone: 'danger',
  },
  {
    key: 'ready',
    title: 'Prontos para avançar',
    description: 'Briefings aprovados aguardando configuração',
    kinds: ['briefing_ready_to_setup'],
    icon: <Sparkles className="h-3.5 w-3.5" />,
    tone: 'success',
  },
]

export function AlertsPanel() {
  const clients = useClients()
  const alerts = React.useMemo(() => computeAlerts(clients), [clients])
  const [openId, setOpenId] = React.useState<string | null>(null)

  const grouped = React.useMemo(() => {
    const map = new Map<string, CrmAlert[]>()
    for (const a of alerts) {
      for (const p of PANELS) {
        if (p.kinds.includes(a.kind)) {
          const list = map.get(p.key) ?? []
          list.push(a)
          map.set(p.key, list)
          break
        }
      }
    }
    const meetings = map.get('meetings')
    if (meetings) {
      meetings.sort((a, b) => {
        const ta = a.whenAt ? new Date(a.whenAt).getTime() : 0
        const tb = b.whenAt ? new Date(b.whenAt).getTime() : 0
        return ta - tb
      })
    }
    return map
  }, [alerts])

  const activePanels = PANELS.filter(
    (p) => (grouped.get(p.key)?.length ?? 0) > 0,
  )

  if (activePanels.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-card px-5 py-6">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-success/10 text-success ring-1 ring-success/20">
          <Bell className="h-4 w-4" />
        </span>
        <div>
          <h3 className="text-sm font-medium text-white">
            Sem alertas no momento
          </h3>
          <p className="text-xs text-white/55">
            Quando houver reuniões agendadas, follow-ups, contratos ou
            briefings pendentes, eles aparecem aqui.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activePanels.map((panel) => (
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
            <h3 className="text-sm font-medium text-white">{panel.title}</h3>
            <p className="text-[11px] text-white/45">{panel.description}</p>
          </div>
        </div>
        <Badge tone={panel.tone} dot>
          {alerts.length}
        </Badge>
      </header>
      <ul className="divide-y divide-line">
        {alerts.map((a, i) => (
          <AlertRow
            key={`${panel.key}-${a.client.id}-${a.kind}-${i}`}
            alert={a}
            onOpen={() => onOpen(a.client.id)}
          />
        ))}
      </ul>
    </section>
  )
}

function AlertRow({
  alert,
  onOpen,
}: {
  alert: CrmAlert
  onOpen: () => void
}) {
  const markSent = () => {
    if (!alert.followUp) return
    const next = alert.client.followUps.map((f) =>
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

  return (
    <li className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.02]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{alert.title}</p>
        <p className="truncate text-[11px] text-white/55">{alert.subtitle}</p>
        {alert.message && (
          <p className="mt-1 line-clamp-2 text-[11px] text-white/45">
            {alert.message.length > 110
              ? alert.message.slice(0, 110) + '…'
              : alert.message}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {alert.followUp && (
          <Button
            size="sm"
            variant="ghost"
            onClick={markSent}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Enviado
          </Button>
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
