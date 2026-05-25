import * as React from 'react'
import {
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  Cpu,
  PlugZap,
  Send,
  Settings2,
  Sparkles,
  Truck,
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
    key: 'briefing_pending',
    title: 'Aguardando envio do briefing',
    description: 'Contrato assinado e briefing ainda não foi enviado',
    kinds: ['briefing_pending_send'],
    icon: <Send className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'briefing_filled',
    title: 'Briefing preenchido, sem configuração',
    description: 'Cliente respondeu mas ainda não foi pra etapa de setup',
    kinds: ['briefing_filled_no_setup'],
    icon: <Sparkles className="h-3.5 w-3.5" />,
    tone: 'warning',
  },
  {
    key: 'setup_in_progress',
    title: 'Configuração em andamento',
    description: 'Setup ativo — prazo de 3 dias + etapa atual do checklist',
    kinds: ['setup_in_progress'],
    icon: <Settings2 className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'impl_api_oficial',
    title: 'Clientes — API Oficial',
    description: 'Implementações que usam WhatsApp API Oficial',
    kinds: ['impl_api_oficial'],
    icon: <PlugZap className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'impl_ia',
    title: 'Clientes — IA',
    description: 'Implementações com IA integrada (atendimento automático)',
    kinds: ['impl_ia'],
    icon: <Bot className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'impl_automacao_externa',
    title: 'Clientes — Automação externa',
    description: 'Integração com automações externas (n8n, Make, etc.)',
    kinds: ['impl_automacao_externa'],
    icon: <Cpu className="h-3.5 w-3.5" />,
    tone: 'info',
  },
  {
    key: 'delivery_scheduled',
    title: 'Entrega agendada',
    description: 'Treinamentos marcados — hoje e nos próximos dias',
    kinds: ['delivery_scheduled'],
    icon: <Calendar className="h-3.5 w-3.5" />,
    tone: 'success',
  },
  {
    key: 'delivery_done',
    title: 'Entregas realizadas (7 dias)',
    description: 'Clientes que foram entregues na última semana',
    kinds: ['delivery_done_this_week'],
    icon: <Truck className="h-3.5 w-3.5" />,
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

  // Mostra SEMPRE todos os painéis pré-definidos, mesmo com contador 0.
  // Dashboard de suporte fica com estrutura previsível em vez de aparecer
  // só quando há alertas.
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

  const empty = alerts.length === 0

  return (
    <section
      className={cn(
        'flex flex-col rounded-2xl border bg-card transition-opacity',
        empty ? 'border-line opacity-60' : 'border-line',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              'grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1',
              empty
                ? 'bg-elevate/[0.04] text-foreground/40 ring-line'
                : toneClasses,
            )}
          >
            {panel.icon}
          </span>
          <div>
            <h3 className="text-sm font-medium text-foreground">{panel.title}</h3>
            <p className="text-[11px] text-foreground/45">{panel.description}</p>
          </div>
        </div>
        <Badge tone={empty ? 'neutral' : panel.tone} dot={!empty}>
          {alerts.length}
        </Badge>
      </header>
      {empty ? (
        <div className="px-4 py-5 text-center">
          <p className="text-xs text-foreground/40">Nada por aqui agora</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => (
            <AlertRow
              key={`${panel.key}-${a.client.id}-${a.kind}-${a.followUp?.id ?? a.whenAt ?? ''}`}
              alert={a}
              onOpen={() => onOpen(a.client.id)}
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
}: {
  alert: CrmAlert
  onOpen: () => void
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

  return (
    <li className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-elevate/[0.02]">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{alert.title}</p>
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
