import * as React from 'react'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  ListChecks,
  Loader2,
  PenLine,
  Send,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Wand2,
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
import { usersApi } from '@/api/users'
import { extractErrorMessage } from '@/api/client'
import { copyToClipboard } from '@/lib/clipboard'
import { getServerById } from '@/store/authStore'
import {
  checklistProgress,
  enrichChecklistFromBriefing,
  setChecklistItem,
  toggleChecklistItem,
} from '@/constants/checklist'
import { asText, cn, formatDate } from '@/lib/utils'
import type {
  Client,
  BriefingStatus,
  BriefingConfig,
  ConnectionType,
  AutomationType,
  BriefingChannel,
  ChecklistItem,
} from '@/types/client'

type SubView = 'briefing' | 'automation'

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

  React.useEffect(() => {
    setConfig(client.briefingConfig ?? emptyConfig)
    setRevisionNote(client.briefingRevisionNote ?? '')
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

  const configComplete =
    config.connectionTypes.length > 0 &&
    config.automationTypes.length > 0 &&
    config.channels.length > 0 &&
    config.maxUsers > 0

  const generate = () => {
    if (!configComplete) {
      toast.error('Preencha a configuração antes de gerar o briefing')
      return
    }
    const token = db.createBriefingToken(client.id)
    db.updateClient(client.id, {
      briefingToken: token,
      briefingStatus: 'sent',
      briefingSentAt: new Date().toISOString(),
    })
    db.addLog(client.id, 'Briefing enviado', 'Link gerado e marcado como enviado')
    toast.success('Link do briefing gerado')
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
      stage: client.stage === 'briefing' ? 'setup' : client.stage,
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

          <ConfigGroup label="Automação *">
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
            <>
              <BriefingViewer data={client.briefingData} />
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
          )}

          {subView === 'automation' && (
            <AutomationView client={client} />
          )}
        </>
      )}

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

  const tree = React.useMemo(
    () => enrichChecklistFromBriefing(client.deliveryChecklist, client.briefingData),
    [client.deliveryChecklist, client.briefingData],
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
    setCreatingUsers(true)
    const defaultPassword =
      db.getSettings().defaultTenantPassword || 'Nxim01@!'
    let success = 0
    const failures: string[] = []
    for (const u of briefingUsers) {
      try {
        await usersApi.create(server, client.tenantApiId, {
          tenant_id: client.tenantId,
          name: u.name,
          email: u.email,
          password: defaultPassword,
          role: u.role || 'user',
          permissions: [u.role || 'user'],
        })
        success++
      } catch (err) {
        failures.push(`${u.name}: ${extractErrorMessage(err, 'falha')}`)
      }
    }
    setCreatingUsers(false)

    if (success > 0) {
      const next = setChecklistItem(tree, 'users_created', true, user)
      db.updateClient(client.id, { deliveryChecklist: next })
      db.addLog(
        client.id,
        'Usuários criados',
        `${success} criado(s) em ${server.name}`,
      )
    }
    if (failures.length === 0) {
      toast.success(`${success} usuário(s) criado(s)`)
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
  depth = 0,
}: {
  item: ChecklistItem
  onToggle: (it: ChecklistItem) => void
  depth?: number
}) {
  const hasChildren = Boolean(item.children && item.children.length > 0)
  const [open, setOpen] = React.useState(true)
  return (
    <li className="space-y-1.5">
      <div
        className={cn(
          'flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
          item.checked
            ? 'border-success/30 bg-success/[0.05]'
            : 'border-line bg-elevate/[0.02] hover:bg-elevate/[0.04]',
        )}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 grid h-4 w-4 place-items-center text-foreground/45 hover:text-foreground"
            aria-label={open ? 'Recolher' : 'Expandir'}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <input
          type="checkbox"
          checked={item.checked}
          onChange={() => onToggle(item)}
          className="mt-0.5 h-4 w-4 accent-[#4F8EF7]"
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

// ── Briefing viewer ───────────────────────────────────────────────────────────

function BriefingViewer({ data }: { data: NonNullable<Client['briefingData']> }) {
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
          {data.users.map((u, i) => (
            <li
              key={i}
              className="rounded-md border border-line bg-elevate/[0.02] px-3 py-1.5 text-xs"
            >
              <span className="font-medium text-foreground">{asText(u.name)}</span>
              <span className="text-foreground/45"> · {asText(u.email)} · </span>
              <span className="text-foreground/55">
                {asText(u.sector)} · {asText(u.role)}
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
        <Row k="Facebook/Instagram" v={data.useFacebook ? 'Sim' : 'Não'} />
        {data.useFacebook && (
          <Row k="Token" v={data.facebookToken ? '••••••••' : '—'} />
        )}
        {hasExtraChannels && (
          <>
            {data.wavoipInfo && <Row k="WaVoip" v={data.wavoipInfo} />}
            {data.olxInfo && <Row k="OLX" v={data.olxInfo} />}
            {data.mercadolivreInfo && <Row k="Mercado Livre" v={data.mercadolivreInfo} />}
            {data.emailConfig && <Row k="E-mail" v={data.emailConfig} />}
          </>
        )}
      </Accordion>

      {data.mainFlow && (
        <Accordion title="5. Chatbot" defaultOpen>
          <Row k="Fluxo principal" v={data.mainFlow} />
          <Row k="Saudação" v={data.greetingMessage} />
          <Row k="Fora do horário" v={data.offHoursMessage} />
          <Row k="Departamentos" v={data.departments.join(', ')} />
        </Accordion>
      )}

      {data.useAI && (
        <Accordion title="6. IA" defaultOpen>
          <Row k="Usar IA" v="Sim" />
          <Row k="Tom" v={data.aiTone} />
          <Row k="Instruções" v={data.aiInstructions} />
          <Row k="Restrições" v={data.aiRestrictions} />
        </Accordion>
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
  title: string
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
