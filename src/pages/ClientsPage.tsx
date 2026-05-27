import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Building2,
  CreditCard,
  Download,
  Mail,
  Phone,
  PlusCircle,
  Search,
  Server as ServerIcon,
  User as UserIcon,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { StageBadge } from '@/components/crm/StageBadge'
import { ClientDrawer } from '@/components/crm/ClientDrawer'
import { TenantImportModal } from '@/components/tenants/TenantImportModal'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/constants/stageColors'
import { useClients } from '@/hooks/useClients'
import { useAllTenants } from '@/hooks/useTenants'
import { useAuth } from '@/hooks/useAuth'
import { db } from '@/services/db'
import { canSeeFinancials } from '@/services/supabase'
import { matchTenantsToClients } from '@/services/tenantImport'
import { asText, initials } from '@/lib/utils'
import { daysSince, timeAgo } from '@/lib/time'
import type { PipelineStage } from '@/types/client'
import { cn } from '@/lib/utils'

const newClientSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  company: z.string().min(2, 'Mínimo 2 caracteres'),
  phone: z.string().min(8, 'Telefone inválido'),
})

type NewClientValues = z.infer<typeof newClientSchema>

export function ClientsPage() {
  const clients = useClients()
  const { data: allTenants } = useAllTenants()
  const { profile } = useAuth()
  const seeFinancials = canSeeFinancials(profile?.role)
  const [search, setSearch] = React.useState('')
  const [stageFilter, setStageFilter] = React.useState<PipelineStage | 'all'>(
    'all',
  )
  const [openNew, setOpenNew] = React.useState(false)
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)

  // ?open=<id> abre o drawer direto (vindo de outras páginas, ex.: /financeiro).
  const [searchParams, setSearchParams] = useSearchParams()
  React.useEffect(() => {
    const id = searchParams.get('open')
    if (!id) return
    setOpenClientId(id)
    // remove o param sem entrar na history pra não voltar ao "?open=" depois
    const next = new URLSearchParams(searchParams)
    next.delete('open')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
  const [importOpen, setImportOpen] = React.useState(false)

  const unlinkedCount = React.useMemo(() => {
    if (!allTenants.length) return 0
    const result = matchTenantsToClients(allTenants, clients)
    return result.newCount + result.suggestCount
  }, [allTenants, clients])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients.filter((c) => {
      if (stageFilter !== 'all' && c.stage !== stageFilter) return false
      if (!q) return true
      const blob =
        asText(c.name).toLowerCase() +
        ' ' +
        asText(c.company).toLowerCase() +
        ' ' +
        asText(c.email).toLowerCase() +
        ' ' +
        asText(c.responsavel).toLowerCase()
      return blob.includes(q)
    })
  }, [clients, search, stageFilter])

  const stageCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: clients.length }
    for (const c of clients)
      counts[c.stage] = (counts[c.stage] ?? 0) + 1
    return counts
  }, [clients])

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

  return (
    <>
      <TopBar
        title="Clientes"
        subtitle={`${clients.length} cliente(s) no CRM`}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setImportOpen(true)}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Importar tenants
            </Button>
            <Button
              onClick={() => setOpenNew(true)}
              leftIcon={<PlusCircle className="h-4 w-4" />}
            >
              Novo cliente
            </Button>
          </div>
        }
      />

      <div className="px-8 py-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input
            placeholder="Buscar por nome, empresa, e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <StageChip
              active={stageFilter === 'all'}
              onClick={() => setStageFilter('all')}
              label={`Todos · ${stageCounts.all ?? 0}`}
            />
            {PIPELINE_STAGES.map((s) => (
              <StagePillFilter
                key={s}
                stage={s}
                active={stageFilter === s}
                count={stageCounts[s] ?? 0}
                onClick={() => setStageFilter(s)}
              />
            ))}
          </div>
        </div>

        {unlinkedCount > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <ServerIcon className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {unlinkedCount} tenant{unlinkedCount !== 1 ? 's' : ''} no servidor sem vínculo no CRM
                </p>
                <p className="text-xs text-foreground/55">
                  Importe como clientes na etapa "Ativo" para acompanhar financeiro e histórico.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setImportOpen(true)}
              leftIcon={<Download className="h-3.5 w-3.5" />}
            >
              Importar
            </Button>
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={<UserIcon className="h-5 w-5" />}
            title={
              clients.length === 0
                ? 'Nenhum cliente ainda'
                : 'Nada encontrado'
            }
            description={
              clients.length === 0
                ? 'Crie seu primeiro cliente para começar o onboarding.'
                : 'Tente outra busca ou limpe os filtros.'
            }
            action={
              clients.length === 0 ? (
                <Button
                  onClick={() => setOpenNew(true)}
                  leftIcon={<PlusCircle className="h-4 w-4" />}
                >
                  Criar cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Nome</TH>
                <TH>Empresa</TH>
                <TH>Etapa</TH>
                <TH>Dias no sistema</TH>
                <TH>Próxima ação</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((c) => {
                const days = daysSince(c.createdAt)
                return (
                  <TR key={c.id}>
                    <TD>
                      <div className="flex items-center gap-3">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-elevate/[0.04] text-[11px] font-medium text-foreground/80 ring-1 ring-line">
                          {initials(c.name) || (
                            <UserCircle2 className="h-4 w-4" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {asText(c.name, '—')}
                          </div>
                          <div className="text-[11px] text-foreground/40">
                            {asText(c.email)}
                          </div>
                        </div>
                      </div>
                    </TD>
                    <TD>
                      <div className="text-foreground/85">{asText(c.company)}</div>
                      {seeFinancials && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {c.monthlyValue ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success ring-1 ring-success/20">
                              R$ {c.monthlyValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              <span className="font-normal text-success/60">/mês</span>
                            </span>
                          ) : null}
                          {c.asaasCustomerId ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent ring-1 ring-accent/20">
                              <CreditCard className="h-2.5 w-2.5" />
                              Asaas
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-elevate/[0.04] px-1.5 py-0.5 text-[11px] text-foreground/35 ring-1 ring-elevate/10">
                              <CreditCard className="h-2.5 w-2.5" />
                              Sem Asaas
                            </span>
                          )}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <StageBadge stage={c.stage} />
                    </TD>
                    <TD className="text-foreground/60">{days} dia(s)</TD>
                    <TD className="text-foreground/60">
                      {summarizeNextAction(c)}
                    </TD>
                    <TD className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpenClientId(c.id)}
                      >
                        Abrir
                      </Button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>

      <Modal
        open={openNew}
        onClose={() => {
          setOpenNew(false)
          reset()
        }}
        title="Novo cliente"
        description="Crie o cliente — começa na etapa 'Boas-vindas'. Você pode avançar pela pipeline depois."
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setOpenNew(false)
                reset()
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!isValid}>
              Criar cliente
            </Button>
          </div>
        </form>
      </Modal>

      <TenantImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tenants={allTenants}
      />

      <ClientDrawer
        clientId={openClientId}
        onClose={() => setOpenClientId(null)}
      />
    </>
  )
}

function StageChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-elevate/[0.08] text-foreground ring-1 ring-line'
          : 'text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function StagePillFilter({
  stage,
  active,
  count,
  onClick,
}: {
  stage: PipelineStage
  active: boolean
  count: number
  onClick: () => void
}) {
  const style = STAGE_COLORS[stage]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all',
      )}
      style={
        active
          ? {
              background: style.bg,
              color: style.text,
              boxShadow: `inset 0 0 0 1px ${style.ring}`,
            }
          : { color: 'rgba(255,255,255,0.55)' }
      }
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: style.dot }}
      />
      {style.label} · {count}
    </button>
  )
}

function summarizeNextAction(
  c: ReturnType<typeof useClients>[number],
): string {
  switch (c.stage) {
    case 'welcome':
      return 'Enviar contrato'
    case 'contract':
      return c.contractSentAt
        ? 'Aguardar assinatura'
        : 'Enviar link do contrato'
    case 'briefing':
      if (c.briefingStatus === 'not_sent' || !c.briefingStatus)
        return 'Gerar link de briefing'
      if (c.briefingStatus === 'sent') return 'Aguardar preenchimento'
      if (c.briefingStatus === 'filled') return 'Revisar briefing'
      if (c.briefingStatus === 'revision') return 'Pedido de revisão'
      if (c.briefingStatus === 'approved') return 'Iniciar configuração'
      return 'Briefing'
    case 'setup':
      return 'Concluir configuração'
    case 'delivery':
      return 'Finalizar checklist e entregar'
    case 'active': {
      const next = c.followUps.find((f) => !f.sentAt)
      if (next) return `Follow-up dia ${next.dayNumber} · ${timeAgo(next.scheduledFor)}`
      return 'Sem follow-ups pendentes'
    }
    case 'churned':
      return 'Cliente cancelado'
    default:
      return '—'
  }
}
