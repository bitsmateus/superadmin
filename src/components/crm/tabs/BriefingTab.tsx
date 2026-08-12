import * as React from 'react'
import {
  AlertCircle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Link2,
  ListChecks,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Wand2,
  X,
  Server as ServerIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { CreateTenantModal } from '../CreateTenantModal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { usersApi } from '@/api/users'
import { queuesApi } from '@/api/queues'
import { tenantsApi } from '@/api/tenants'
import { extractErrorMessage } from '@/api/client'
import { copyToClipboard } from '@/lib/clipboard'
import { getServerById, useAuthStore } from '@/store/authStore'
import type { Tenant } from '@/types'
import {
  checklistProgress,
  enrichChecklistFromBriefing,
  setChecklistItem,
  toggleChecklistItem,
} from '@/constants/checklist'
import { computeReadiness } from '@/constants/readiness'
import {
  SESSION_PHASE_LABELS,
  buildPreSessionSteps,
  buildSessionChecklist,
  buildSessionInvite,
  buildSessionSteps,
  type SessionPhase,
} from '@/constants/sessionScript'
import { asText, cn, formatDate, normalizeWhatsappNumber } from '@/lib/utils'
import type {
  Client,
  BriefingStatus,
  BriefingConfig,
  ConnectionType,
  AutomationType,
  BriefingChannel,
  ChecklistItem,
  BriefingUser,
  BriefingUserRole,
  BriefingScheduleSlot,
  AiTone,
} from '@/types/client'

type SubView = 'briefing' | 'automation' | 'sessao'

const emptyConfig: BriefingConfig = {
  connectionTypes: [],
  automationTypes: [],
  channels: [],
  maxUsers: 0,
  hasExternalAutomation: false,
}

const CONNECTION_OPTIONS: { value: ConnectionType; label: string }[] = [
  { value: 'api_oficial', label: 'API Oficial' },
  { value: 'api_comum', label: 'API Comum' },
]

const AUTOMATION_OPTIONS: { value: AutomationType; label: string }[] = [
  { value: 'chatbot', label: 'Chatbot' },
  { value: 'ia_basica', label: 'IA Básica' },
  { value: 'ia_avancada', label: 'IA Avançada' },
]

const CHANNEL_OPTIONS: { value: BriefingChannel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
  { value: 'wavoip', label: 'WaVoip' },
  { value: 'olx', label: 'OLX' },
  { value: 'mercadolivre', label: 'Mercado Livre' },
  { value: 'email', label: 'E-mail' },
]

export function BriefingTab({ client }: { client: Client }) {
  const status: BriefingStatus = client.briefingStatus ?? 'not_sent'
  const link = buildBriefingLink(client.briefingToken)
  const [revisionOpen, setRevisionOpen] = React.useState(false)
  const [revisionNote, setRevisionNote] = React.useState(
    client.briefingRevisionNote ?? '',
  )
  const [subView, setSubView] = React.useState<SubView>('briefing')
  const [config, setConfig] = React.useState<BriefingConfig>(
    client.briefingConfig ?? emptyConfig,
  )
  const [signOpen, setSignOpen] = React.useState(false)
  const [signNumber, setSignNumber] = React.useState(client.briefingNumber ?? '')
  const [editing, setEditing] = React.useState(false)

  // Fluxo da ficha: enquanto não houver contrato assinado, o briefing fica
  // bloqueado e mostramos o passo "marcar contrato assinado".
  const needsContractSign = Boolean(client.fichaCadastro) && !client.contractSignedAt

  const markSigned = () => {
    const num = signNumber.replace(/\D/g, '')
    if (num.length < 10) {
      toast.error('Informe o WhatsApp do cliente com DDD')
      return
    }
    const normalized = num.startsWith('55') ? num : `55${num}`
    db.updateClient(client.id, {
      contractSignedAt: new Date().toISOString(),
      briefingNumber: normalized,
      stage: client.stage === 'welcome' || client.stage === 'lead' ? 'contract' : client.stage,
    })
    db.addLog(client.id, 'Contrato assinado', `WhatsApp do cliente: ${normalized}`)
    setSignOpen(false)
    toast.success('Contrato assinado · preencha a configuração do briefing abaixo')
  }

  React.useEffect(() => {
    setConfig(client.briefingConfig ?? emptyConfig)
    setRevisionNote(client.briefingRevisionNote ?? '')
    setEditing(false)
  }, [client.id])

  const updateConfig = (patch: Partial<BriefingConfig>) => {
    const next = { ...config, ...patch }
    setConfig(next)
    db.updateClient(client.id, {
      briefingConfig: next,
      hasApiOficial: next.connectionTypes.includes('api_oficial'),
      hasIa: next.automationTypes.some((t) => t !== 'chatbot'),
      hasAutomacaoExterna: next.hasExternalAutomation,
    })
  }

  const toggleMulti = <T extends string>(
    arr: T[],
    val: T,
    setter: (v: T[]) => void,
  ) => {
    setter(arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val])
  }

  // Automação (chatbot/IA) é opcional — o briefing pode ser gerado sem ela.
  const configComplete =
    config.connectionTypes.length > 0 &&
    config.channels.length > 0 &&
    config.maxUsers > 0

  const generate = async () => {
    if (!configComplete) {
      toast.error('Preencha a configuração antes de gerar o briefing')
      return
    }
    const token = db.createBriefingToken(client.id)
    const PRE_BRIEFING_STAGES = ['lead', 'welcome', 'contract']
    db.updateClient(client.id, {
      briefingToken: token,
      briefingStatus: 'sent',
      briefingSentAt: new Date().toISOString(),
      ...(PRE_BRIEFING_STAGES.includes(client.stage) ? { stage: 'briefing' } : {}),
    })
    db.addLog(client.id, 'Briefing enviado', 'Link gerado e etapa avançada para Briefing')

    // Envia o link por WhatsApp para o número pessoal do cliente (se houver).
    const newLink = buildBriefingLink(token)
    if (client.briefingNumber && newLink) {
      try {
        await api.post('/api/whatsapp/send', {
          number: client.briefingNumber,
          text: buildWhatsAppMessage(client.name || 'cliente', newLink),
        })
        db.addLog(client.id, 'Briefing enviado no WhatsApp', client.briefingNumber)
        toast.success('Briefing enviado no WhatsApp do cliente')
      } catch (err) {
        toast.error('Link gerado, mas falhou o envio no WhatsApp: ' + extractErrorMessage(err, 'erro'))
      }
    } else {
      toast.success('Link do briefing gerado · envie pelo link/mensagem abaixo')
    }
  }

  const copy = async () => {
    if (!link) return
    const ok = await copyToClipboard(link)
    if (ok) toast.success('Link copiado')
    else toast.error('Não foi possível copiar')
  }

  const copyMessage = async () => {
    if (!link) return
    const msg = buildWhatsAppMessage(client.name || 'cliente', link)
    const ok = await copyToClipboard(msg)
    if (ok) toast.success('Mensagem copiada')
    else toast.error('Não foi possível copiar')
  }

  const approve = () => {
    db.updateClient(client.id, {
      briefingStatus: 'approved',
      briefingApprovedAt: new Date().toISOString(),
      stage: client.stage === 'briefing' ? 'setup_start' : client.stage,
    })
    db.addLog(client.id, 'Briefing aprovado')
    toast.success('Briefing aprovado · etapa avançada para Configuração')
  }

  const requestRevision = () => {
    const note = revisionNote.trim()
    if (!note) {
      toast.error('Descreva o que precisa ser ajustado')
      return
    }
    db.updateClient(client.id, {
      briefingStatus: 'revision',
      briefingRevisionNote: note,
    })
    db.addLog(client.id, 'Revisão de briefing solicitada', note)
    setRevisionOpen(false)
    toast.success('Revisão solicitada')
  }

  const hasData = Boolean(client.briefingData)
  const showSubTabs = hasData && (status === 'filled' || status === 'approved')

  return (
    <div className="space-y-5">
      {needsContractSign && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-accent" />
              Contrato
            </span>
          }
          action={<Badge tone="warning">Aguardando assinatura</Badge>}
        >
          <p className="text-sm text-foreground/65">
            Pegue os dados na aba <strong>Ficha de cadastro</strong>, monte o contrato e
            envie ao cliente. Assim que ele assinar, marque aqui para liberar o briefing.
          </p>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => setSignOpen(true)} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
              Marcar contrato assinado
            </Button>
          </div>
        </Section>
      )}

      {!needsContractSign && (
      <>
      {/* ── Configuração do briefing ── */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
            Configuração do briefing
          </span>
        }
        action={
          configComplete ? (
            <Badge tone="success">Completo</Badge>
          ) : (
            <Badge tone="neutral">Incompleto</Badge>
          )
        }
      >
        <div className="space-y-4">
          <ConfigGroup label="Forma de Conexão *">
            {CONNECTION_OPTIONS.map((opt) => (
              <ChipBtn
                key={opt.value}
                active={config.connectionTypes.includes(opt.value)}
                onClick={() =>
                  toggleMulti(config.connectionTypes, opt.value, (v) =>
                    updateConfig({ connectionTypes: v as ConnectionType[] }),
                  )
                }
              >
                {opt.label}
              </ChipBtn>
            ))}
          </ConfigGroup>

          <ConfigGroup label="Automação (opcional)">
            {AUTOMATION_OPTIONS.map((opt) => (
              <ChipBtn
                key={opt.value}
                active={config.automationTypes.includes(opt.value)}
                onClick={() =>
                  toggleMulti(config.automationTypes, opt.value, (v) =>
                    updateConfig({ automationTypes: v as AutomationType[] }),
                  )
                }
              >
                {opt.label}
              </ChipBtn>
            ))}
          </ConfigGroup>

          <ConfigGroup label="Canais *">
            {CHANNEL_OPTIONS.map((opt) => (
              <ChipBtn
                key={opt.value}
                active={config.channels.includes(opt.value)}
                onClick={() =>
                  toggleMulti(config.channels, opt.value, (v) =>
                    updateConfig({ channels: v as BriefingChannel[] }),
                  )
                }
              >
                {opt.label}
              </ChipBtn>
            ))}
          </ConfigGroup>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-foreground/40 mb-1.5">
              Máx. de usuários *
            </div>
            <input
              type="number"
              min="1"
              max="999"
              value={config.maxUsers || ''}
              onChange={(e) =>
                updateConfig({ maxUsers: Math.max(0, parseInt(e.target.value) || 0) })
              }
              placeholder="Ex.: 5"
              className="w-28 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={config.hasExternalAutomation}
                onChange={(e) =>
                  updateConfig({ hasExternalAutomation: e.target.checked })
                }
                className="h-4 w-4 accent-[#4F8EF7]"
              />
              Automação externa
            </label>
            {config.hasExternalAutomation && (
              <textarea
                value={config.externalAutomationNotes ?? ''}
                onChange={(e) =>
                  updateConfig({ externalAutomationNotes: e.target.value })
                }
                onBlur={() =>
                  db.updateClient(client.id, { briefingConfig: config })
                }
                placeholder="O que precisamos do cliente para a automação externa?"
                rows={3}
                className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
              />
            )}
          </div>
        </div>
      </Section>

      {/* ── Gerar link (quando ainda não enviado) ── */}
      {status === 'not_sent' && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-accent" />
              Briefing
            </span>
          }
          action={<Badge tone="neutral">Não enviado</Badge>}
        >
          {!configComplete && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Preencha a configuração acima (marcada com *) antes de gerar o briefing.
            </div>
          )}
          <p className="text-sm text-foreground/65">
            Gere um link único para o cliente preencher o briefing de onboarding.
          </p>
          <div className="mt-3 flex justify-end">
            <Button
              onClick={generate}
              disabled={!configComplete}
              leftIcon={<Send className="h-3.5 w-3.5" />}
            >
              Gerar link do briefing
            </Button>
          </div>
        </Section>
      )}

      {/* ── Link gerado ── */}
      {link && status !== 'not_sent' && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-accent" />
              Link do briefing
            </span>
          }
          action={<BriefingStatusBadge status={status} />}
        >
          <p className="text-xs text-foreground/55">
            Enviado em {formatDate(client.briefingSentAt)}.
          </p>
          <div className="mt-3 flex items-stretch gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-foreground/85"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              size="md"
              variant="secondary"
              onClick={copy}
              leftIcon={<Copy className="h-4 w-4" />}
            >
              Copiar link
            </Button>
          </div>
          <div className="mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={copyMessage}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
            >
              Copiar mensagem para cliente
            </Button>
          </div>
          {status === 'revision' && client.briefingRevisionNote && (
            <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              Revisão solicitada: {client.briefingRevisionNote}
            </div>
          )}
        </Section>
      )}

      {status === 'filled' && hasData && (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Briefing preenchido! Revise e aprove para avançar.</span>
        </div>
      )}

      {status === 'approved' && hasData && (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Aprovado em {formatDate(client.briefingApprovedAt)} — pronto para
            configurar.
          </span>
        </div>
      )}

      {showSubTabs && (
        <>
          <SubTabs value={subView} onChange={setSubView} />

          {subView === 'briefing' && client.briefingData && (
            editing ? (
              <BriefingEditor
                data={client.briefingData}
                onCancel={() => setEditing(false)}
                onSave={(next) => {
                  db.updateClient(client.id, { briefingData: next })
                  db.addLog(client.id, 'Briefing editado manualmente')
                  setEditing(false)
                  toast.success('Briefing atualizado')
                }}
              />
            ) : (
              <>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing(true)}
                    leftIcon={<PenLine className="h-3.5 w-3.5" />}
                  >
                    Editar informações
                  </Button>
                </div>
                <BriefingViewer
                  data={client.briefingData}
                  config={client.briefingConfig ?? null}
                />
                {status === 'filled' && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setRevisionOpen(true)}
                      leftIcon={<PenLine className="h-3.5 w-3.5" />}
                    >
                      Solicitar revisão
                    </Button>
                    <Button
                      onClick={approve}
                      leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    >
                      Aprovar briefing
                    </Button>
                  </div>
                )}
              </>
            )
          )}

          {subView === 'automation' && (
            <AutomationView client={client} />
          )}

          {subView === 'sessao' && <SessionView client={client} />}
        </>
      )}
      </>
      )}

      <Modal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        title="Contrato assinado"
        description="Informe o WhatsApp pessoal do cliente — usaremos para enviar o briefing e as cobranças."
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSignOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={markSigned}>Confirmar</Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-foreground/45">
            WhatsApp do cliente (com DDD)
          </span>
          <input
            value={signNumber}
            onChange={(e) => setSignNumber(e.target.value)}
            placeholder="Ex.: 48 99999-9999"
            className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          <span className="mt-1 block text-[11px] text-foreground/40">
            Enviaremos com 55 + DDD automaticamente.
          </span>
        </label>
      </Modal>

      <Modal
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        title="Solicitar revisão"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevisionOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={requestRevision}>Solicitar revisão</Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">
          Descreva o que precisa ser ajustado. O cliente receberá a nota junto
          com o link do briefing.
        </p>
        <textarea
          value={revisionNote}
          onChange={(e) => setRevisionNote(e.target.value)}
          placeholder="Ex.: O horário de domingo precisa ficar como descanso, sem atendimento."
          className="mt-3 min-h-[100px] w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </Modal>
    </div>
  )
}

// ── Small helpers ────────────────────────────────────────────────────────────

function ConfigGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/40">
        {label}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function ChipBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
        active
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-line bg-surface text-foreground/55 hover:border-accent/30 hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

function buildWhatsAppMessage(name: string, link: string): string {
  return `Olá, ${name}!

Para continuarmos com o seu processo de onboarding, preparamos um briefing onde precisamos que você preencha algumas informações sobre a sua empresa.

👉 Acesse o link abaixo e responda com atenção:
${link}

Essas informações são fundamentais para configurarmos tudo de acordo com as necessidades da sua empresa.

Qualquer dúvida, é só nos chamar! 😊`
}

// ── Status badge ─────────────────────────────────────────────────────────────

function BriefingStatusBadge({ status }: { status: BriefingStatus }) {
  const map: Record<
    BriefingStatus,
    { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' }
  > = {
    not_sent: { label: 'Não enviado', tone: 'neutral' },
    sent: { label: 'Aguardando cliente', tone: 'info' },
    filled: { label: 'Preenchido', tone: 'success' },
    revision: { label: 'Em revisão', tone: 'warning' },
    approved: { label: 'Aprovado', tone: 'success' },
  }
  const v = map[status]
  return <Badge tone={v.tone}>{v.label}</Badge>
}

// ── Sessão de ativação ────────────────────────────────────────────────────────

/** `2026-08-10T14:30:00Z` → `2026-08-10T14:30` (formato do input local). */
function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Roteiro da sessão com o cliente. Separa o que a equipe faz sozinha (antes)
 * do que exige o cliente presente — e coloca a API Oficial antes de chatbot/IA,
 * que é a ordem real de dependência.
 */
function SessionView({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [invite, setInvite] = React.useState('')
  const [sending, setSending] = React.useState(false)

  const cfg = client.briefingConfig ?? null
  const bd = client.briefingData ?? null

  const readiness = React.useMemo(() => computeReadiness(client), [client])

  // Estado do trabalho assíncrono: lido do checklist de entrega já existente.
  const deliveryTree = React.useMemo(
    () => enrichChecklistFromBriefing(client.deliveryChecklist, bd ?? undefined, cfg),
    [client.deliveryChecklist, bd, cfg],
  )
  const doneIds = React.useMemo(() => {
    const set = new Set<string>()
    const walk = (items: ChecklistItem[]) => {
      for (const it of items) {
        if (it.checked) set.add(it.id)
        if (it.children) walk(it.children)
      }
    }
    walk(deliveryTree)
    return set
  }, [deliveryTree])

  const preSteps = React.useMemo(() => buildPreSessionSteps(cfg, bd), [cfg, bd])
  const preDone = preSteps.filter((s) => doneIds.has(s.id)).length

  const sessionSteps = React.useMemo(() => buildSessionSteps(cfg, bd), [cfg, bd])
  const sessionItems = React.useMemo(
    () => buildSessionChecklist(client.sessionChecklist, cfg, bd),
    [client.sessionChecklist, cfg, bd],
  )
  const stepById = React.useMemo(
    () => new Map(sessionSteps.map((s) => [s.id, s])),
    [sessionSteps],
  )
  const sessionDone = sessionItems.filter((i) => i.checked).length

  const toggle = (item: ChecklistItem) => {
    if (!item.checked && !user) {
      toast.error('Defina seu nome em Configurações antes de marcar itens.')
      return
    }
    const next = toggleChecklistItem(sessionItems, item.id, user)
    db.updateClient(client.id, { sessionChecklist: next })
    db.addLog(
      client.id,
      'Roteiro da sessão',
      `${item.label}: ${!item.checked ? 'concluído' : 'desmarcado'}`,
    )
  }

  const saveDate = (v: string) => {
    const iso = v ? new Date(v).toISOString() : undefined
    db.updateClient(client.id, { deliveryDate: iso })
    db.addLog(client.id, iso ? 'Sessão agendada' : 'Agendamento removido', iso ? formatDate(iso) : undefined)
  }

  const openInvite = () => {
    setInvite(buildSessionInvite(client, client.deliveryDate))
    setInviteOpen(true)
  }

  const sendInvite = async () => {
    const number = normalizeWhatsappNumber(client.briefingNumber || client.phone)
    if (!number) {
      toast.error('Cliente sem número de WhatsApp cadastrado.')
      return
    }
    setSending(true)
    try {
      await api.post('/api/whatsapp/send', { number, text: invite })
      db.addLog(client.id, 'Convite da sessão enviado', client.deliveryDate ? formatDate(client.deliveryDate) : undefined)
      toast.success('Convite enviado')
      setInviteOpen(false)
    } catch (err) {
      toast.error('Falha ao enviar: ' + extractErrorMessage(err, 'erro'))
    } finally {
      setSending(false)
    }
  }

  // Agrupa o roteiro pelas fases, preservando a ordem definida no script.
  const phases: SessionPhase[] = []
  for (const s of sessionSteps) {
    if (!phases.includes(s.phase)) phases.push(s.phase)
  }

  return (
    <div className="space-y-4">
      {!readiness.ready && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            O cliente ainda tem {readiness.blockers.length} pendência
            {readiness.blockers.length === 1 ? '' : 's'}. Resolva antes de
            agendar — a sessão trava no meio sem isso.
          </span>
        </div>
      )}

      {/* Agendamento */}
      <Section
        title={
          <span className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-accent" />
            Reunião de ativação
          </span>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-foreground/45">
              Data e hora
            </span>
            <input
              type="datetime-local"
              value={toLocalInput(client.deliveryDate)}
              onChange={(e) => saveDate(e.target.value)}
              className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </label>
          <Button
            variant="secondary"
            onClick={openInvite}
            leftIcon={<Send className="h-3.5 w-3.5" />}
          >
            Enviar pré-requisitos
          </Button>
        </div>
        <p className="mt-2 text-xs text-foreground/45">
          A configuração é feita antes, sem o cliente. Na reunião ficam só as
          conexões, os testes e o treinamento — cerca de 1 hora.
        </p>
      </Section>

      {/* Antes da reunião */}
      <Section
        title="Antes da reunião (sem o cliente)"
        action={
          <span
            className={cn(
              'text-[11px] font-medium',
              preDone === preSteps.length ? 'text-success' : 'text-foreground/45',
            )}
          >
            {preDone}/{preSteps.length}
          </span>
        }
      >
        <ul className="space-y-1.5">
          {preSteps.map((s) => {
            const done = doneIds.has(s.id)
            return (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border',
                    done
                      ? 'border-success bg-success/20 text-success'
                      : 'border-line text-transparent',
                  )}
                >
                  <CheckCircle2 className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  <div className={cn(done ? 'text-foreground/50 line-through' : 'text-foreground/85')}>
                    {s.label}
                  </div>
                  {s.detail && !done && (
                    <div className="text-foreground/45">{s.detail}</div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-[11px] text-foreground/40">
          Marcado automaticamente pelo checklist da aba Automação.
        </p>
      </Section>

      {/* Roteiro da reunião */}
      <Section
        title="Na reunião com o cliente"
        action={
          <span
            className={cn(
              'text-[11px] font-medium',
              sessionDone === sessionItems.length && sessionItems.length > 0
                ? 'text-success'
                : 'text-foreground/45',
            )}
          >
            {sessionDone}/{sessionItems.length}
          </span>
        }
      >
        <div className="space-y-3">
          {phases.map((phase) => (
            <div key={phase}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground/45">
                {SESSION_PHASE_LABELS[phase]}
              </div>
              <div className="space-y-1.5">
                {sessionItems
                  .filter((item) => stepById.get(item.id)?.phase === phase)
                  .map((item) => {
                    const step = stepById.get(item.id)
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-line bg-elevate/[0.02] p-2.5"
                      >
                        <button
                          type="button"
                          onClick={() => toggle(item)}
                          className="flex w-full items-start gap-2 text-left"
                        >
                          <span
                            className={cn(
                              'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border',
                              item.checked
                                ? 'border-success bg-success/20 text-success'
                                : 'border-line text-transparent',
                            )}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block text-xs',
                                item.checked
                                  ? 'text-foreground/50 line-through'
                                  : 'text-foreground/85',
                              )}
                            >
                              {item.label}
                            </span>
                            {step?.detail && (
                              <span className="mt-0.5 block text-[11px] text-foreground/45">
                                {step.detail}
                              </span>
                            )}
                          </span>
                        </button>
                        {step?.say && !item.checked && (
                          <div className="mt-2 flex items-start gap-2 rounded-md border border-accent/20 bg-accent/[0.06] px-2.5 py-2">
                            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
                            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/75">
                              {step.say}
                            </p>
                            <button
                              type="button"
                              title="Copiar"
                              onClick={() => {
                                void copyToClipboard(step.say ?? '').then((ok) =>
                                  ok
                                    ? toast.success('Texto copiado')
                                    : toast.error('Não foi possível copiar'),
                                )
                              }}
                              className="shrink-0 text-foreground/40 hover:text-foreground/70"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Pré-requisitos da sessão"
        description="O cliente recebe o que precisa ter em mãos. Revise antes de enviar."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                void copyToClipboard(invite).then((ok) =>
                  ok ? toast.success('Mensagem copiada') : toast.error('Falhou'),
                )
              }}
            >
              Copiar
            </Button>
            <Button onClick={sendInvite} loading={sending}>
              Enviar no WhatsApp
            </Button>
          </>
        }
      >
        <textarea
          value={invite}
          onChange={(e) => setInvite(e.target.value)}
          rows={14}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
        />
      </Modal>
    </div>
  )
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

function SubTabs({
  value,
  onChange,
}: {
  value: SubView
  onChange: (v: SubView) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Visualização do briefing"
      className="inline-flex items-center rounded-lg border border-line bg-card p-0.5"
    >
      <SubTabBtn
        active={value === 'briefing'}
        onClick={() => onChange('briefing')}
        icon={<Eye className="h-3.5 w-3.5" />}
        label="Briefing"
      />
      <SubTabBtn
        active={value === 'automation'}
        onClick={() => onChange('automation')}
        icon={<Wand2 className="h-3.5 w-3.5" />}
        label="Automação"
      />
      <SubTabBtn
        active={value === 'sessao'}
        onClick={() => onChange('sessao')}
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        label="Sessão"
      />
    </div>
  )
}

function SubTabBtn({
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
          : 'text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Automation view ───────────────────────────────────────────────────────────

function AutomationView({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [tenantModalOpen, setTenantModalOpen] = React.useState(false)
  const [creatingUsers, setCreatingUsers] = React.useState(false)
  const [creatingChannelId, setCreatingChannelId] = React.useState<string | null>(null)

  const allServers = useAuthStore((s) => s.servers)
  const servers = React.useMemo(() => allServers.filter((x) => x.enabled), [allServers])
  const [linkOpen, setLinkOpen] = React.useState(false)
  const [linkServerId, setLinkServerId] = React.useState(
    () => client.tenantServerId ?? '',
  )
  const [tenantList, setTenantList] = React.useState<Tenant[]>([])
  const [tenantListLoading, setTenantListLoading] = React.useState(false)
  const [linkingId, setLinkingId] = React.useState<string | null>(null)
  const [linkApiId, setLinkApiId] = React.useState('')
  const [linkToken, setLinkToken] = React.useState('')
  const [tenantSearch, setTenantSearch] = React.useState('')

  React.useEffect(() => {
    if (!linkServerId && servers.length > 0) {
      setLinkServerId(client.tenantServerId ?? servers[0].id)
    }
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTenants = async () => {
    const sid = linkServerId || servers[0]?.id
    const server = servers.find((s) => s.id === sid)
    if (!server) { toast.error('Selecione um servidor'); return }
    setTenantListLoading(true)
    setTenantList([])
    setLinkingId(null)
    try {
      const list = await tenantsApi.list(server)
      setTenantList(list)
      if (list.length === 0) toast.info('Nenhum tenant encontrado neste servidor')
    } catch (err) {
      toast.error(`Erro ao listar tenants: ${extractErrorMessage(err, 'erro')}`)
    } finally {
      setTenantListLoading(false)
    }
  }

  const doLinkTenant = (tenant: Tenant) => {
    const sid = linkServerId || servers[0]?.id
    const apiId = linkApiId.trim() || String(tenant.apiId ?? tenant.id)
    db.updateClient(client.id, {
      tenantId: String(tenant.id),
      tenantName: tenant.name,
      tenantServerId: sid || undefined,
      tenantApiId: apiId || undefined,
      tenantApiToken: linkToken.trim() || undefined,
      supportEmail: (tenant.email as string | undefined) ?? client.supportEmail,
    })
    db.addLog(client.id, 'Tenant vinculado manualmente', `${tenant.name} · ID ${tenant.id}`)
    toast.success(`Tenant "${tenant.name}" vinculado`)
    setLinkOpen(false)
    setLinkingId(null)
    setTenantList([])
  }

  const tree = React.useMemo(
    () => enrichChecklistFromBriefing(client.deliveryChecklist, client.briefingData, client.briefingConfig),
    [client.deliveryChecklist, client.briefingData, client.briefingConfig],
  )

  const persist = (next: ChecklistItem[], log: string) => {
    db.updateClient(client.id, { deliveryChecklist: next })
    db.addLog(client.id, 'Checklist atualizado', log)
  }

  const toggleItem = (item: ChecklistItem) => {
    if (!item.checked && !user) {
      toast.error('Defina seu nome em Configurações antes de marcar itens.')
      return
    }
    const next = toggleChecklistItem(tree, item.id, user)
    persist(next, `${item.label}: ${!item.checked ? 'concluído' : 'desmarcado'}`)
    const allDone = next.length > 0 && next.every((i) => i.checked)
    if (allDone && client.stage === 'setup') {
      // Concluir libera a vaga do responsável na fila de configuração.
      db.updateClient(client.id, { stage: 'setup_done', setupStartedAt: undefined })
      db.addLog(client.id, 'Etapa: Pronto para Entrega', 'Avançado automaticamente ao concluir todas as configurações')
      toast.success('Todas as configurações concluídas → Pronto para Entrega')
    }
  }

  // Cria o canal de UM número (botão "Criar canal" do checklist): cria a sessão
  // no NX (tipo evo) E a instância na Evolution, com o mesmo nome (número
  // normalizado 55+DDD). Marca o item ao concluir.
  const createChannel = async (item: ChecklistItem) => {
    const m = /^channels_phone_(\d+)$/.exec(item.id)
    if (!m) return
    const idx = parseInt(m[1], 10)
    const number = client.briefingData?.whatsappNumbers?.[idx]
    if (!number) {
      toast.error('Número não encontrado no briefing.')
      return
    }
    if (!client.tenantId || !client.tenantServerId) {
      toast.error('Crie o tenant antes de criar os canais.')
      return
    }
    const server = getServerById(client.tenantServerId)
    if (!server) {
      toast.error('Servidor do tenant não encontrado.')
      return
    }
    const channelName = normalizeWhatsappNumber(number) || number
    setCreatingChannelId(item.id)
    try {
      // Sempre baileys: é o que cria a API do tenant de forma confiável no NX.
      await tenantsApi.createSession(server, {
        tenant: client.tenantId,
        name: channelName.slice(0, 60),
        status: 'DISCONNECTED',
        type: 'baileys',
      })
      const next = setChecklistItem(tree, item.id, true, user)
      db.updateClient(client.id, { deliveryChecklist: next })
      db.addLog(client.id, 'Canal criado', `${channelName} · baileys`)
      toast.success(`Canal ${channelName} criado`)
    } catch (err) {
      toast.error('Falha ao criar canal: ' + extractErrorMessage(err, 'erro'))
    } finally {
      setCreatingChannelId(null)
    }
  }

  const createUsers = async () => {
    if (!client.tenantApiId || !client.tenantServerId) {
      toast.error('Crie o tenant antes de criar os usuários.')
      return
    }
    const briefingUsers = client.briefingData?.users ?? []
    if (briefingUsers.length === 0) {
      toast.error('Nenhum usuário no briefing para criar.')
      return
    }
    const server = getServerById(client.tenantServerId)
    if (!server) {
      toast.error('Servidor do tenant não encontrado.')
      return
    }
    // Filas/usuários autenticam com o token da API do tenant. Tenants criados
    // antes do provisionamento automático não têm esse token salvo.
    if (!client.tenantApiToken) {
      toast.warning(
        'Sem token da API deste tenant — recrie o tenant para provisionar a API. Tentando com o token do servidor…',
      )
    }
    setCreatingUsers(true)
    const defaultPassword =
      db.getSettings().defaultTenantPassword || 'Nxim01@!'

    // Garante as filas a partir dos setores do briefing (departamentos +
    // setores dos usuários). Idempotente: fila já existente apenas falha e é
    // ignorada. Cobre tenants criados antes do provisionamento automático.
    const sectorSet = new Set<string>()
    const sectors: string[] = []
    for (const s of [
      ...(client.briefingData?.departments ?? []),
      ...briefingUsers.flatMap((u) => u.sectors ?? (u.sector ? [u.sector] : [])),
    ]) {
      const t = s.trim()
      if (t && !sectorSet.has(t.toLowerCase())) {
        sectorSet.add(t.toLowerCase())
        sectors.push(t)
      }
    }
    // Token da API do tenant — autentica as chamadas /v2/api/external/{apiId}.
    const apiToken = client.tenantApiToken || undefined
    let queuesCreated = 0
    for (const q of sectors) {
      try {
        await queuesApi.create(
          server,
          client.tenantApiId,
          { queue: q, isActive: true },
          apiToken,
        )
        queuesCreated++
      } catch {
        /* fila já existe / erro pontual — segue */
      }
    }

    let success = 0
    const failures: string[] = []
    // Cria em ordem alfabética — casa com a listagem da plataforma NX.
    for (const u of sortUsersByName(briefingUsers)) {
      try {
        await usersApi.create(
          server,
          client.tenantApiId,
          {
            name: u.name,
            email: u.email,
            password: defaultPassword,
            // NX aceita 'admin' | 'user'. Só admin do briefing vira admin.
            profile: u.role === 'admin' ? 'admin' : 'user',
          },
          apiToken,
        )
        success++
      } catch (err) {
        failures.push(`${u.name}: ${extractErrorMessage(err, 'falha')}`)
      }
    }
    setCreatingUsers(false)

    if (success > 0 || queuesCreated > 0) {
      let next = tree
      if (success > 0) next = setChecklistItem(next, 'users_created', true, user)
      if (queuesCreated > 0) next = setChecklistItem(next, 'queues_created', true, 'Sistema')
      db.updateClient(client.id, { deliveryChecklist: next })
    }
    if (success > 0) {
      db.addLog(
        client.id,
        'Usuários criados',
        `${success} criado(s) em ${server.name}` +
          (queuesCreated > 0 ? ` · ${queuesCreated} fila(s)` : ''),
      )
    }
    if (failures.length === 0) {
      toast.success(
        `${success} usuário(s) criado(s)` +
          (queuesCreated > 0 ? ` · ${queuesCreated} fila(s)` : ''),
      )
    } else {
      toast.error(
        `${success} criado(s), ${failures.length} falharam: ${failures[0]}`,
      )
    }
  }

  const { done, total } = checklistProgress(tree)
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const briefingUsers = client.briefingData?.users ?? []

  return (
    <div className="space-y-4">
      <Section
        title={
          <span className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-accent" />
            Ações automáticas
          </span>
        }
      >
        <p className="text-xs text-foreground/55">
          Atalhos para configurar o cliente a partir do briefing.
        </p>

        {client.tenantId && (
          <div className="mt-3 rounded-lg border border-success/30 bg-success/[0.05] px-3 py-2 text-xs text-foreground/80">
            <div className="font-medium text-success">
              Tenant vinculado: {client.tenantName ?? client.tenantId}
            </div>
            <div className="mt-0.5 text-foreground/55">
              Servidor: {client.tenantServerId} · Suporte:{' '}
              <span className="text-foreground/85">{client.supportEmail ?? '—'}</span>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            onClick={() => setTenantModalOpen(true)}
            leftIcon={<ServerIcon className="h-4 w-4" />}
          >
            {client.tenantId ? 'Recriar tenant' : 'Criar tenant'}
          </Button>
          <Button
            variant="secondary"
            onClick={createUsers}
            loading={creatingUsers}
            disabled={!client.tenantApiId || briefingUsers.length === 0}
            leftIcon={
              !creatingUsers ? <UserPlus className="h-4 w-4" /> : undefined
            }
          >
            Criar usuários
            {briefingUsers.length > 0 && (
              <span className="ml-1 text-[10px] text-foreground/55">
                ({briefingUsers.length})
              </span>
            )}
          </Button>
        </div>

        {!client.tenantApiId && briefingUsers.length > 0 && (
          <p className="mt-2 text-[11px] text-foreground/45">
            Crie o tenant primeiro para habilitar a criação automática dos{' '}
            {briefingUsers.length} usuário(s) do briefing.
          </p>
        )}

        {/* Vincular tenant existente */}
        <div className="mt-4 border-t border-line/60 pt-3">
          <button
            type="button"
            onClick={() => {
              const next = !linkOpen
              setLinkOpen(next)
              if (next && tenantList.length === 0) loadTenants()
            }}
            className="inline-flex items-center gap-1.5 text-xs text-foreground/50 hover:text-accent transition-colors"
          >
            <Link2 className="h-3.5 w-3.5" />
            Vincular tenant existente do servidor
          </button>

          {linkOpen && (
            <div className="mt-3 rounded-xl border border-line bg-elevate/[0.02] p-3 space-y-3">
              {/* Server + reload */}
              <div className="flex items-center gap-2">
                {servers.length > 1 && (
                  <select
                    value={linkServerId}
                    onChange={(e) => { setLinkServerId(e.target.value); setTenantList([]); setLinkingId(null) }}
                    className="h-7 flex-1 rounded border border-line bg-card px-2 text-xs text-foreground focus:border-accent focus:outline-none"
                  >
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={loadTenants}
                  disabled={tenantListLoading}
                  title="Recarregar lista"
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-line bg-card text-foreground/50 hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40"
                >
                  {tenantListLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* Search */}
              {tenantList.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35 pointer-events-none" />
                  <input
                    value={tenantSearch}
                    onChange={(e) => setTenantSearch(e.target.value)}
                    placeholder="Buscar tenant…"
                    className="h-7 w-full rounded border border-line bg-card pl-7 pr-3 text-xs text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none"
                  />
                </div>
              )}

              {/* List */}
              {tenantListLoading && (
                <p className="text-center text-xs text-foreground/40 py-2">Carregando…</p>
              )}
              {!tenantListLoading && tenantList.length > 0 && (
                <ul className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
                  {tenantList
                    .filter((t) =>
                      !tenantSearch ||
                      t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
                      String(t.id).includes(tenantSearch),
                    )
                    .map((t) => (
                      <li
                        key={t.id}
                        className="rounded-lg border border-line bg-card px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{t.name}</p>
                            <p className="text-[10px] text-foreground/40">
                              ID: {t.id}
                              {t.email ? ` · ${t.email}` : ''}
                            </p>
                          </div>
                          {linkingId !== String(t.id) ? (
                            <button
                              type="button"
                              onClick={() => {
                                setLinkingId(String(t.id))
                                setLinkApiId(String(t.apiId ?? t.id))
                                setLinkToken((t.api_token as string | undefined) ?? (t.api_key as string | undefined) ?? '')
                              }}
                              className="shrink-0 inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20 transition-colors"
                            >
                              <Link2 className="h-3 w-3" />
                              Vincular
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setLinkingId(null)}
                              className="shrink-0 text-[10px] text-foreground/40 hover:text-foreground/70"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {/* Inline form */}
                        {linkingId === String(t.id) && (
                          <div className="mt-2 space-y-1.5">
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <p className="mb-0.5 text-[10px] text-foreground/45">API ID</p>
                                <input
                                  value={linkApiId}
                                  onChange={(e) => setLinkApiId(e.target.value)}
                                  placeholder={String(t.id)}
                                  className="h-7 w-full rounded border border-line bg-surface px-2 text-xs text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none"
                                />
                              </div>
                              <div>
                                <p className="mb-0.5 text-[10px] text-foreground/45">Token</p>
                                <input
                                  value={linkToken}
                                  onChange={(e) => setLinkToken(e.target.value)}
                                  placeholder="(opcional)"
                                  className="h-7 w-full rounded border border-line bg-surface px-2 text-xs text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => doLinkTenant(t)}
                              className="w-full rounded-md bg-accent/15 py-1 text-xs font-medium text-accent hover:bg-accent/25 transition-colors"
                            >
                              Confirmar vínculo
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5 text-accent" />
            Checklist de criação da empresa
          </span>
        }
        action={
          <span className="text-[11px] text-foreground/55">
            {done}/{total} concluídos
          </span>
        }
      >
        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-elevate/[0.06]">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ul className="space-y-1.5">
          {tree.map((item) => (
            <ChecklistRow
              key={item.id}
              item={item}
              onToggle={toggleItem}
              onCreateChannel={createChannel}
              creatingChannelId={creatingChannelId}
            />
          ))}
        </ul>
      </Section>

      <CreateTenantModal
        client={client}
        open={tenantModalOpen}
        onClose={() => setTenantModalOpen(false)}
      />
    </div>
  )
}

function ChecklistRow({
  item,
  onToggle,
  onCreateChannel,
  creatingChannelId,
  depth = 0,
}: {
  item: ChecklistItem
  onToggle: (it: ChecklistItem) => void
  onCreateChannel?: (it: ChecklistItem) => void
  creatingChannelId?: string | null
  depth?: number
}) {
  const hasChildren = Boolean(item.children && item.children.length > 0)
  const [open, setOpen] = React.useState(true)
  // Botão "Criar canal" só nos itens de número de WhatsApp ainda não criados.
  const isPhoneChannel = /^channels_phone_\d+$/.test(item.id)
  const canCreateChannel = isPhoneChannel && !item.checked && Boolean(onCreateChannel)
  return (
    <li className="space-y-1.5">
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
          item.checked
            ? 'border-success/30 bg-success/[0.05]'
            : 'border-line bg-elevate/[0.02] hover:bg-elevate/[0.04]',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="grid h-4 w-4 shrink-0 place-items-center text-foreground/45 hover:text-foreground"
            aria-label={open ? 'Recolher' : 'Expandir'}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item)}
          className="h-4 w-4 shrink-0 accent-[#4F8EF7]"
        />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-sm',
              item.checked ? 'text-foreground/55 line-through' : 'text-foreground/90',
            )}
          >
            {item.label}
          </p>
          {item.checked && (
            <p className="mt-0.5 text-[10px] text-foreground/40">
              por {asText(item.checkedBy, '—')} em{' '}
              {formatDate(item.checkedAt)}
            </p>
          )}
        </div>
        {canCreateChannel && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onCreateChannel!(item)}
            loading={creatingChannelId === item.id}
            disabled={Boolean(creatingChannelId)}
            leftIcon={
              creatingChannelId === item.id ? undefined : <Plus className="h-3.5 w-3.5" />
            }
          >
            Criar canal
          </Button>
        )}
      </div>
      {hasChildren && open && (
        <ul
          className="space-y-1.5 border-l border-line/70 pl-3"
          style={{ marginLeft: depth === 0 ? 18 : 12 }}
        >
          {item.children!.map((child) => (
            <ChecklistRow
              key={child.id}
              item={child}
              onToggle={onToggle}
              onCreateChannel={onCreateChannel}
              creatingChannelId={creatingChannelId}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ── Link builder ──────────────────────────────────────────────────────────────

function buildBriefingLink(token?: string): string | null {
  if (!token) return null
  if (typeof window === 'undefined') return `/briefing/${token}`
  return `${window.location.origin}/briefing/${token}`
}

// Ordena os usuários do briefing por nome (alfabético, pt-BR, ignora acento/caixa).
// A plataforma NX lista os usuários em ordem alfabética — manter a mesma ordem
// aqui agiliza conferir/criar os usuários na hora de configurar.
function sortUsersByName<T extends { name?: string }>(users: T[]): T[] {
  return [...users].sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR', { sensitivity: 'base' }),
  )
}

// ── Briefing viewer ───────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  messenger: 'Facebook / Messenger',
  olx: 'OLX',
  mercadolivre: 'Mercado Livre',
  wavoip: 'WaVoip',
  email: 'E-mail',
}

function BriefingViewer({
  data,
  config,
}: {
  data: NonNullable<Client['briefingData']>
  config?: BriefingConfig | null
}) {
  const hasExtraChannels =
    data.wavoipInfo ||
    data.olxInfo ||
    data.mercadolivreInfo ||
    data.emailConfig

  return (
    <div className="space-y-2">
      <Accordion title="1. Empresa" defaultOpen>
        <Row k="Razão social" v={data.razaoSocial} />
        <Row k="Nome fantasia" v={data.nomeFantasia} />
        <Row k="CNPJ" v={data.cnpj} />
        <Row k="Site" v={data.site} />
      </Accordion>

      <Accordion title={`2. Usuários (${data.users.length})`} defaultOpen>
        <ul className="space-y-1">
          {sortUsersByName(data.users).map((u, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-elevate/[0.02] px-3 py-1.5 text-xs"
            >
              <span className="font-medium text-foreground">{asText(u.name)}</span>
              <span className="text-foreground/45"> · {asText(u.email)} · </span>
              <span className="text-foreground/55">
                {asText(
                  (u.sectors ?? (u.sector ? [u.sector] : [])).join(', '),
                )}{' '}
                · {asText(u.role)}
              </span>
            </li>
          ))}
        </ul>
      </Accordion>

      <Accordion title="3. Horários" defaultOpen>
        <Row k="Fuso" v={data.timezone} />
        <ul className="mt-2 space-y-1 text-xs">
          {data.schedule.map((s) => (
            <li key={s.day} className="flex items-center justify-between">
              <span className="text-foreground/85">{asText(s.day)}</span>
              <span className="text-foreground/55">
                {s.active ? `${s.start} - ${s.end}` : 'fechado'}
              </span>
            </li>
          ))}
        </ul>
      </Accordion>

      <Accordion title="4. Integrações" defaultOpen>
        <Row k="WhatsApp" v={data.whatsappNumbers.join(', ')} />
        <Row k="Tipo" v={data.whatsappType} />
        {data.facebookEmail || data.facebookPassword ? (
          <>
            <Row k="Facebook/Meta · e-mail" v={data.facebookEmail} />
            <Row k="Facebook/Meta · senha" v={data.facebookPassword} />
          </>
        ) : (
          <Row k="Facebook/Meta" v={data.useFacebook ? 'Sim' : 'Não'} />
        )}
        {data.facebookToken && <Row k="Token" v="••••••••" />}
        {hasExtraChannels && (
          <>
            {data.wavoipInfo && <Row k="WaVoip" v={data.wavoipInfo} />}
            {data.olxInfo && <Row k="OLX" v={data.olxInfo} />}
            {data.mercadolivreInfo && <Row k="Mercado Livre" v={data.mercadolivreInfo} />}
            {data.emailConfig && <Row k="E-mail" v={data.emailConfig} />}
          </>
        )}
        {data.channelAccess &&
          Object.entries(data.channelAccess).map(([key, acc]) => (
            <React.Fragment key={key}>
              {acc.email && <Row k={`${CHANNEL_LABELS[key] ?? key} · login`} v={acc.email} />}
              {acc.password && (
                <Row k={`${CHANNEL_LABELS[key] ?? key} · senha`} v={acc.password} />
              )}
              {acc.notes && <Row k={`${CHANNEL_LABELS[key] ?? key} · obs.`} v={acc.notes} />}
            </React.Fragment>
          ))}
      </Accordion>

      {(data.greetingMessage ||
        data.offHoursMessage ||
        data.mainFlow ||
        data.departments.length > 0) && (
        <Accordion title="5. Chatbot" defaultOpen>
          {data.mainFlow && <Row k="Fluxo principal" v={data.mainFlow} />}
          <Row k="Saudação" v={data.greetingMessage} />
          <Row k="Fora do horário" v={data.offHoursMessage} />
          {data.departments.length > 0 && (
            <Row k="Departamentos" v={data.departments.join(', ')} />
          )}
        </Accordion>
      )}

      {(hasAnyAiData(data) ||
        data.useAI ||
        config?.automationTypes.some((t) => t === 'ia_basica' || t === 'ia_avancada')) && (
        <AiAccordion data={data} config={config} />
      )}

      {data.externalAutomationInfo && (
        <Accordion title="7. Automação externa" defaultOpen>
          <Row k="" v={data.externalAutomationInfo} />
        </Accordion>
      )}

      {data.extraNotes && (
        <Accordion title="Observações">
          <Row k="" v={data.extraNotes} />
        </Accordion>
      )}
    </div>
  )
}

// ── Visualização das respostas de IA ─────────────────────────────────────────

const AI_TONE_LABELS: Record<string, string> = {
  formal: 'Formal — linguagem profissional e respeitosa',
  casual: 'Casual — amigável e descontraído',
  tecnico: 'Técnico — objetivo e preciso',
}

/** Campos exclusivos da IA Avançada (integração com sistema externo). */
function hasAdvancedAiData(d: NonNullable<Client['briefingData']>): boolean {
  return Boolean(
    d.aiExternalSystem ||
      d.aiExternalApiUrl ||
      d.aiExternalWhatToQuery ||
      d.aiExternalAuth ||
      d.aiExternalExamples,
  )
}

function hasAnyAiData(d: NonNullable<Client['briefingData']>): boolean {
  return Boolean(
    d.aiAgentName ||
      d.aiCompanyDescription ||
      d.aiServices ||
      d.aiPrices ||
      d.aiLocation ||
      d.aiSocialMedia ||
      d.aiAttendanceFlow ||
      d.aiTransferConditions ||
      d.aiRestrictions ||
      d.aiInstructions ||
      d.aiAddress ||
      d.aiSlogan ||
      d.aiMostSought ||
      d.aiPartnerships ||
      d.aiPaymentMethods ||
      d.aiPromotions ||
      d.aiFirstMessage ||
      d.aiSchedulingData ||
      d.aiPostDataMessage ||
      d.aiExistingClient ||
      d.aiWhenUnknown ||
      d.aiFaq ||
      hasAdvancedAiData(d),
  )
}

/** Texto plano das respostas de IA — usado no botão "copiar". */
function buildAiSummaryText(d: NonNullable<Client['briefingData']>): string {
  const lines: string[] = []
  const put = (label: string, value?: string | null) => {
    if (value && value.trim()) lines.push(`${label}:\n${value.trim()}\n`)
  }
  put('Nome da IA', d.aiAgentName)
  put('Tom de comunicação', d.aiTone ? AI_TONE_LABELS[d.aiTone] ?? d.aiTone : undefined)
  put('Sobre a empresa', d.aiCompanyDescription)
  put('Localização', d.aiLocation)
  put('Redes sociais', d.aiSocialMedia)
  put('Serviços / produtos', d.aiServices)
  put('Informa preços', d.aiHasPrices ? 'Sim' : 'Não — encaminhar para atendente')
  put('Tabela de preços', d.aiHasPrices ? d.aiPrices : undefined)
  put('Endereço das unidades', d.aiAddress)
  put('Frase / bordão', d.aiSlogan)
  put('Mais procurados', d.aiMostSought)
  put('Convênios / parcerias', d.aiPartnerships)
  put('Formas de pagamento', d.aiPaymentMethods)
  put('Promoções', d.aiPromotions)
  put('Fluxo de atendimento', d.aiAttendanceFlow)
  put('Mensagem no 1º contato', d.aiFirstMessage)
  put('Dados para agendar', d.aiSchedulingData)
  put('Mensagem após os dados', d.aiPostDataMessage)
  put('Quando já é cliente', d.aiExistingClient)
  put('Quando transferir para humano', d.aiTransferConditions)
  put('Quando não souber algo', d.aiWhenUnknown)
  put('O que a IA não deve fazer', d.aiRestrictions)
  put('Perguntas frequentes', d.aiFaq)
  put('Instruções extras', d.aiInstructions)
  put('Sistema externo', d.aiExternalSystem)
  put('O que consultar no sistema', d.aiExternalWhatToQuery)
  put('URL da API / webhook', d.aiExternalApiUrl)
  put('Autenticação', d.aiExternalAuth)
  put('Exemplos de consulta', d.aiExternalExamples)
  return lines.join('\n')
}

function AiAccordion({
  data,
  config,
}: {
  data: NonNullable<Client['briefingData']>
  config?: BriefingConfig | null
}) {
  const advanced =
    Boolean(config?.automationTypes.includes('ia_avancada')) || hasAdvancedAiData(data)
  const filled = hasAnyAiData(data)

  const copyAll = async () => {
    const ok = await copyToClipboard(buildAiSummaryText(data))
    if (ok) toast.success('Informações da IA copiadas')
    else toast.error('Não foi possível copiar')
  }

  return (
    <Accordion
      defaultOpen
      title={
        <span className="flex flex-wrap items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>6. {advanced ? 'IA Avançada' : 'IA'}</span>
          {!filled && <Badge tone="warning">não preenchido</Badge>}
        </span>
      }
    >
      {!filled ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            O cliente contratou {advanced ? 'IA Avançada' : 'IA'}, mas não há respostas de
            IA salvas neste briefing. Use <strong>Solicitar revisão</strong> para que ele
            preencha a etapa de IA novamente.
          </span>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={copyAll}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] text-foreground/60 hover:bg-elevate/[0.04] hover:text-foreground/85"
            >
              <Copy className="h-3 w-3" />
              Copiar informações da IA
            </button>
          </div>

          <AiGroup title="Identidade da IA">
            <div className="grid gap-2 sm:grid-cols-2">
              <AiInline label="Nome da IA" value={data.aiAgentName} />
              <AiInline
                label="Tom de comunicação"
                value={data.aiTone ? AI_TONE_LABELS[data.aiTone] ?? data.aiTone : undefined}
              />
            </div>
          </AiGroup>

          <AiGroup title="Sobre a empresa">
            <AiText label="O que a empresa faz e para quem atende" value={data.aiCompanyDescription} />
            <div className="grid gap-2 sm:grid-cols-2">
              <AiInline label="Localização" value={data.aiLocation} />
              <AiInline label="Redes sociais" value={data.aiSocialMedia} />
            </div>
            {data.aiAddress && <AiText label="Endereço de cada unidade" value={data.aiAddress} />}
            {data.aiSlogan && <AiInline label="Frase / bordão" value={data.aiSlogan} />}
          </AiGroup>

          <AiGroup title="Serviços e valores">
            <AiText label="Principais serviços / produtos" value={data.aiServices} />
            {data.aiMostSought && <AiText label="Mais procurados" value={data.aiMostSought} />}
            {data.aiPartnerships && <AiText label="Convênios, planos ou parcerias" value={data.aiPartnerships} />}
            <AiInline
              label="A IA pode informar preços?"
              value={data.aiHasPrices ? 'Sim, pode informar' : 'Não — encaminhar para atendente'}
            />
            {data.aiHasPrices && <AiText label="Tabela de preços" value={data.aiPrices} />}
            {data.aiPaymentMethods && <AiText label="Formas de pagamento" value={data.aiPaymentMethods} />}
            {data.aiPromotions && <AiText label="Promoções / condições especiais" value={data.aiPromotions} />}
          </AiGroup>

          <AiGroup title="Fluxo de atendimento">
            <AiText label="Como a IA deve conduzir a conversa" value={data.aiAttendanceFlow} />
            {data.aiFirstMessage && <AiText label="Mensagem no 1º contato" value={data.aiFirstMessage} />}
            {data.aiSchedulingData && <AiText label="Dados que pede para agendar" value={data.aiSchedulingData} />}
            {data.aiPostDataMessage && (
              <AiText label="Mensagem depois que o cliente passa os dados" value={data.aiPostDataMessage} />
            )}
            {data.aiExistingClient && <AiText label="Quando já é cliente" value={data.aiExistingClient} />}
            <AiText label="Quando transferir para um atendente" value={data.aiTransferConditions} />
            {data.aiWhenUnknown && <AiText label="Quando não souber algo" value={data.aiWhenUnknown} />}
            <AiText label="O que a IA NÃO deve fazer ou dizer" value={data.aiRestrictions} />
            {data.aiInstructions && (
              <AiText label="Instruções extras" value={data.aiInstructions} />
            )}
          </AiGroup>

          {data.aiFaq && (
            <AiGroup title="Dúvidas dos clientes">
              <AiText label="Perguntas frequentes (pergunta + resposta)" value={data.aiFaq} />
            </AiGroup>
          )}

          {advanced && (
            <AiGroup
              title="Integração com sistema externo"
              tone="accent"
              hint="A IA avançada consulta o sistema do cliente em tempo real."
            >
              {hasAdvancedAiData(data) ? (
                <>
                  <AiInline label="Sistema" value={data.aiExternalSystem} />
                  <AiText label="O que a IA precisa consultar" value={data.aiExternalWhatToQuery} />
                  <AiInline label="URL da API / webhook" value={data.aiExternalApiUrl} mono />
                  <AiText label="Autenticação" value={data.aiExternalAuth} />
                  <AiText label="Exemplos de consulta" value={data.aiExternalExamples} />
                </>
              ) : (
                <p className="text-xs text-foreground/45">
                  O cliente não informou dados da integração externa.
                </p>
              )}
            </AiGroup>
          )}
        </div>
      )}
    </Accordion>
  )
}

function AiGroup({
  title,
  hint,
  tone = 'neutral',
  children,
}: {
  title: string
  hint?: string
  tone?: 'neutral' | 'accent'
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        tone === 'accent'
          ? 'border-accent/30 bg-accent/[0.06]'
          : 'border-line bg-elevate/[0.02]',
      )}
    >
      <h4
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wider',
          tone === 'accent' ? 'text-accent' : 'text-foreground/45',
        )}
      >
        {title}
      </h4>
      {hint && <p className="mt-0.5 text-[11px] text-foreground/45">{hint}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  )
}

/** Valor curto — label e valor na mesma linha. */
function AiInline({
  label,
  value,
  mono,
}: {
  label: string
  value?: string | null
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] text-foreground/40">{label}</span>
      <span
        className={cn(
          'block break-words text-xs',
          mono && 'font-mono',
          value ? 'text-foreground/85' : 'text-foreground/30',
        )}
      >
        {value ? asText(value) : '—'}
      </span>
    </div>
  )
}

/** Texto longo — label acima, conteúdo em bloco preservando quebras de linha. */
function AiText({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="block text-[11px] text-foreground/40">{label}</span>
      {value ? (
        <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line bg-surface px-2.5 py-2 text-xs leading-relaxed text-foreground/85">
          {asText(value)}
        </p>
      ) : (
        <span className="block text-xs text-foreground/30">—</span>
      )}
    </div>
  )
}

// ── Briefing editor (edição manual pós-preenchimento) ─────────────────────────

type BriefingDataT = NonNullable<Client['briefingData']>

function BriefingEditor({
  data,
  onSave,
  onCancel,
}: {
  data: BriefingDataT
  onSave: (next: BriefingDataT) => void
  onCancel: () => void
}) {
  // Cópia profunda (dado é JSON puro) pra editar sem mexer no original até salvar.
  const [d, setD] = React.useState<BriefingDataT>(() => JSON.parse(JSON.stringify(data)))
  const set = (patch: Partial<BriefingDataT>) => setD((cur) => ({ ...cur, ...patch }))

  const setUser = (i: number, patch: Partial<BriefingUser>) =>
    setD((cur) => ({
      ...cur,
      users: cur.users.map((u, idx) => (idx === i ? { ...u, ...patch } : u)),
    }))
  const addUser = () =>
    setD((cur) => ({
      ...cur,
      users: [...cur.users, { name: '', email: '', sectors: [], role: 'atendente' }],
    }))
  const removeUser = (i: number) =>
    setD((cur) => ({ ...cur, users: cur.users.filter((_, idx) => idx !== i) }))

  const setSlot = (i: number, patch: Partial<BriefingScheduleSlot>) =>
    setD((cur) => ({
      ...cur,
      schedule: cur.schedule.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    }))

  const setChannel = (
    key: string,
    patch: { email?: string; password?: string; notes?: string },
  ) =>
    setD((cur) => ({
      ...cur,
      channelAccess: {
        ...(cur.channelAccess ?? {}),
        [key]: { ...((cur.channelAccess ?? {})[key] ?? {}), ...patch },
      },
    }))

  const actions = (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancelar
      </Button>
      <Button onClick={() => onSave(d)} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
        Salvar alterações
      </Button>
    </div>
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2">
        <span className="text-xs text-foreground/70">
          Editando o briefing — as mudanças só valem após salvar.
        </span>
      </div>

      <Accordion title="1. Empresa" defaultOpen>
        <EditField label="Razão social" value={d.razaoSocial} onChange={(v) => set({ razaoSocial: v })} />
        <EditField label="Nome fantasia" value={d.nomeFantasia} onChange={(v) => set({ nomeFantasia: v })} />
        <EditField label="CNPJ" value={d.cnpj} onChange={(v) => set({ cnpj: v })} />
        <EditField label="Site" value={d.site ?? ''} onChange={(v) => set({ site: v })} />
      </Accordion>

      <Accordion title={`2. Usuários (${d.users.length})`} defaultOpen>
        <div className="space-y-3">
          {d.users.map((u, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-line bg-surface p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <EditField label="Nome" value={u.name} onChange={(v) => setUser(i, { name: v })} />
                <EditField
                  label="E-mail"
                  type="email"
                  value={u.email}
                  onChange={(v) => setUser(i, { email: v })}
                />
                <EditField
                  label="Setores (separe por vírgula)"
                  value={(u.sectors ?? (u.sector ? [u.sector] : [])).join(', ')}
                  onChange={(v) =>
                    setUser(i, { sectors: v.split(',').map((s) => s.trim()).filter(Boolean) })
                  }
                />
                <EditSelect
                  label="Perfil"
                  value={u.role}
                  onChange={(v) => setUser(i, { role: v as BriefingUserRole })}
                  options={[
                    { value: 'atendente', label: 'Atendente' },
                    { value: 'supervisor', label: 'Supervisor' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={() => removeUser(i)}
                className="text-xs text-danger hover:underline"
              >
                Remover usuário
              </button>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={addUser}>
            Adicionar usuário
          </Button>
        </div>
      </Accordion>

      <Accordion title="3. Horários" defaultOpen>
        <EditField label="Fuso horário" value={d.timezone} onChange={(v) => set({ timezone: v })} />
        <div className="mt-2 space-y-1.5">
          {d.schedule.map((s, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-2.5 py-1.5"
            >
              <label className="inline-flex w-28 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={s.active}
                  onChange={(e) => setSlot(i, { active: e.target.checked })}
                  className="h-4 w-4 accent-[#4F8EF7]"
                />
                <span className="text-foreground/85">{asText(s.day)}</span>
              </label>
              {s.active ? (
                <div className="flex items-center gap-1.5 text-sm">
                  <input
                    type="time"
                    value={s.start}
                    onChange={(e) => setSlot(i, { start: e.target.value })}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                  />
                  <span className="text-foreground/40">—</span>
                  <input
                    type="time"
                    value={s.end}
                    onChange={(e) => setSlot(i, { end: e.target.value })}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                  />
                </div>
              ) : (
                <span className="text-xs text-foreground/40">Fechado</span>
              )}
            </div>
          ))}
        </div>
      </Accordion>

      <Accordion title="4. Integrações" defaultOpen>
        <EditArea
          label="Números de WhatsApp (um por linha)"
          value={(d.whatsappNumbers ?? []).join('\n')}
          onChange={(v) =>
            set({ whatsappNumbers: v.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) })
          }
          rows={3}
        />
        <EditField
          label="Facebook/Meta — e-mail"
          value={d.facebookEmail ?? ''}
          onChange={(v) => set({ facebookEmail: v })}
        />
        <EditField
          label="Facebook/Meta — senha"
          value={d.facebookPassword ?? ''}
          onChange={(v) => set({ facebookPassword: v })}
        />
        <EditArea label="WaVoip" value={d.wavoipInfo ?? ''} onChange={(v) => set({ wavoipInfo: v })} rows={2} />
        <EditArea label="E-mail (config)" value={d.emailConfig ?? ''} onChange={(v) => set({ emailConfig: v })} rows={2} />
        {d.channelAccess &&
          Object.entries(d.channelAccess).map(([key, acc]) => (
            <div key={key} className="mt-2 space-y-2 rounded-md border border-line bg-surface p-2.5">
              <div className="text-[11px] uppercase tracking-wider text-foreground/45">
                {CHANNEL_LABELS[key] ?? key}
              </div>
              <EditField label="Login" value={acc.email ?? ''} onChange={(v) => setChannel(key, { email: v })} />
              <EditField label="Senha" value={acc.password ?? ''} onChange={(v) => setChannel(key, { password: v })} />
              <EditField label="Observações" value={acc.notes ?? ''} onChange={(v) => setChannel(key, { notes: v })} />
            </div>
          ))}
      </Accordion>

      <Accordion title="5. Chatbot" defaultOpen>
        <EditField
          label="Departamentos (separe por vírgula)"
          value={(d.departments ?? []).join(', ')}
          onChange={(v) => set({ departments: v.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
        <EditArea label="Saudação" value={d.greetingMessage ?? ''} onChange={(v) => set({ greetingMessage: v })} rows={6} />
        <EditArea label="Fora do horário" value={d.offHoursMessage ?? ''} onChange={(v) => set({ offHoursMessage: v })} rows={5} />
      </Accordion>

      <Accordion title="6. IA" defaultOpen>
        <label className="flex items-center gap-2 py-1 text-sm text-foreground/80">
          <input
            type="checkbox"
            checked={d.useAI}
            onChange={(e) => set({ useAI: e.target.checked })}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Usar IA
        </label>
        {d.useAI && (
          <>
            <EditField label="Nome da IA" value={d.aiAgentName ?? ''} onChange={(v) => set({ aiAgentName: v })} />
            <EditSelect
              label="Tom"
              value={d.aiTone ?? 'casual'}
              onChange={(v) => set({ aiTone: v as AiTone })}
              options={[
                { value: 'formal', label: 'Formal' },
                { value: 'casual', label: 'Casual' },
                { value: 'tecnico', label: 'Técnico' },
              ]}
            />
            <EditArea label="Sobre a empresa" value={d.aiCompanyDescription ?? ''} onChange={(v) => set({ aiCompanyDescription: v })} rows={3} />
            <EditField label="Localização" value={d.aiLocation ?? ''} onChange={(v) => set({ aiLocation: v })} />
            <EditField label="Redes sociais" value={d.aiSocialMedia ?? ''} onChange={(v) => set({ aiSocialMedia: v })} />
            <EditArea label="Serviços / produtos" value={d.aiServices ?? ''} onChange={(v) => set({ aiServices: v })} rows={3} />
            <label className="flex items-center gap-2 py-1 text-sm text-foreground/80">
              <input
                type="checkbox"
                checked={Boolean(d.aiHasPrices)}
                onChange={(e) => set({ aiHasPrices: e.target.checked })}
                className="h-4 w-4 accent-[#4F8EF7]"
              />
              Informa preços
            </label>
            {d.aiHasPrices && (
              <EditArea label="Tabela de preços" value={d.aiPrices ?? ''} onChange={(v) => set({ aiPrices: v })} rows={3} />
            )}
            <EditArea label="Fluxo de atendimento" value={d.aiAttendanceFlow ?? ''} onChange={(v) => set({ aiAttendanceFlow: v })} rows={3} />
            <EditArea label="Quando transferir" value={d.aiTransferConditions ?? ''} onChange={(v) => set({ aiTransferConditions: v })} rows={2} />
            <EditArea label="Restrições" value={d.aiRestrictions ?? ''} onChange={(v) => set({ aiRestrictions: v })} rows={2} />
            <EditArea label="Instruções" value={d.aiInstructions ?? ''} onChange={(v) => set({ aiInstructions: v })} rows={2} />
            <EditField label="Sistema externo" value={d.aiExternalSystem ?? ''} onChange={(v) => set({ aiExternalSystem: v })} />
            <EditField label="URL da API" value={d.aiExternalApiUrl ?? ''} onChange={(v) => set({ aiExternalApiUrl: v })} />
            <EditArea label="O que consultar" value={d.aiExternalWhatToQuery ?? ''} onChange={(v) => set({ aiExternalWhatToQuery: v })} rows={2} />
            <EditArea label="Autenticação" value={d.aiExternalAuth ?? ''} onChange={(v) => set({ aiExternalAuth: v })} rows={2} />
            <EditArea label="Exemplos de consulta" value={d.aiExternalExamples ?? ''} onChange={(v) => set({ aiExternalExamples: v })} rows={2} />
          </>
        )}
      </Accordion>

      <Accordion title="7. Automação externa">
        <EditArea label="Informações" value={d.externalAutomationInfo ?? ''} onChange={(v) => set({ externalAutomationInfo: v })} rows={4} />
      </Accordion>

      <Accordion title="Observações">
        <EditArea label="Observações finais" value={d.extraNotes ?? ''} onChange={(v) => set({ extraNotes: v })} rows={4} />
      </Accordion>

      {actions}
    </div>
  )
}

function EditField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="block py-1">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
      />
    </label>
  )
}

function EditArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  return (
    <label className="block py-1">
      {label && (
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
      />
    </label>
  )
}

function EditSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="block py-1">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-foreground/45">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1 text-xs">
      {k && (
        <span className="col-span-1 text-foreground/45 uppercase tracking-wider">
          {k}
        </span>
      )}
      <span className={cn('whitespace-pre-wrap text-foreground/85', k ? 'col-span-2' : 'col-span-3')}>
        {v ? asText(v) : '—'}
      </span>
    </div>
  )
}

function Accordion({
  title,
  children,
  defaultOpen,
}: {
  title: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen))
  return (
    <div className="rounded-lg border border-line bg-elevate/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground/85 hover:bg-elevate/[0.04]"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-foreground/40 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  )
}
