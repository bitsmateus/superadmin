import * as React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertOctagon,
  Building2,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Flag,
  HeartCrack,
  MessageCircleWarning,
  Plus,
  RefreshCw,
  Ticket as TicketIcon,
  Wifi,
  X,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/hooks/useAuth'
import { useTeam, teamMemberLabel } from '@/hooks/useTeam'
import { useChurnRisk, useChurnRiskReport, useInvalidateChurnRisk } from '@/hooks/useChurnRisk'
import { ticketsService } from '@/services/tickets'
import { churnRiskService, CHURN_SEVERITY_LABEL } from '@/services/churnRisk'
import { canSeeFinancials } from '@/services/supabase'
import { STAGE_COLORS } from '@/constants/stageColors'
import { cn } from '@/lib/utils'
import type { ChurnRiskItem, ChurnRiskReport, ChurnSeverity } from '@/services/churnRisk'
import type { TeamMember } from '@/hooks/useTeam'

/** Casa o texto livre de responsável (responsavelEntrega/responsavel) com um membro do time —
 *  mesma regra usada em SupportWorkspacePage (PipelinePanel/unifiedTasks) pra "virar tarefa". */
function resolveTeamId(team: TeamMember[], name?: string | null): string | undefined {
  const n = (name ?? '').trim().toLowerCase()
  if (!n) return undefined
  const hit = team.find(
    (m) => (m.name ?? '').trim().toLowerCase() === n || m.email.trim().toLowerCase() === n,
  )
  return hit?.id
}

function signalSummary(item: ChurnRiskItem): string {
  const parts: string[] = []
  const d = item.details
  if (item.signals.pulse) {
    parts.push(
      d.pulseStatus === 'sem_resposta'
        ? 'Pulso de satisfação sem resposta'
        : 'Respondeu "não" no pulso de satisfação',
    )
  }
  if (item.signals.payment) {
    parts.push(`Pagamento em atraso${d.paymentSource === 'recorrai' ? ' (Recorrai)' : d.paymentSource === 'asaas' ? ' (Asaas)' : ''}`)
  }
  if (item.signals.channels) parts.push(`${d.channelsTotal} canal(is) desconectado(s)`)
  if (item.signals.tickets) {
    const t: string[] = []
    if (d.ticketsReopened > 0) t.push(`${d.ticketsReopened} ticket(s) reaberto(s)`)
    if (d.ticketsOverdue > 0) t.push(`${d.ticketsOverdue} ticket(s) com SLA estourado`)
    parts.push(t.join(' · '))
  }
  if (item.signals.manual && d.manualFlag) parts.push(`Marcado manualmente: ${d.manualFlag.reason || '(sem observação)'}`)
  return parts.join(' · ')
}

const SEVERITY_TONE: Record<ChurnSeverity, 'danger' | 'warning'> = {
  critico: 'danger',
  alto: 'danger',
  atencao: 'warning',
}
const SEVERITY_ORDER: ChurnSeverity[] = ['critico', 'alto', 'atencao']

export function ChurnRiskPage() {
  const { profile, loading: authLoading } = useAuth()
  const team = useTeam()
  const navigate = useNavigate()
  const { data, isLoading, isFetching, isError, refetch } = useChurnRisk()
  const [creating, setCreating] = React.useState<string | null>(null)
  const [verTodos, setVerTodos] = React.useState(false)
  const [reportOpen, setReportOpen] = React.useState(true)
  const [flagAlvo, setFlagAlvo] = React.useState<ChurnRiskItem | null>(null)
  const invalidate = useInvalidateChurnRisk()
  const report = useChurnRiskReport(reportOpen)

  if (authLoading) return null
  if (!canSeeFinancials(profile?.role)) return <Navigate to="/" replace />

  const items = data ?? []
  const comSinal = items.filter((i) => i.hasSignal)
  const semSinal = items.filter((i) => !i.hasSignal)
  const somenteCanais = comSinal.filter((i) => i.onlySignalIsChannels)
  const graduados = comSinal.filter((i) => !i.onlySignalIsChannels)
  const porSeveridade = new Map<ChurnSeverity, ChurnRiskItem[]>(SEVERITY_ORDER.map((s) => [s, []]))
  for (const i of graduados) if (i.severity) porSeveridade.get(i.severity)!.push(i)

  const createTask = async (item: ChurnRiskItem) => {
    setCreating(item.client_id)
    try {
      const ownerId =
        resolveTeamId(team, item.responsavelEntrega) ?? resolveTeamId(team, item.responsavel) ?? profile?.id ?? ''
      if (!ownerId) {
        toast.error('Não achei um responsável pra atribuir a tarefa.')
        return
      }
      const due = new Date()
      due.setDate(due.getDate() + 1)
      await ticketsService.upsertReminder({
        userId: ownerId,
        clientId: item.client_id,
        title: `Risco de churn — ligar/agendar reunião — ${item.company || item.name}`,
        notes: signalSummary(item),
        dueAt: due.toISOString(),
        kind: 'pending',
        status: 'todo',
        priority: 'high',
      })
      toast.success('Tarefa criada')
    } finally {
      setCreating(null)
    }
  }

  const resolverManual = async (item: ChurnRiskItem) => {
    try {
      await churnRiskService.resolve(item.client_id)
      toast.success('Risco manual resolvido')
      invalidate()
    } catch (err) {
      toast.error('Falha ao resolver: ' + (err as Error).message)
    }
  }

  return (
    <>
      <TopBar
        title="Risco de Churn"
        subtitle={
          isLoading
            ? 'Carregando…'
            : `${comSinal.length} cliente(s) com sinal de risco aceso · ${items.length} ativo(s) no total`
        }
        rightSlot={
          <Button
            variant="secondary"
            onClick={() => void refetch()}
            loading={isFetching && !isLoading}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Atualizar
          </Button>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <p className="mb-4 text-xs text-foreground/45">
          Cruza 5 sinais por cliente ativo: pulso de satisfação sem resposta ou "não", pagamento em
          atraso (Asaas ou Recorrai), todos os canais desconectados (NX Monitor), tickets reabertos
          ou com SLA estourado, e o que o time registrar manualmente.
        </p>

        <ReportSection open={reportOpen} onToggle={() => setReportOpen((o) => !o)} report={report.data} loading={report.isLoading} />

        <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            <button
              type="button"
              onClick={() => setVerTodos(false)}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors', !verTodos ? 'bg-accent/10 text-accent' : 'text-foreground/55 hover:bg-elevate/[0.04]')}
            >
              Só com sinal de risco
            </button>
            <button
              type="button"
              onClick={() => setVerTodos(true)}
              className={cn('px-3 py-1.5 text-xs font-medium transition-colors', verTodos ? 'bg-accent/10 text-accent' : 'text-foreground/55 hover:bg-elevate/[0.04]')}
            >
              Ver todos os clientes ({items.length})
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-8 text-center text-sm text-danger">
            Não consegui carregar o painel. Tente atualizar de novo.
          </div>
        )}

        {!isLoading && !isError && comSinal.length === 0 && !verTodos && (
          <EmptyState
            icon={<HeartCrack className="h-8 w-8" />}
            title="Nenhum sinal de risco no momento"
            description="Nenhum cliente ativo bateu algum dos sinais de risco de churn. 🎉"
          />
        )}

        {!isLoading && !isError && (
          <div className="space-y-3">
            {SEVERITY_ORDER.map((sev) => {
              const lista = porSeveridade.get(sev) ?? []
              if (lista.length === 0) return null
              return (
                <SeverityGroup
                  key={sev}
                  severity={sev}
                  items={lista}
                  defaultOpen
                  creating={creating}
                  onCreateTask={createTask}
                  onOpenClient={(id) => navigate(`/clients?open=${id}`)}
                  onFlag={setFlagAlvo}
                  onResolveManual={resolverManual}
                />
              )
            })}

            {somenteCanais.length > 0 && (
              <CollapsedGroup
                title="Só canal desconectado (baixa prioridade)"
                icon={<Wifi className="h-4 w-4 text-foreground/40" />}
                items={somenteCanais}
                defaultOpen={false}
              >
                {somenteCanais.map((item) => (
                  <RiskRow
                    key={item.client_id}
                    item={item}
                    creating={creating}
                    onCreateTask={createTask}
                    onOpenClient={(id) => navigate(`/clients?open=${id}`)}
                    onFlag={setFlagAlvo}
                    onResolveManual={resolverManual}
                  />
                ))}
              </CollapsedGroup>
            )}

            {verTodos && semSinal.length > 0 && (
              <CollapsedGroup
                title="Sem sinal de risco"
                icon={<HeartCrack className="h-4 w-4 text-foreground/40" />}
                items={semSinal}
                defaultOpen={false}
              >
                {semSinal.map((item) => (
                  <RiskRow
                    key={item.client_id}
                    item={item}
                    creating={creating}
                    onCreateTask={createTask}
                    onOpenClient={(id) => navigate(`/clients?open=${id}`)}
                    onFlag={setFlagAlvo}
                    onResolveManual={resolverManual}
                  />
                ))}
              </CollapsedGroup>
            )}
          </div>
        )}
      </div>

      {flagAlvo && (
        <FlagModal
          item={flagAlvo}
          authorName={profile?.name || profile?.email || undefined}
          onClose={() => setFlagAlvo(null)}
          onSaved={() => { setFlagAlvo(null); invalidate() }}
        />
      )}
    </>
  )
}

// ── Relatórios / gráficos ─────────────────────────────────────────────────────
function ReportSection({ open, onToggle, report, loading }: {
  open: boolean
  onToggle: () => void
  report: ChurnRiskReport | undefined
  loading: boolean
}) {
  return (
    <section className="rounded-2xl border border-line bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-foreground/40" /> : <ChevronRight className="h-4 w-4 text-foreground/40" />}
        <span className="text-sm font-semibold text-foreground">Relatórios</span>
        <span className="text-xs text-foreground/45">— sinais e severidade da base ativa agora, e o histórico dos riscos marcados à mão</span>
      </button>
      {open && (
        <div className="border-t border-line/70 p-4">
          {loading && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          )}
          {!loading && !report && (
            <p className="py-6 text-center text-xs text-foreground/40">Sem dados pra mostrar ainda.</p>
          )}
          {!loading && report && (
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Por sinal" subtitle={`${report.totalComSinal} de ${report.totalAtivos} clientes ativos`}>
                <BarRow label={'Pulso sem resposta / "não"'} value={report.bySignal.pulse} max={report.totalAtivos} color="bg-warning" />
                <BarRow label="Pagamento em atraso" value={report.bySignal.payment} max={report.totalAtivos} color="bg-danger" />
                <BarRow label="Canais desconectados" value={report.bySignal.channels} max={report.totalAtivos} color="bg-danger/70" />
                <BarRow label="Tickets" value={report.bySignal.tickets} max={report.totalAtivos} color="bg-warning" />
                <BarRow label="Marcado manualmente" value={report.bySignal.manual} max={report.totalAtivos} color="bg-accent" />
              </ChartCard>

              <ChartCard title="Por severidade" subtitle="Entre quem tem algum sinal">
                {SEVERITY_ORDER.map((sev) => (
                  <BarRow
                    key={sev}
                    label={CHURN_SEVERITY_LABEL[sev]}
                    value={report.bySeverity[sev]}
                    max={report.totalComSinal || 1}
                    color={sev === 'critico' ? 'bg-danger' : sev === 'alto' ? 'bg-danger/60' : 'bg-warning'}
                  />
                ))}
              </ChartCard>

              <ChartCard title="Riscos marcados à mão" subtitle={`${report.manualAtivos} ativo(s) · ${report.manualResolvidos} resolvido(s)`}>
                {report.manualHistory.length === 0 && (
                  <p className="text-xs text-foreground/40">Nenhum registro manual ainda.</p>
                )}
                {report.manualHistory.length > 0 && (
                  <div className="flex h-24 items-end gap-2">
                    {report.manualHistory.map((h) => {
                      const max = Math.max(...report.manualHistory.map((x) => x.novos), 1)
                      const [ano, mes] = h.mes.split('-')
                      const label = new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' })
                      return (
                        <div key={h.mes} className="flex flex-1 flex-col items-center gap-1">
                          <div className="flex h-16 w-full items-end">
                            <div
                              className="w-full rounded-t bg-accent/60"
                              style={{ height: `${Math.max((h.novos / max) * 100, h.novos > 0 ? 8 : 0)}%` }}
                              title={`${h.novos} novo(s) em ${label}`}
                            />
                          </div>
                          <span className="text-[10px] capitalize text-foreground/40">{label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </ChartCard>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line/70 p-3.5">
      <p className="text-xs font-semibold text-foreground/70">{title}</p>
      {subtitle && <p className="mb-2.5 text-[11px] text-foreground/40">{subtitle}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[11px] text-foreground/55">
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-foreground/70">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevate/[0.06]">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

// ── Grupos ─────────────────────────────────────────────────────────────────────
function SeverityGroup({ severity, items, defaultOpen, creating, onCreateTask, onOpenClient, onFlag, onResolveManual }: {
  severity: ChurnSeverity
  items: ChurnRiskItem[]
  defaultOpen: boolean
  creating: string | null
  onCreateTask: (item: ChurnRiskItem) => void
  onOpenClient: (id: string) => void
  onFlag: (item: ChurnRiskItem) => void
  onResolveManual: (item: ChurnRiskItem) => void
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className={cn('overflow-hidden rounded-xl border', severity === 'atencao' ? 'border-warning/30' : 'border-danger/30')}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn('flex w-full items-center gap-2 px-4 py-2.5 text-left', severity === 'atencao' ? 'bg-warning/[0.05]' : 'bg-danger/[0.05]')}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-foreground/40" /> : <ChevronRight className="h-3.5 w-3.5 text-foreground/40" />}
        <AlertOctagon className={cn('h-3.5 w-3.5', severity === 'atencao' ? 'text-warning' : 'text-danger')} />
        <span className="text-sm font-semibold text-foreground">{CHURN_SEVERITY_LABEL[severity]}</span>
        <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">{items.length}</span>
      </button>
      {open && (
        <ul className="space-y-2 p-3">
          {items.map((item) => (
            <RiskRow
              key={item.client_id}
              item={item}
              creating={creating}
              onCreateTask={onCreateTask}
              onOpenClient={onOpenClient}
              onFlag={onFlag}
              onResolveManual={onResolveManual}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function CollapsedGroup({ title, icon, items, defaultOpen, children }: {
  title: string
  icon: React.ReactNode
  items: unknown[]
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-elevate/[0.02]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-foreground/40" /> : <ChevronRight className="h-3.5 w-3.5 text-foreground/40" />}
        {icon}
        <span className="text-sm font-medium text-foreground/70">{title}</span>
        <span className="rounded-full bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/50">{items.length}</span>
      </button>
      {open && <ul className="space-y-2 border-t border-line/60 p-3">{children}</ul>}
    </section>
  )
}

// ── Linha de cliente ─────────────────────────────────────────────────────────
function RiskRow({ item, creating, onCreateTask, onOpenClient, onFlag, onResolveManual }: {
  item: ChurnRiskItem
  creating: string | null
  onCreateTask: (item: ChurnRiskItem) => void
  onOpenClient: (id: string) => void
  onFlag: (item: ChurnRiskItem) => void
  onResolveManual: (item: ChurnRiskItem) => void
}) {
  return (
    <li className={cn('rounded-xl border px-4 py-3.5', item.hasSignal ? 'border-warning/30 bg-warning/[0.03]' : 'border-line bg-card')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
            <span className="truncate text-sm font-semibold text-foreground">{item.company || item.name}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: STAGE_COLORS[item.stage]?.bg, color: STAGE_COLORS[item.stage]?.text }}
            >
              {STAGE_COLORS[item.stage]?.label ?? item.stage}
            </span>
            <button
              type="button"
              onClick={() => onOpenClient(item.client_id)}
              title="Abrir cliente"
              className="grid h-6 w-6 place-items-center rounded text-accent transition-colors hover:bg-accent/10"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {item.signals.pulse && (
              <Badge tone="warning">
                <MessageCircleWarning className="h-3 w-3" />
                {item.details.pulseStatus === 'sem_resposta' ? 'Pulso sem resposta' : 'Pulso: "não"'}
              </Badge>
            )}
            {item.signals.payment && (
              <Badge tone="danger">
                <CreditCard className="h-3 w-3" />
                Pagamento em atraso
                {item.details.paymentSource === 'recorrai' && ' · Recorrai'}
                {item.details.paymentSource === 'asaas' && ' · Asaas'}
              </Badge>
            )}
            {item.signals.channels && (
              <Badge tone="danger">
                <Wifi className="h-3 w-3" />
                {item.details.channelsTotal} canal(is) desconectado(s)
              </Badge>
            )}
            {item.signals.tickets && (
              <Badge tone="warning">
                <TicketIcon className="h-3 w-3" />
                {item.details.ticketsReopened > 0 && `${item.details.ticketsReopened} reaberto(s)`}
                {item.details.ticketsReopened > 0 && item.details.ticketsOverdue > 0 && ' · '}
                {item.details.ticketsOverdue > 0 && `${item.details.ticketsOverdue} SLA estourado`}
              </Badge>
            )}
            {item.signals.manual && item.details.manualFlag && (
              <Badge tone="info" title={item.details.manualFlag.reason || undefined}>
                <Flag className="h-3 w-3" />
                Manual — {CHURN_SEVERITY_LABEL[item.details.manualFlag.severity]}
                {item.details.manualFlag.createdBy ? ` (${item.details.manualFlag.createdBy})` : ''}
              </Badge>
            )}
            {!item.hasSignal && <span className="text-[11px] text-foreground/35">Nenhum sinal no momento</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {item.signals.manual ? (
            <Button size="sm" variant="secondary" onClick={() => onResolveManual(item)} leftIcon={<X className="h-3.5 w-3.5" />}>
              Resolver marcação
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onFlag(item)} leftIcon={<Flag className="h-3.5 w-3.5" />}>
              Marcar risco
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            loading={creating === item.client_id}
            onClick={() => onCreateTask(item)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Criar tarefa
          </Button>
        </div>
      </div>
    </li>
  )
}

// ── Registrar risco manualmente ────────────────────────────────────────────────
function FlagModal({ item, authorName, onClose, onSaved }: {
  item: ChurnRiskItem
  authorName: string | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const [severity, setSeverity] = React.useState<ChurnSeverity>('atencao')
  const [reason, setReason] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const salvar = async () => {
    setSalvando(true)
    try {
      await churnRiskService.flag(item.client_id, { severity, reason: reason.trim(), createdBy: authorName })
      toast.success('Risco de churn registrado')
      onSaved()
    } catch (err) {
      toast.error('Falha ao registrar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Marcar risco de churn — ${item.company || item.name}`}
      description="Fica marcado até alguém resolver — não depende de nenhum sinal automático."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void salvar()} loading={salvando}>Registrar</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Severidade</label>
          <div className="flex gap-1.5">
            {(['atencao', 'alto', 'critico'] as ChurnSeverity[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverity(s)}
                className={cn(
                  'flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors',
                  severity === s
                    ? s === 'critico' ? 'border-danger/40 bg-danger/10 text-danger' : s === 'alto' ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/40 bg-warning/10 text-warning'
                    : 'border-line text-foreground/55 hover:bg-elevate/[0.04]',
                )}
              >
                {CHURN_SEVERITY_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Por que esse cliente está em risco?</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="O que aconteceu, o que ele falou…"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground/30"
          />
        </div>
      </div>
    </Modal>
  )
}
