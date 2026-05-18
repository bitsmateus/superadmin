import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import {
  AlertTriangle,
  ArrowDownCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  KanbanSquare,
  List as ListIcon,
  ListChecks,
  PlusCircle,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ClientDrawer } from '@/components/crm/ClientDrawer'
import { StageBadge } from '@/components/crm/StageBadge'
import { useClients } from '@/hooks/useClients'
import { db } from '@/services/db'
import {
  NEXT_STAGE,
  PIPELINE_STAGES,
  STAGE_COLORS,
} from '@/constants/stageColors'
import { asText, cn, formatDateShort, initials } from '@/lib/utils'
import { daysSince, timeAgo } from '@/lib/time'
import type { Client, PipelineStage } from '@/types/client'

type ViewMode = 'kanban' | 'list'
const VIEW_LS_KEY = 'tenanthub_pipeline_view'

function readView(): ViewMode {
  if (typeof window === 'undefined') return 'kanban'
  try {
    const v = window.localStorage.getItem(VIEW_LS_KEY)
    return v === 'list' ? 'list' : 'kanban'
  } catch {
    return 'kanban'
  }
}

export function PipelinePage() {
  const clients = useClients()
  const [search, setSearch] = React.useState('')
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<ViewMode>(readView)

  React.useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_LS_KEY, view)
    } catch {
      /* ignore */
    }
  }, [view])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const byStage = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    const buckets: Record<PipelineStage, Client[]> = {
      lead: [],
      welcome: [],
      contract: [],
      briefing: [],
      setup: [],
      delivery: [],
      active: [],
      churned: [],
    }
    for (const c of clients) {
      if (q) {
        const blob =
          asText(c.name).toLowerCase() +
          ' ' +
          asText(c.company).toLowerCase()
        if (!blob.includes(q)) continue
      }
      buckets[c.stage].push(c)
    }
    return buckets
  }, [clients, search])

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const targetStage = String(over.id) as PipelineStage
    if (!PIPELINE_STAGES.includes(targetStage)) return
    const client = clients.find((c) => c.id === active.id)
    if (!client || client.stage === targetStage) return
    db.updateClient(client.id, { stage: targetStage })
    db.addLog(
      client.id,
      'Etapa alterada',
      `${STAGE_COLORS[client.stage].label} → ${STAGE_COLORS[targetStage].label}`,
    )
    toast.success(`${client.name} → ${STAGE_COLORS[targetStage].label}`)
  }

  const activeClient = activeId ? clients.find((c) => c.id === activeId) : null

  const advanceStage = (c: Client) => {
    const next = NEXT_STAGE[c.stage]
    if (!next) {
      toast.info('Cliente já está na etapa final')
      return
    }
    db.updateClient(c.id, { stage: next })
    db.addLog(
      c.id,
      'Etapa alterada',
      `${STAGE_COLORS[c.stage].label} → ${STAGE_COLORS[next].label}`,
    )
    toast.success(`${c.name} → ${STAGE_COLORS[next].label}`)
  }

  return (
    <>
      <TopBar
        title="Pipeline"
        subtitle={`${clients.length} cliente(s) no funil`}
        rightSlot={
          <Button
            onClick={() => toast.info('Crie clientes em /clients')}
            leftIcon={<PlusCircle className="h-4 w-4" />}
            variant="secondary"
          >
            Novo cliente
          </Button>
        }
      />

      <div className="px-8 py-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input
            placeholder="Filtrar por nome ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
          <ViewToggle value={view} onChange={setView} />
        </div>

        {view === 'kanban' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            <div className="grid grid-flow-col auto-cols-[280px] gap-3 overflow-x-auto pb-3">
              {PIPELINE_STAGES.map((stage) => (
                <Column
                  key={stage}
                  stage={stage}
                  clients={byStage[stage]}
                  onCardClick={(id) => setOpenClientId(id)}
                />
              ))}
            </div>

            <DragOverlay>
              {activeClient ? (
                <ClientCard client={activeClient} dragging onClick={() => {}} />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <ListView
            byStage={byStage}
            onRowClick={(id) => setOpenClientId(id)}
            onAdvance={advanceStage}
          />
        )}
      </div>

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
      />
    </>
  )
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (v: ViewMode) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Modo de visualização"
      className="inline-flex items-center rounded-lg border border-line bg-card p-0.5"
    >
      <ToggleBtn
        active={value === 'kanban'}
        onClick={() => onChange('kanban')}
        icon={<KanbanSquare className="h-3.5 w-3.5" />}
        label="Kanban"
      />
      <ToggleBtn
        active={value === 'list'}
        onClick={() => onChange('list')}
        icon={<ListIcon className="h-3.5 w-3.5" />}
        label="Lista"
      />
    </div>
  )
}

function ToggleBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
          : 'text-white/55 hover:bg-white/[0.04] hover:text-white',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function ListView({
  byStage,
  onRowClick,
  onAdvance,
}: {
  byStage: Record<PipelineStage, Client[]>
  onRowClick: (id: string) => void
  onAdvance: (c: Client) => void
}) {
  return (
    <div className="space-y-3">
      {PIPELINE_STAGES.map((stage) => (
        <ListGroup
          key={stage}
          stage={stage}
          clients={byStage[stage]}
          onRowClick={onRowClick}
          onAdvance={onAdvance}
        />
      ))}
    </div>
  )
}

function ListGroup({
  stage,
  clients,
  onRowClick,
  onAdvance,
}: {
  stage: PipelineStage
  clients: Client[]
  onRowClick: (id: string) => void
  onAdvance: (c: Client) => void
}) {
  const [open, setOpen] = React.useState(true)
  const style = STAGE_COLORS[stage]

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      style={{ borderLeft: `3px solid ${style.dot}` }}
    >
      <header
        className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 hover:bg-white/[0.02]"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-white/45" />
          ) : (
            <ChevronRight className="h-4 w-4 text-white/45" />
          )}
          <span
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: style.text }}
          >
            {style.label}
          </span>
          <span className="text-xs text-white/45">
            {clients.length} cliente{clients.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {open && (
        <div className="border-t border-line">
          {clients.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-white/35">
              Nenhum cliente nesta etapa.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-white/40">
                  <th className="px-4 py-2 text-left font-medium">Cliente</th>
                  <th className="px-4 py-2 text-left font-medium">Empresa</th>
                  <th className="px-4 py-2 text-left font-medium">Entrada</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Última atualização
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Alertas</th>
                  <th className="w-px px-4 py-2 text-right font-medium">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const alerts = computeAlerts(c)
                  const next = NEXT_STAGE[c.stage]
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onRowClick(c.id)}
                      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-white/[0.03] last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[10px] font-medium text-white/85 ring-1 ring-line">
                            {initials(c.name) || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-white">
                              {asText(c.name, '—')}
                            </div>
                            <div className="mt-0.5">
                              <StageBadge stage={c.stage} size="sm" />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-white/70">
                        <div>{asText(c.company, '—')}</div>
                        {c.stage === 'setup' &&
                          (() => {
                            const hint = checklistHint(c)
                            return hint ? (
                              <div className="mt-0.5 text-[10.5px] text-white/45">
                                Checklist {hint.done}/{hint.total} · {hint.label}
                              </div>
                            ) : null
                          })()}
                      </td>
                      <td className="px-4 py-3 text-white/55">
                        {formatDateShort(c.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-white/55">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(c.stageUpdatedAt ?? c.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {alerts.length === 0 ? (
                          <span className="text-xs text-white/30">—</span>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            {alerts.map((a, i) => (
                              <span
                                key={i}
                                title={a.title}
                                className={cn(
                                  'grid h-5 w-5 place-items-center rounded-full',
                                  a.tone === 'red'
                                    ? 'bg-danger/15 text-danger'
                                    : 'bg-warning/15 text-warning',
                                )}
                              >
                                <AlertTriangle className="h-3 w-3" />
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={
                            next
                              ? `Avançar para ${STAGE_COLORS[next].label}`
                              : 'Sem próxima etapa'
                          }
                          title={
                            next
                              ? `Avançar para ${STAGE_COLORS[next].label}`
                              : 'Já está na etapa final'
                          }
                          disabled={!next}
                          onClick={(e) => {
                            e.stopPropagation()
                            onAdvance(c)
                          }}
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
                            next
                              ? 'bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20'
                              : 'cursor-not-allowed bg-white/[0.03] text-white/25 ring-line',
                          )}
                        >
                          <ArrowDownCircle className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}

function Column({
  stage,
  clients,
  onCardClick,
}: {
  stage: PipelineStage
  clients: Client[]
  onCardClick: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  const style = STAGE_COLORS[stage]
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex h-full flex-col rounded-xl border border-line bg-card/60 transition-colors',
        isOver && 'border-accent/40 bg-accent/[0.04]',
      )}
    >
      <header
        className="flex items-center justify-between gap-2 rounded-t-xl border-b border-line px-3 py-2.5"
        style={{ background: `linear-gradient(180deg, ${style.bg}, transparent)` }}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: style.dot }}
          />
          <span className="text-xs font-medium" style={{ color: style.text }}>
            {style.label}
          </span>
        </div>
        <span className="text-[11px] text-white/45">{clients.length}</span>
      </header>
      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
        {clients.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-white/30">
            Solte um cliente aqui
          </p>
        ) : (
          clients.map((c) => (
            <ClientCard key={c.id} client={c} onClick={() => onCardClick(c.id)} />
          ))
        )}
      </div>
    </section>
  )
}

function ClientCard({
  client,
  dragging,
  onClick,
}: {
  client: Client
  dragging?: boolean
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: client.id })

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    opacity: isDragging ? 0.4 : 1,
  }

  const alerts = computeAlerts(client)
  const setupHint = client.stage === 'setup' ? checklistHint(client) : null

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'rounded-lg border border-line bg-card p-3 transition-shadow',
        dragging
          ? 'cursor-grabbing shadow-lg ring-1 ring-accent/40'
          : 'cursor-grab hover:border-white/15',
      )}
    >
      <div
        {...listeners}
        onClick={(e) => {
          // pointer activation w/ distance prevents click-during-drag; this is reliable
          if (!isDragging && !dragging) {
            e.stopPropagation()
            onClick()
          }
        }}
      >
        <div className="flex items-start gap-2">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.05] text-[10px] font-medium text-white/85 ring-1 ring-line">
            {initials(client.name) || '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {asText(client.name, '—')}
            </p>
            <p className="truncate text-[11px] text-white/45">
              {asText(client.company, '—')}
            </p>
          </div>
        </div>

        <div className="mt-2">
          <StageBadge stage={client.stage} size="sm" />
        </div>

        {setupHint && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-white/[0.03] px-2 py-1.5 text-[10.5px] text-white/70 ring-1 ring-line">
            <ListChecks className="mt-0.5 h-3 w-3 shrink-0 text-success" />
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase tracking-wider text-white/40">
                Checklist {setupHint.done}/{setupHint.total}
              </div>
              <div className="truncate">{setupHint.label}</div>
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-white/45">
            <Clock className="h-3 w-3" />
            {timeAgo(client.stageUpdatedAt ?? client.createdAt)}
          </span>
          {alerts.length > 0 && (
            <div className="flex items-center gap-1">
              {alerts.map((a, i) => (
                <span
                  key={i}
                  title={a.title}
                  className={cn(
                    'grid h-5 w-5 place-items-center rounded-full',
                    a.tone === 'red'
                      ? 'bg-danger/15 text-danger'
                      : 'bg-warning/15 text-warning',
                  )}
                >
                  <AlertTriangle className="h-3 w-3" />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function checklistHint(
  c: Client,
): { done: number; total: number; label: string } | null {
  const items = c.deliveryChecklist ?? []
  if (items.length === 0) return null
  const done = items.filter((i) => i.checked).length
  const next = items.find((i) => !i.checked)
  return {
    done,
    total: items.length,
    label: next ? next.label : 'Checklist concluído',
  }
}

interface CardAlert {
  tone: 'red' | 'orange'
  title: string
}

function computeAlerts(c: Client): CardAlert[] {
  const alerts: CardAlert[] = []
  if (c.contractSentAt && !c.contractSignedAt) {
    const days = daysSince(c.contractSentAt)
    if (days >= 3)
      alerts.push({
        tone: 'red',
        title: `Contrato enviado há ${days} dias sem assinatura`,
      })
  }
  if (
    c.briefingSentAt &&
    (c.briefingStatus === 'sent' || c.briefingStatus === 'revision')
  ) {
    const days = daysSince(c.briefingSentAt)
    if (days >= 5)
      alerts.push({
        tone: 'orange',
        title: `Briefing enviado há ${days} dias sem resposta`,
      })
  }
  if (c.paymentStatus === 'overdue') {
    alerts.push({ tone: 'red', title: 'Pagamento vencido' })
  }
  return alerts
}
