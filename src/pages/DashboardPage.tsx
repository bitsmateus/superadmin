import * as React from 'react'
import { Calendar, CheckCircle2, ChevronRight, FileText, MessageSquare, Settings2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { AlertsPanel } from '@/components/crm/AlertsPanel'
import { TodayActions } from '@/components/crm/TodayActions'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { MonthFilterBar } from '@/components/ui/MonthFilterBar'
import { useClients } from '@/hooks/useClients'
import { isBooted } from '@/services/db'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useMonthFilter, withinBounds } from '@/hooks/useMonthFilter'
import { PAST_BRIEFING_STAGES } from '@/lib/crmAlerts'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type { Client } from '@/types/client'

function isBriefingPendente(c: Client): boolean {
  if (c.stage === 'churned' || PAST_BRIEFING_STAGES.includes(c.stage)) return false
  if (c.briefingSentAt && (c.briefingStatus === 'sent' || c.briefingStatus === 'revision')) return true
  if (c.contractSignedAt && !c.briefingSentAt && c.briefingStatus !== 'filled' && c.briefingStatus !== 'approved') return true
  if (c.briefingStatus === 'filled' || c.briefingStatus === 'approved') return true
  return false
}

function isEmConfiguracao(c: Client): boolean {
  return c.stage === 'setup_start' || c.stage === 'setup' || c.stage === 'setup_done'
}

function isPendenteEntrega(c: Client): boolean {
  return (
    c.stage !== 'churned' &&
    c.stage !== 'delivered' &&
    c.stage !== 'active' &&
    Boolean(c.deliveryDate) &&
    !c.deliveryCompletedAt
  )
}

function isEntregaFeita(c: Client): boolean {
  return Boolean(c.deliveryCompletedAt)
}

// Data do follow-up pendente mais antigo (dia 3/7/15/30 já vencido e ainda não enviado) — só conta
// depois que a entrega foi marcada (followUpActive liga junto com "Entregas Recentes").
function dueFollowupDate(c: Client): string | undefined {
  if (!c.followUpActive || (c.stage !== 'active' && c.stage !== 'delivered')) return undefined
  const now = Date.now()
  const due = (c.followUps ?? [])
    .filter((f) => !f.sentAt && new Date(f.scheduledFor).getTime() <= now)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  return due[0]?.scheduledFor
}

/**
 * Dashboard principal — visão do suporte:
 *  - 5 cards de pipeline (Briefing pendente/Em configuração/Pendente de entrega/Entregas feitas/
 *    Follow-up pendente), filtráveis por mês (a data usada por card: stageUpdatedAt para os 2
 *    primeiros — quando o cliente entrou nesse estado —, deliveryDate/deliveryCompletedAt para os
 *    2 seguintes, e a data do follow-up vencido mais antigo para o último)
 *  - "Minhas tarefas" com o que precisa de ação hoje
 *  - AlertsPanel com os mesmos 4 recortes, sempre-atual (sem filtro de mês) — fila de trabalho
 *
 * Sem tenants, sem financeiro, sem metas — esses ficam no /comando.
 */
export function DashboardPage() {
  const clients = useClients()
  const booted = isBooted()
  const filter = useMonthFilter()

  const metrics = React.useMemo(() => {
    const briefing = clients.filter((c) => isBriefingPendente(c) && withinBounds(c.stageUpdatedAt, filter.bounds))
    const config = clients.filter((c) => isEmConfiguracao(c) && withinBounds(c.stageUpdatedAt, filter.bounds))
    const pendenteEntrega = clients.filter((c) => isPendenteEntrega(c) && withinBounds(c.deliveryDate, filter.bounds))
    const entregasFeitas = clients.filter((c) => isEntregaFeita(c) && withinBounds(c.deliveryCompletedAt, filter.bounds))
    const followup = clients.filter((c) => {
      const due = dueFollowupDate(c)
      return due !== undefined && withinBounds(due, filter.bounds)
    })
    return { briefing, config, pendenteEntrega, entregasFeitas, followup }
  }, [clients, filter.bounds])

  const [openId, setOpenId] = React.useState<string | null>(null)

  return (
    <>
      <TopBar
        title="Dashboard Suporte"
        subtitle="Painel do suporte — alertas e follow-ups do dia"
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <MonthFilterBar filter={filter} />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            icon={<FileText className="h-4 w-4" />}
            label="Briefing pendente"
            clients={booted ? metrics.briefing : null}
            tone="warning"
            onOpen={setOpenId}
          />
          <MetricCard
            icon={<Settings2 className="h-4 w-4" />}
            label="Em configuração"
            clients={booted ? metrics.config : null}
            tone="info"
            onOpen={setOpenId}
          />
          <MetricCard
            icon={<Calendar className="h-4 w-4" />}
            label="Pendente de entrega"
            clients={booted ? metrics.pendenteEntrega : null}
            tone="info"
            onOpen={setOpenId}
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Entregas feitas"
            clients={booted ? metrics.entregasFeitas : null}
            tone="success"
            onOpen={setOpenId}
          />
          <MetricCard
            icon={<MessageSquare className="h-4 w-4" />}
            label="Follow-up pendente"
            clients={booted ? metrics.followup : null}
            tone="warning"
            onOpen={setOpenId}
          />
        </div>

        <section className="mt-6">
          <TodayActions />
        </section>

        <section className="mt-6">
          <AlertsPanel />
        </section>
      </div>

      <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} />
    </>
  )
}

function MetricCard({
  icon,
  label,
  clients,
  tone,
  onOpen,
}: {
  icon: React.ReactNode
  label: string
  clients: Client[] | null
  tone: 'info' | 'success' | 'danger' | 'warning'
  onOpen: (id: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
  }

  const handleClick = () => {
    if (!clients || clients.length === 0) return
    // 1 resultado só = já abre direto o cliente. Mais de um = lista pra escolher qual.
    if (clients.length === 1) { onOpen(clients[0].id); return }
    setOpen((o) => !o)
  }

  const clickable = Boolean(clients && clients.length > 0)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleClick}
        disabled={!clickable}
        className={cn(
          'w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition-all',
          clickable
            ? 'cursor-pointer hover:-translate-y-0.5 hover:border-elevate/20 hover:shadow-md'
            : 'cursor-default',
        )}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground/45">
            {label}
          </span>
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-lg ring-1',
              tones[tone],
            )}
          >
            {icon}
          </span>
        </div>
        <div className="mt-3">
          {clients === null ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <span
              className={cn(
                'text-2xl font-semibold tracking-tight tabular-nums',
                clients.length === 0 ? 'text-foreground/40' : 'text-foreground',
              )}
            >
              {clients.length.toLocaleString('pt-BR')}
            </span>
          )}
        </div>
      </button>

      {open && clients && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-line bg-card p-1.5 shadow-xl animate-fade-in">
          <ul className="max-h-64 overflow-y-auto">
            {clients.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => { onOpen(c.id); setOpen(false) }}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/70 hover:bg-elevate/[0.05]"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground/85">
                    {c.company || c.name || 'Sem nome'}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-foreground/30" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
