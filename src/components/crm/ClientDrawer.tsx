import * as React from 'react'
import {
  Activity,
  Bot,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { accessClientSystem } from '@/lib/accessSystem'
import { Drawer } from '@/components/ui/Drawer'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { StageBadge } from './StageBadge'
import { OverviewTab } from './tabs/OverviewTab'
import { BriefingTab } from './tabs/BriefingTab'
import { ChatbotTab } from './tabs/ChatbotTab'
import { DeliveryTab } from './tabs/DeliveryTab'
import { FollowUpTab } from './tabs/FollowUpTab'
import { FichaTab } from './tabs/FichaTab'
import { CrmLeadTab } from './tabs/CrmLeadTab'
import { useClient, useCurrentUser } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { canDeleteClient } from '@/services/supabase'
import { db } from '@/services/db'
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
  { value: 'briefing', label: 'Briefing', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { value: 'chatbot', label: 'Chatbot', icon: <Bot className="h-3.5 w-3.5" /> },
  { value: 'delivery', label: 'Entrega', icon: <ListChecks className="h-3.5 w-3.5" /> },
  { value: 'followup', label: 'Follow-up', icon: <Send className="h-3.5 w-3.5" /> },
  { value: 'ficha', label: 'Ficha de cadastro', icon: <ClipboardList className="h-3.5 w-3.5" /> },
]

const CRM_LEAD_TAB_DEF: TabDef = { value: 'crmLead', label: 'Lead do CRM', icon: <Link2 className="h-3.5 w-3.5" /> }

export interface ClientDrawerProps {
  clientId: string | null
  onClose: () => void
  /** Ação extra no cabeçalho, ao lado de "Avançar etapa"/"Acessar sistema" — ex.: "Criar
   * contrato" quando o drawer é aberto a partir da tela de Contrato. */
  extraHeaderAction?: React.ReactNode
  /** Aba extra "Lead do CRM" (ver CrmLeadTab) — só no Pipeline do Suporte, de propósito: é onde o
   * atendimento precisa entender o histórico do SDR com o cliente; em outras telas (Clientes,
   * Contrato) esse mesmo vínculo já aparece de outro jeito, então fica de fora pra não duplicar. */
  showCrmLeadTab?: boolean
}

export function ClientDrawer({ clientId, onClose, extraHeaderAction, showCrmLeadTab }: ClientDrawerProps) {
  const tabDefs = showCrmLeadTab ? [...TAB_DEFS, CRM_LEAD_TAB_DEF] : TAB_DEFS
  const client = useClient(clientId ?? undefined)
  // Carrega os campos pesados (ex.: contract_file) que a listagem em massa
  // omite pra aliviar o boot.
  React.useEffect(() => {
    if (clientId) void db.loadFullClient(clientId)
  }, [clientId])
  const [tab, setTab] = React.useState('overview')
  const [stageMenu, setStageMenu] = React.useState(false)
  const stageMenuRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(stageMenuRef, stageMenu, () => setStageMenu(false))
  const [confirmArchive, setConfirmArchive] = React.useState(false)
  const [user] = useCurrentUser()
  const { profile } = useAuth()
  const canDelete = canDeleteClient(profile?.role)

  // "Acessar sistema": abre o login e já copia o e-mail de suporte (evita ter
  // que voltar aqui só para copiá-lo antes de logar). A lógica vive em
  // lib/accessSystem pra ser reaproveitada em outras telas (ex.: Kanban do
  // Suporte).
  const accessSystem = () => accessClientSystem(client)

  React.useEffect(() => {
    setTab('overview')
    setStageMenu(false)
    setConfirmArchive(false)
  }, [clientId])

  if (!clientId || !client) {
    return (
      <Drawer open={Boolean(clientId)} onClose={onClose} title="Cliente">
        <div className="grid h-full place-items-center p-10 text-sm text-foreground/50">
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

  const archive = () => {
    db.archiveClient(client.id)
    toast.success('Cliente arquivado · veja em "Arquivados"')
    setConfirmArchive(false)
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
                <h2 className="truncate text-base font-semibold text-foreground">
                  {asText(client.name, 'Cliente')}
                </h2>
                <p className="truncate text-xs text-foreground/50">
                  {asText(client.company, '—')}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StageBadge stage={client.stage} />
                  {user && (
                    <span className="text-[10px] uppercase tracking-wider text-foreground/40">
                      Operador: {user}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative" ref={stageMenuRef}>
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
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-foreground hover:bg-elevate/[0.05]"
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
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm text-foreground/70 hover:bg-elevate/[0.05] hover:text-foreground"
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
                onClick={accessSystem}
                leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
              >
                Acessar sistema
              </Button>
              {extraHeaderAction}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmArchive(true)}
                  aria-label="Arquivar cliente"
                  title="Arquivar cliente"
                  className="ml-auto rounded-md p-2 text-foreground/40 hover:bg-danger/10 hover:text-danger transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        }
      >
        <Tabs
          value={tab}
          onChange={(v) => {
            setTab(v)
            setStageMenu(false)
          }}
          items={tabDefs.map((t) => ({
            value: t.value,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {t.icon}
                {t.label}
              </span>
            ),
          }))}
        />

        <div className="p-5">
          {tab === 'overview' && <OverviewTab client={client} />}
          {tab === 'briefing' && <BriefingTab client={client} />}
          {tab === 'chatbot' && <ChatbotTab client={client} />}
          {tab === 'delivery' && <DeliveryTab client={client} />}
          {tab === 'followup' && <FollowUpTab client={client} />}
          {tab === 'ficha' && <FichaTab client={client} />}
          {tab === 'crmLead' && showCrmLeadTab && <CrmLeadTab client={client} />}
        </div>
      </Drawer>

      <Modal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title="Arquivar cliente"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={archive}>
              Arquivar
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">
          Confirma arquivar{' '}
          <span className="font-semibold text-foreground">
            {asText(client.name)}
          </span>
          ? Ele sai do pipeline e da lista de clientes, mas você pode restaurá-lo
          ou excluí-lo permanentemente na tela <strong>Arquivados</strong>.
        </p>
      </Modal>
    </>
  )
}

// Helper for sub-components (keeps Tailwind happy with consistent labels)
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-foreground/40">
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
    <section className={cn('rounded-xl border border-line bg-elevate/[0.02] p-4', className)}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

