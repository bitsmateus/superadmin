import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  PartyPopper,
  Server as ServerIcon,
  Settings2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { CreateTenantModal } from '@/components/crm/CreateTenantModal'
import { ChatbotTab } from '@/components/crm/tabs/ChatbotTab'
import { N8nAiSection } from '@/components/crm/tabs/N8nAiSection'
import { AutomationView, BriefingTab } from '@/components/crm/tabs/BriefingTab'
import { Modal } from '@/components/ui/Modal'
import { useCurrentUser } from '@/hooks/useClients'
import {
  completeClientDelivery,
  finalizeClient,
  markSetupItemDone,
  saveDeliveryDate,
  toggleSetupItem,
} from '@/lib/setupActions'
import { SETUP_STEP_ORDER, computeSetup, type SetupItem, type SetupStep, type SetupStepKey } from '@/lib/setupSteps'
import { cn, formatDate } from '@/lib/utils'
import type { Client } from '@/types/client'

interface SetupPanelProps {
  client: Client
  /** Abre outra aba do cliente (só existe dentro do drawer). */
  onGoTo?: (tab: string) => void
  /** Mostra o checklist completo + vincular tenant (aba do cliente). Fica de fora no pop-up do quadro. */
  showAdvanced?: boolean
}

function briefingLink(token?: string): string | null {
  if (!token) return null
  return `${window.location.origin}/briefing/${token}`
}

export function SetupPanel({ client, onGoTo, showAdvanced }: SetupPanelProps) {
  const [user] = useCurrentUser()
  const state = React.useMemo(() => computeSetup(client), [client])
  const [open, setOpen] = React.useState<SetupStepKey | null>(state.current)
  const [tenantModal, setTenantModal] = React.useState(false)
  const [flowOpen, setFlowOpen] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  // "Abrir Briefing": a tela do briefing em pop-up, sem sair da aba.
  const [briefingModal, setBriefingModal] = React.useState(false)
  const [date, setDate] = React.useState(client.deliveryDate ?? '')

  // Ao concluir uma etapa, a próxima abre sozinha.
  const prevCurrent = React.useRef(state.current)
  React.useEffect(() => {
    if (prevCurrent.current !== state.current) {
      setOpen(state.current)
      prevCurrent.current = state.current
    }
  }, [state.current])
  React.useEffect(() => setDate(client.deliveryDate ?? ''), [client.id, client.deliveryDate])

  const toggle = (item: SetupItem) => {
    if (!item.checked && !user) {
      toast.error('Defina seu nome em Configurações antes de marcar itens.')
      return
    }
    const { advanced } = toggleSetupItem(client, item.id, item.label, user)
    if (advanced) toast.success('Configuração completa → Pronto para Entrega')
  }

  const cfgTypes = client.briefingConfig?.automationTypes ?? null
  const hasChatbot = !cfgTypes || cfgTypes.includes('chatbot')
  const hasIa = !cfgTypes || cfgTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')
  const flowGenerated = () => markSetupItemDone(client, 'flow_generated', 'Chatbot/IA gerado')

  const link = briefingLink(client.briefingToken)
  const copyLink = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link do briefing copiado')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const delivered = state.steps.find((s) => s.key === 'delivery')?.items.find((i) => i.id === 'delivery_done')?.checked

  const extras: Record<SetupStepKey, React.ReactNode> = {
    briefing: (
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {(client.briefingStatus === 'sent' || client.briefingStatus === 'revision') && (
          <div className="flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning/[0.07] px-3 py-2 text-xs text-foreground/80">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
            {client.briefingStatus === 'revision'
              ? 'Revisão solicitada — aguardando o cliente ajustar e reenviar o briefing.'
              : `Aguardando o cliente preencher o briefing${client.briefingSentAt ? ` (enviado em ${formatDate(client.briefingSentAt)})` : ''}. Esta etapa só conclui quando ele preencher.`}
          </div>
        )}
        {client.briefingStatus && client.briefingStatus !== 'not_sent' ? (
          <>
            {link && (
              <Button size="sm" variant="secondary" onClick={copyLink} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                Copiar link do briefing
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setBriefingModal(true)}>
              Abrir Briefing
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-foreground/55">Configure e envie o briefing pela aba Briefing do cliente.</p>
            <Button size="sm" onClick={() => setBriefingModal(true)}>
              Abrir Briefing
            </Button>
          </>
        )}
      </div>
    ),
    tenant: (
      <div className="pt-1">
        <Button
          size="sm"
          variant={client.tenantId ? 'secondary' : 'primary'}
          onClick={() => setTenantModal(true)}
          leftIcon={<ServerIcon className="h-3.5 w-3.5" />}
        >
          {client.tenantId ? 'Recriar tenant' : 'Criar tenant'}
        </Button>
        <p className="mt-1.5 text-[11px] text-foreground/45">
          Cria a empresa no sistema (tenant) e já cria usuários, canais e filas do briefing.
        </p>
      </div>
    ),
    config: (
      <div className="space-y-2 pt-1">
        <Button
          size="sm"
          variant={flowOpen ? 'secondary' : 'primary'}
          onClick={() => setFlowOpen((o) => !o)}
          leftIcon={<Sparkles className="h-3.5 w-3.5" />}
        >
          {flowOpen ? 'Fechar gerador' : 'Gerar chatbot / IA'}
        </Button>
        {flowOpen && (
          <div className="rounded-lg border border-line p-3">
            {hasChatbot ? (
              <ChatbotTab client={client} onGenerated={flowGenerated} />
            ) : hasIa ? (
              <N8nAiSection client={client} onGenerated={flowGenerated} />
            ) : null}
          </div>
        )}
      </div>
    ),
    test: (
      <p className="pt-1 text-xs text-foreground/55">
        Converse com o número de suporte para testar o chatbot/IA antes de entregar.
      </p>
    ),
    delivery: (
      <div className="space-y-2 pt-1">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Input
              label="Data e hora da entrega"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!date || date === (client.deliveryDate ?? '')}
            onClick={() => {
              saveDeliveryDate(client, date, user)
              toast.success('Data da entrega salva')
            }}
            leftIcon={<CalendarCheck className="h-3.5 w-3.5" />}
          >
            Salvar data
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!client.deliveryDate || Boolean(delivered)}
            onClick={() => {
              completeClientDelivery(client)
              toast.success('Entrega concluída · em Entregas Recentes')
            }}
            leftIcon={<PartyPopper className="h-3.5 w-3.5" />}
          >
            Marcar entrega realizada
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!delivered || client.stage === 'active'}
            onClick={() => {
              finalizeClient(client)
              toast.success('Cliente 100% finalizado · Ativo')
            }}
            leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Marcar 100% finalizado
          </Button>
        </div>
        {client.deliveryDate && (
          <p className="text-[11px] text-foreground/45">Entrega marcada para {formatDate(client.deliveryDate)}.</p>
        )}
      </div>
    ),
  }

  return (
    <div className="space-y-3">
      {/* Etapas + progresso */}
      <div className="rounded-xl border border-line bg-elevate/[0.02] p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-foreground/60">
          <span>{state.current ? `Etapa atual: ${state.steps.find((s) => s.key === state.current)?.label}` : 'Tudo concluído'}</span>
          <span>{state.percent}%</span>
        </div>
        <div className="flex items-center gap-1">
          {SETUP_STEP_ORDER.map((k) => {
            const s = state.steps.find((x) => x.key === k)!
            return (
              <button
                key={k}
                type="button"
                onClick={() => setOpen(k)}
                className={cn(
                  'flex-1 rounded-md px-1 py-1 text-center text-[10px] font-medium transition-colors',
                  s.done
                    ? 'bg-success/15 text-success'
                    : k === state.current
                      ? 'bg-accent/15 text-accent'
                      : 'bg-elevate/[0.05] text-foreground/45',
                )}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {state.steps.map((s) => (
        <StepBlock
          key={s.key}
          step={s}
          current={s.key === state.current}
          open={open === s.key}
          onToggleOpen={() => setOpen((o) => (o === s.key ? null : s.key))}
          onToggleItem={toggle}
        >
          {extras[s.key]}
        </StepBlock>
      ))}

      {showAdvanced && (
        <div className="rounded-xl border border-line">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-foreground/70"
          >
            {advancedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Settings2 className="h-3.5 w-3.5" />
            Avançado — checklist completo, vincular tenant existente
          </button>
          {advancedOpen && (
            <div className="border-t border-line p-3">
              <AutomationView client={client} />
            </div>
          )}
        </div>
      )}

      <Modal open={briefingModal} onClose={() => setBriefingModal(false)} title={`Briefing — ${client.company || client.name}`} size="2xl">
        <BriefingTab client={client} />
      </Modal>

      <CreateTenantModal client={client} open={tenantModal} onClose={() => setTenantModal(false)} />
    </div>
  )
}

function StepBlock({
  step,
  current,
  open,
  onToggleOpen,
  onToggleItem,
  children,
}: {
  step: SetupStep
  current: boolean
  open: boolean
  onToggleOpen: () => void
  onToggleItem: (i: SetupItem) => void
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-xl border',
        step.done ? 'border-success/25' : current ? 'border-accent/40' : 'border-line',
      )}
    >
      <button type="button" onClick={onToggleOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {step.done ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : (
          <Circle className={cn('h-4 w-4 shrink-0', current ? 'text-accent' : 'text-foreground/30')} />
        )}
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {step.key === 'config' && <Bot className="h-3.5 w-3.5 text-foreground/40" />}
          {step.label}
        </span>
        <span className="ml-auto text-[11px] text-foreground/45">
          {step.done ? 'concluída' : `${step.doneCount}/${step.items.length}`}
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-foreground/40" /> : <ChevronRight className="h-3.5 w-3.5 text-foreground/40" />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-line/70 px-3 py-2.5">
          {step.items.map((it) => (
            <label
              key={it.id}
              className={cn('flex items-center gap-2.5 text-sm', it.manual ? 'cursor-pointer' : 'cursor-default')}
            >
              {it.manual ? (
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => onToggleItem(it)}
                  className="h-4 w-4 shrink-0 accent-[#4F8EF7]"
                />
              ) : it.checked ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-foreground/30" />
              )}
              <span className={cn(it.checked ? 'text-foreground/50 line-through' : 'text-foreground/90')}>{it.label}</span>
              {it.checked && it.manual && it.checkedBy && (
                <span className="ml-auto text-[10px] text-foreground/35">
                  {it.checkedBy}
                  {it.checkedAt ? ` · ${formatDate(it.checkedAt)}` : ''}
                </span>
              )}
            </label>
          ))}
          {children}
        </div>
      )}
    </div>
  )
}
