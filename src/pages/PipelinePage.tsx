import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  ListChecks,
  Phone,
  PlusCircle,
  Search,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { StageBadge } from '@/components/crm/StageBadge'
import { useClients } from '@/hooks/useClients'
import { db } from '@/services/db'
import {
  NEXT_STAGE,
  PREV_STAGE,
  PIPELINE_STAGES,
  STAGE_COLORS,
  STAGE_SLA_DAYS,
} from '@/constants/stageColors'
import { asText, cn, formatDateShort, initials } from '@/lib/utils'
import { daysSince, timeAgo } from '@/lib/time'
import type { Client, PipelineStage } from '@/types/client'

const newClientSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  company: z.string().min(2, 'Mínimo 2 caracteres'),
  phone: z.string().min(8, 'Telefone inválido'),
})
type NewClientValues = z.infer<typeof newClientSchema>

export function PipelinePage() {
  const clients = useClients()
  const [search, setSearch] = React.useState('')
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)
  const [openNew, setOpenNew] = React.useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<NewClientValues>({
    resolver: zodResolver(newClientSchema),
    mode: 'onChange',
  })

  const onCreate = (values: NewClientValues) => {
    const client = db.createClient({
      name: values.name.trim(),
      company: values.company.trim(),
      email: '',
      phone: values.phone.trim(),
      responsavel: undefined,
    })
    toast.success(`Cliente "${client.name}" criado`)
    setOpenNew(false)
    reset()
    setOpenClientId(client.id)
  }

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

  const advanceStage = (c: Client) => {
    const next = NEXT_STAGE[c.stage]
    if (!next) { toast.info('Cliente já está na etapa final'); return }
    db.updateClient(c.id, { stage: next })
    db.addLog(c.id, 'Etapa alterada', `${STAGE_COLORS[c.stage].label} → ${STAGE_COLORS[next].label}`)
    toast.success(`${c.name} → ${STAGE_COLORS[next].label}`)
  }

  const regressStage = (c: Client) => {
    const prev = PREV_STAGE[c.stage]
    if (!prev) { toast.info('Cliente já está na primeira etapa'); return }
    db.updateClient(c.id, { stage: prev })
    db.addLog(c.id, 'Etapa revertida', `${STAGE_COLORS[c.stage].label} → ${STAGE_COLORS[prev].label}`)
    toast.success(`${c.name} → ${STAGE_COLORS[prev].label}`)
  }

  return (
    <>
      <TopBar
        title="Pipeline"
        subtitle={`${clients.length} cliente(s) no funil`}
        rightSlot={
          <Button
            onClick={() => setOpenNew(true)}
            leftIcon={<PlusCircle className="h-4 w-4" />}
          >
            Novo cliente
          </Button>
        }
      />

      <div className="px-8 py-6">
        <div className="mb-4">
          <Input
            placeholder="Filtrar por nome ou empresa…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
        </div>

        <div className="space-y-3">
          {PIPELINE_STAGES.map((stage) => (
            <ListGroup
              key={stage}
              stage={stage}
              clients={byStage[stage]}
              onRowClick={(id) => setOpenClientId(id)}
              onAdvance={advanceStage}
              onRegress={regressStage}
            />
          ))}
        </div>
      </div>

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
      />

      <Modal
        open={openNew}
        onClose={() => { setOpenNew(false); reset() }}
        title="Novo cliente"
        description="Começa na etapa 'Boas-vindas'. Avance pelo pipeline depois."
        size="md"
      >
        <form
          onSubmit={handleSubmit(onCreate)}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <Input
              label="Nome *"
              leftIcon={<UserCircle2 className="h-4 w-4" />}
              {...register('name')}
              error={errors.name?.message}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Empresa *"
              leftIcon={<Building2 className="h-4 w-4" />}
              {...register('company')}
              error={errors.company?.message}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="Telefone *"
              leftIcon={<Phone className="h-4 w-4" />}
              {...register('phone')}
              error={errors.phone?.message}
            />
          </div>
          <div className="sm:col-span-2 mt-2 flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setOpenNew(false); reset() }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid}>
              Criar cliente
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}

function ListGroup({
  stage,
  clients,
  onRowClick,
  onAdvance,
  onRegress,
}: {
  stage: PipelineStage
  clients: Client[]
  onRowClick: (id: string) => void
  onAdvance: (c: Client) => void
  onRegress: (c: Client) => void
}) {
  const [open, setOpen] = React.useState(true)
  const style = STAGE_COLORS[stage]

  return (
    <section
      className="overflow-hidden rounded-xl border border-line bg-card"
      style={{ borderLeft: `3px solid ${style.dot}` }}
    >
      <header
        className="flex cursor-pointer select-none items-center justify-between gap-3 px-4 py-3 hover:bg-elevate/[0.02]"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-foreground/45" />
          ) : (
            <ChevronRight className="h-4 w-4 text-foreground/45" />
          )}
          <span
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: style.text }}
          >
            {style.label}
          </span>
          <span className="text-xs text-foreground/45">
            {clients.length} cliente{clients.length === 1 ? '' : 's'}
          </span>
        </div>
      </header>

      {open && (
        <div className="border-t border-line">
          {clients.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-foreground/35">
              Nenhum cliente nesta etapa.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-foreground/40">
                  <th className="px-4 py-2 text-left font-medium">Cliente</th>
                  <th className="px-4 py-2 text-left font-medium">Empresa</th>
                  <th className="px-4 py-2 text-left font-medium">Entrada</th>
                  <th className="px-4 py-2 text-left font-medium">Na etapa</th>
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
                  const prev = PREV_STAGE[c.stage]
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onRowClick(c.id)}
                      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-elevate/[0.03] last:border-b-0"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.05] text-[10px] font-medium text-foreground/85 ring-1 ring-line">
                            {initials(c.name) || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-foreground">
                              {asText(c.name, '—')}
                            </div>
                            <div className="mt-0.5">
                              <StageBadge stage={c.stage} size="sm" />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-foreground/70">
                        <div>{asText(c.company, '—')}</div>
                        {c.stage === 'setup' &&
                          (() => {
                            const hint = checklistHint(c)
                            return hint ? (
                              <div className="mt-0.5 text-[10.5px] text-foreground/45">
                                Checklist {hint.done}/{hint.total} · {hint.label}
                              </div>
                            ) : null
                          })()}
                      </td>
                      <td className="px-4 py-3 text-foreground/55">
                        {formatDateShort(c.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <StageAgeBadge stage={c.stage} since={c.stageUpdatedAt ?? c.createdAt} />
                      </td>
                      <td className="px-4 py-3 text-foreground/55">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(c.stageUpdatedAt ?? c.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {alerts.length === 0 ? (
                          <span className="text-xs text-foreground/30">—</span>
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
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            title={prev ? `Voltar para ${STAGE_COLORS[prev].label}` : 'Sem etapa anterior'}
                            disabled={!prev}
                            onClick={(e) => { e.stopPropagation(); onRegress(c) }}
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
                              prev
                                ? 'bg-elevate/[0.06] text-foreground/50 ring-line hover:bg-warning/10 hover:text-warning hover:ring-warning/30'
                                : 'cursor-not-allowed bg-elevate/[0.03] text-foreground/20 ring-line',
                            )}
                          >
                            <ArrowUpCircle className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title={next ? `Avançar para ${STAGE_COLORS[next].label}` : 'Já está na etapa final'}
                            disabled={!next}
                            onClick={(e) => { e.stopPropagation(); onAdvance(c) }}
                            className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-full ring-1 transition-colors',
                              next
                                ? 'bg-accent/10 text-accent ring-accent/30 hover:bg-accent/20'
                                : 'cursor-not-allowed bg-elevate/[0.03] text-foreground/25 ring-line',
                            )}
                          >
                            <ArrowDownCircle className="h-4 w-4" />
                          </button>
                        </div>
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

/**
 * Mostra há quantos dias o cliente está na etapa atual, com cor de acordo com
 * o SLA da etapa (verde/neutro dentro do prazo, laranja no limite, vermelho
 * estourado). Ajuda o time a não deixar cliente esquecido numa etapa.
 */
function StageAgeBadge({ stage, since }: { stage: PipelineStage; since: string }) {
  const days = daysSince(since)
  const sla = STAGE_SLA_DAYS[stage]
  let cls = 'bg-elevate/[0.05] text-foreground/55 ring-line'
  let title = `${days} dia(s) nesta etapa`
  if (sla != null) {
    if (days > sla) {
      cls = 'bg-danger/15 text-danger ring-danger/30'
      title = `${days} dia(s) — SLA de ${sla} dias estourado`
    } else if (days >= sla) {
      cls = 'bg-warning/15 text-warning ring-warning/30'
      title = `${days} dia(s) — no limite do SLA (${sla} dias)`
    }
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ring-1',
        cls,
      )}
    >
      {days}d
    </span>
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
