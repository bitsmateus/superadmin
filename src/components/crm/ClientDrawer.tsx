import * as React from 'react'
import {
  Activity,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Drawer } from '@/components/ui/Drawer'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StageBadge } from './StageBadge'
import { OverviewTab } from './tabs/OverviewTab'
import { ContractTab } from './tabs/ContractTab'
import { FinanceTab } from './tabs/FinanceTab'
import { BriefingTab } from './tabs/BriefingTab'
import { DeliveryTab } from './tabs/DeliveryTab'
import { FollowUpTab } from './tabs/FollowUpTab'
import { useClient, useCurrentUser } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { canDeleteClient, canSeeFinancials } from '@/services/supabase'
import { db } from '@/services/db'
import { useServerById } from '@/store/authStore'
import { useAccessStore } from '@/store/accessStore'
import { NEXT_STAGE, PIPELINE_STAGES, STAGE_COLORS } from '@/constants/stageColors'
import { asText, cn, initials } from '@/lib/utils'
import type { PipelineStage } from '@/types/client'

interface TabDef {
  value: string
  label: string
  icon: React.ReactNode
}

const TAB_DEFS: TabDef[] = [
  { value: 'overview', label: 'Visão Geral', icon: <Activity className="h-3.5 w-3.5" /> },
  { value: 'contract', label: 'Contrato', icon: <FileText className="h-3.5 w-3.5" /> },
  { value: 'finance', label: 'Financeiro', icon: <Wallet className="h-3.5 w-3.5" /> },
  { value: 'briefing', label: 'Briefing', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { value: 'delivery', label: 'Entrega', icon: <ListChecks className="h-3.5 w-3.5" /> },
  { value: 'followup', label: 'Follow-up', icon: <Send className="h-3.5 w-3.5" /> },
]

export interface ClientDrawerProps {
  clientId: string | null
  onClose: () => void
}

export function ClientDrawer({ clientId, onClose }: ClientDrawerProps) {
  const client = useClient(clientId ?? undefined)
  const [tab, setTab] = React.useState('overview')
  const [stageMenu, setStageMenu] = React.useState(false)
  const [confirmChurn, setConfirmChurn] = React.useState(false)
  const [user] = useCurrentUser()
  const { profile } = useAuth()
  const seeFinancials = canSeeFinancials(profile?.role)
  const canDelete = canDeleteClient(profile?.role)
  const { systemUrl } = useAccessStore()
  const tenantServer = useServerById(client?.tenantServerId)
  const accessUrl = tenantServer?.loginUrl ?? systemUrl

  React.useEffect(() => {
    setTab('overview')
    setStageMenu(false)
    setConfirmChurn(false)
  }, [clientId])

  if (!clientId || !client) {
    return (
      <Drawer open={Boolean(clientId)} onClose={onClose} title="Cliente">
        <div className="grid h-full place-items-center p-10 text-sm text-white/50">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cliente não encontrado
          </span>
        </div>
      </Drawer>
    )
  }

  const advance = (next: PipelineStage) => {
    db.updateClient(client.id, { stage: next })
    db.addLog(
      client.id,
      'Etapa alterada',
      `${STAGE_COLORS[client.stage].label} → ${STAGE_COLORS[next].label}`,
    )
    toast.success(`Etapa: ${STAGE_COLORS[next].label}`)
    setStageMenu(false)
  }

  const churn = () => {
    db.updateClient(client.id, { stage: 'churned' })
    db.addLog(client.id, 'Cliente marcado como cancelado')
    toast.success('Cliente marcado como cancelado')
    setConfirmChurn(false)
    onClose()
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        header={
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1"
                style={{
                  background: STAGE_COLORS[client.stage].bg,
                  color: STAGE_COLORS[client.stage].text,
                  boxShadow: `inset 0 0 0 1px ${STAGE_COLORS[client.stage].ring}`,
                }}
              >
                {initials(client.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-semibold text-white">
                  {asText(client.name, 'Cliente')}
                </h2>
                <p className="truncate text-xs text-white/50">
                  {asText(client.company, '—')}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StageBadge stage={client.stage} />
                  {user && (
                    <span className="text-[10px] uppercase tracking-wider text-white/40">
                      Operador: {user}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setStageMenu((s) => !s)}
                  rightIcon={<ChevronDown className="h-3.5 w-3.5" />}
                >
                  Avançar etapa
                </Button>
                {stageMenu && (
                  <div className="absolute left-0 z-10 mt-1 w-56 rounded-lg border border-line bg-card shadow-xl animate-fade-in">
                    <ul className="py-1">
                      {NEXT_STAGE[client.stage] && (
                        <li>
                          <button
                            type="button"
                            onClick={() => advance(NEXT_STAGE[client.stage]!)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-white hover:bg-white/[0.05]"
                          >
                            Próxima
                            <StageBadge
                              stage={NEXT_STAGE[client.stage]!}
                              size="sm"
                            />
                          </button>
                        </li>
                      )}
                      <li className="my-1 border-t border-line" />
                      {PIPELINE_STAGES.filter((s) => s !== client.stage).map(
                        (s) => (
                          <li key={s}>
                            <button
                              type="button"
                              onClick={() => advance(s)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/[0.05] hover:text-white"
                            >
                              {STAGE_COLORS[s].label}
                              <StageBadge stage={s} size="sm" />
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.open(accessUrl, '_blank', 'noopener,noreferrer')}
                leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
              >
                Acessar sistema
              </Button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmChurn(true)}
                  aria-label="Marcar como cancelado"
                  className="ml-auto rounded-md p-2 text-white/40 hover:bg-danger/10 hover:text-danger transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        }
      >
        {(() => {
          const contractFinalized = Boolean(
            client.contractSignedAt && client.asaasPaymentId,
          )
          const finalizedValues = new Set<string>()
          if (contractFinalized) finalizedValues.add('contract')

          // Suporte não vê Contrato nem Financeiro.
          const visibleDefs = seeFinancials
            ? TAB_DEFS
            : TAB_DEFS.filter((t) => t.value !== 'contract' && t.value !== 'finance')

          const toTabItem = (t: TabDef) => ({
            value: t.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.icon}
                {t.label}
              </span>
            ),
          })

          const activeItems = visibleDefs
            .filter((t) => !finalizedValues.has(t.value))
            .map(toTabItem)
          const rightItems = visibleDefs
            .filter((t) => finalizedValues.has(t.value))
            .map(toTabItem)

          return (
            <Tabs
              value={tab}
              onChange={(v) => {
                setTab(v)
                setStageMenu(false)
              }}
              items={activeItems}
              rightItems={rightItems}
            />
          )
        })()}

        <div className="p-5">
          {tab === 'overview' && <OverviewTab client={client} />}
          {tab === 'contract' && seeFinancials && (
            <ContractTab client={client} />
          )}
          {tab === 'finance' && seeFinancials && (
            <FinanceTab client={client} />
          )}
          {tab === 'briefing' && <BriefingTab client={client} />}
          {tab === 'delivery' && <DeliveryTab client={client} />}
          {tab === 'followup' && <FollowUpTab client={client} />}
        </div>
      </Drawer>

      <Modal
        open={confirmChurn}
        onClose={() => setConfirmChurn(false)}
        title="Marcar como cancelado"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmChurn(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={churn}>
              Marcar como cancelado
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/70">
          Confirma marcar{' '}
          <span className="font-semibold text-white">
            {asText(client.name)}
          </span>{' '}
          como cancelado? Ele sai do pipeline ativo (vai para "churned").
        </p>
      </Modal>
    </>
  )
}

// Helper for sub-components (keeps Tailwind happy with consistent labels)
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-white/40">
      {children}
    </div>
  )
}

export function Section({
  title,
  children,
  action,
  className,
}: {
  title?: React.ReactNode
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-line bg-white/[0.02] p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-sm font-medium text-white">{title}</h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

