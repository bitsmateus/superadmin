import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Loader2,
  Mail,
  MinusCircle,
  Server as ServerIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { tenantsApi } from '@/api/tenants'
import { queuesApi } from '@/api/queues'
import { usersApi } from '@/api/users'
import { extractErrorMessage } from '@/api/client'
import { useAuthStore, type ServerConfig } from '@/store/authStore'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import {
  enrichChecklistFromBriefing,
  setChecklistItem,
} from '@/constants/checklist'
import { cn, deriveSupportEmail } from '@/lib/utils'
import type { Client } from '@/types/client'
import type { Tenant } from '@/types'

const FALLBACK_TENANT_PASSWORD = 'Nxim01@!'

/** Lê o primeiro campo não-nulo de um objeto de resposta (formato variável). */
function pick(obj: unknown, ...keys: string[]): unknown {
  if (obj && typeof obj === 'object') {
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      if (v !== undefined && v !== null) return v
    }
  }
  return undefined
}

function genToken(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
  } catch {
    /* sem crypto.randomUUID — usa fallback */
  }
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

/** Setores do briefing (departamentos + setores dos usuários), deduplicados. */
function collectSectors(client: Client): string[] {
  const fromDepartments = client.briefingData?.departments ?? []
  const fromUsers = (client.briefingData?.users ?? []).flatMap((u) =>
    u.sectors ?? (u.sector ? [u.sector] : []),
  )
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of [...fromDepartments, ...fromUsers]) {
    const t = s.trim()
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase())
      out.push(t)
    }
  }
  return out
}

export function CreateTenantModal({
  client,
  open,
  onClose,
}: {
  client: Client
  open: boolean
  onClose: () => void
}) {
  const allServers = useAuthStore((s) => s.servers)
  const servers = React.useMemo(() => allServers.filter((x) => x.enabled), [allServers])
  const [user] = useCurrentUser()

  const [serverId, setServerId] = React.useState<string>(
    client.tenantServerId ?? servers[0]?.id ?? '',
  )
  const defaultEmail = React.useMemo(
    () => deriveSupportEmail(client.company || client.name),
    [client.company, client.name],
  )
  const [email, setEmail] = React.useState(client.supportEmail || defaultEmail)
  const [running, setRunning] = React.useState(false)
  const [steps, setSteps] = React.useState<ProvStep[]>([])
  const [finished, setFinished] = React.useState(false)
  // Estado intermediário compartilhado entre passos (sobrevive a retries).
  const prov = React.useRef<ProvState>({})

  React.useEffect(() => {
    if (!open) return
    setServerId(client.tenantServerId ?? servers[0]?.id ?? '')
    setEmail(client.supportEmail || defaultEmail)
    setSteps([])
    setFinished(false)
    setRunning(false)
    prov.current = {}
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchStep = (key: string, patch: Partial<ProvStep>) =>
    setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, ...patch } : s)))

  const provision = async () => {
    const server = servers.find((s) => s.id === serverId)
    if (!server) {
      toast.error('Selecione um servidor')
      return
    }
    const finalEmail = email.trim()
    if (!finalEmail.includes('@')) {
      toast.error('E-mail de suporte inválido')
      return
    }

    const connTypes = client.briefingConfig?.connectionTypes ?? []
    const officialOnly =
      connTypes.includes('api_oficial') && !connTypes.includes('api_comum')
    const briefingUsers = client.briefingData?.users ?? []
    const isRetry = steps.length > 0

    // Primeira execução: confirma recriação e monta a lista de passos.
    if (!isRetry) {
      if (client.tenantId) {
        const ok = window.confirm(
          'Este cliente já tem um tenant.\n\n' +
            'Provisionar de novo vai gerar um NOVO tenant (e novos canal/API/filas). ' +
            'Pode duplicar no sistema do cliente. Deseja continuar?',
        )
        if (!ok) return
      }
      setSteps(buildSteps(officialOnly, briefingUsers.length > 0))
    }

    const tenantPassword =
      db.getSettings().defaultTenantPassword || FALLBACK_TENANT_PASSWORD
    setRunning(true)

    // Executa cada passo ainda não concluído, parando no primeiro erro.
    const order = (isRetry ? steps : buildSteps(officialOnly, briefingUsers.length > 0)).map(
      (s) => s.key,
    )
    try {
      for (const key of order) {
        const st = (isRetry ? steps : []).find((s) => s.key === key)
        if (st && (st.status === 'ok' || st.status === 'skip')) continue
        patchStep(key, { status: 'running', detail: undefined })
        try {
          // eslint-disable-next-line no-await-in-loop
          const detail = await runStep(key, {
            client,
            server,
            finalEmail,
            tenantPassword,
            user,
            officialOnly,
            prov: prov.current,
          })
          patchStep(key, { status: 'ok', detail })
        } catch (err) {
          patchStep(key, { status: 'error', detail: extractErrorMessage(err, 'erro') })
          toast.error(`Falha em "${LABELS[key]}": ${extractErrorMessage(err, 'erro')}`)
          setRunning(false)
          return
        }
      }
      // Tudo certo — avança etapa e finaliza.
      const preSetup = ['lead', 'welcome', 'contract', 'briefing']
      const advancedStage = preSetup.includes(client.stage) ? 'setup' : client.stage
      if (advancedStage !== client.stage) {
        db.updateClient(client.id, { stage: advancedStage })
        db.addLog(client.id, 'Etapa: Configuração', 'Avançado automaticamente após provisionar')
      }
      setFinished(true)
      toast.success('Provisionamento concluído')
    } finally {
      setRunning(false)
    }
  }

  const hasError = steps.some((s) => s.status === 'error')
  const showSteps = steps.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Provisionar tenant"
      description={
        client.tenantId
          ? 'Este cliente já possui um tenant — provisionar de novo cria um novo vínculo.'
          : 'Cria o tenant, canal, API, filas e usuários a partir do briefing.'
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={running}>
            {finished ? 'Fechar' : 'Cancelar'}
          </Button>
          {!finished && (
            <Button
              onClick={provision}
              loading={running}
              leftIcon={!running ? <CheckCircle2 className="h-4 w-4" /> : undefined}
            >
              {hasError ? 'Tentar novamente' : showSteps ? 'Continuar' : 'Provisionar tudo'}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/45">
            Servidor
          </div>
          {servers.length === 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              Nenhum servidor habilitado. Ative um em Configurações.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {servers.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  selected={serverId === s.id}
                  onSelect={() => setServerId(s.id)}
                />
              ))}
            </div>
          )}
        </div>

        <Input
          label="E-mail de suporte"
          leftIcon={<Mail className="h-4 w-4" />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint={`Senha padrão: ${db.getSettings().defaultTenantPassword || FALLBACK_TENANT_PASSWORD}`}
        />

        {showSteps && (
          <div className="rounded-xl border border-line bg-elevate/[0.02] p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-foreground/45">
              Progresso
            </div>
            <ul className="space-y-1.5">
              {steps.map((s) => (
                <li key={s.key} className="flex items-center gap-2.5 text-sm">
                  <StepIcon status={s.status} />
                  <span
                    className={cn(
                      'flex-1',
                      s.status === 'ok'
                        ? 'text-foreground/80'
                        : s.status === 'error'
                          ? 'text-danger'
                          : s.status === 'skip'
                            ? 'text-foreground/35 line-through'
                            : 'text-foreground/65',
                    )}
                  >
                    {s.label}
                  </span>
                  {s.detail && (
                    <span
                      className={cn(
                        'truncate text-[11px]',
                        s.status === 'error' ? 'text-danger/80' : 'text-foreground/40',
                      )}
                    >
                      {s.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Tipos + máquina de passos do provisionamento ──────────────────────────────

type StepStatus = 'idle' | 'running' | 'ok' | 'skip' | 'error'
interface ProvStep {
  key: string
  label: string
  status: StepStatus
  detail?: string
}
interface ProvState {
  tenantId?: string | number
  userId?: string | number
  apiId?: string
  apiToken?: string
  channelCreated?: boolean
}

const LABELS: Record<string, string> = {
  tenant: 'Criar tenant',
  channel: 'Criar canal (WhatsApp)',
  api: 'Criar API',
  queues: 'Criar filas (setores)',
  users: 'Criar usuários',
}

function buildSteps(officialOnly: boolean, hasUsers: boolean): ProvStep[] {
  const list: ProvStep[] = [{ key: 'tenant', label: LABELS.tenant, status: 'idle' }]
  if (!officialOnly) {
    list.push({ key: 'channel', label: LABELS.channel, status: 'idle' })
    list.push({ key: 'api', label: LABELS.api, status: 'idle' })
    list.push({ key: 'queues', label: LABELS.queues, status: 'idle' })
  }
  if (hasUsers) list.push({ key: 'users', label: LABELS.users, status: 'idle' })
  return list
}

interface StepCtx {
  client: Client
  server: ServerConfig
  finalEmail: string
  tenantPassword: string
  user: string
  officialOnly: boolean
  prov: ProvState
}

/** Executa um passo do provisionamento, persistindo o que conseguiu no cliente. */
async function runStep(key: string, ctx: StepCtx): Promise<string | undefined> {
  const { client, server, finalEmail, tenantPassword, user, prov } = ctx
  // Sempre parte do checklist mais recente (passos anteriores já gravaram).
  const currentChecklist = () => db.getClient(client.id)?.deliveryChecklist ?? client.deliveryChecklist

  if (key === 'tenant') {
    const created = await tenantsApi.store(server, {
      status: 'active',
      name: client.company || client.name,
      maxUsers: 10,
      maxConnections: 10,
      acceptTerms: true,
      email: finalEmail,
      password: tenantPassword,
      userName: client.name || 'Suporte',
      profile: 'admin',
    })
    const t = created as Tenant
    prov.tenantId = t.id ?? undefined
    prov.userId =
      (pick(t, 'userId', 'user_id', 'ownerId', 'owner_id', 'adminUserId') as
        | string
        | number
        | undefined) ?? 1
    prov.apiId = t.apiId != null ? String(t.apiId) : String(t.id ?? '')
    const enriched = enrichChecklistFromBriefing(
      client.deliveryChecklist,
      client.briefingData,
      client.briefingConfig,
    )
    db.updateClient(client.id, {
      tenantId: prov.tenantId !== undefined ? String(prov.tenantId) : undefined,
      tenantServerId: server.id,
      tenantApiId: prov.apiId || undefined,
      tenantName: typeof t.name === 'string' ? t.name : undefined,
      supportEmail: finalEmail,
      supportPassword: tenantPassword,
      deliveryChecklist: setChecklistItem(enriched, 'tenant_created', true, user),
    })
    db.addLog(client.id, 'Tenant criado', `${server.name} · ${finalEmail}`)
    return server.name
  }

  if (key === 'channel') {
    const sessionType = String(client.briefingData?.whatsappType || 'baileys')
    const session = await tenantsApi.createSession(server, {
      tenant: prov.tenantId ?? 0,
      name: `${client.company || client.name} WhatsApp`.slice(0, 60),
      status: 'DISCONNECTED',
      type: sessionType,
    })
    prov.channelCreated = true
    ;(prov as Record<string, unknown>).sessionId = pick(session, 'id', 'sessionId', 'session_id')
    db.updateClient(client.id, {
      deliveryChecklist: setChecklistItem(currentChecklist(), 'channels_created', true, 'Sistema'),
    })
    return sessionType
  }

  if (key === 'api') {
    prov.apiToken = genToken()
    const apiResp = await tenantsApi.createApi(server, {
      name: `API ${client.company || client.name}`.slice(0, 60),
      sessionId: (prov as Record<string, unknown>).sessionId as string | number | undefined,
      urlServiceStatus: null,
      urlMessageStatus: null,
      userId: prov.userId as string | number,
      authToken: prov.apiToken,
      tenant: prov.tenantId ?? 0,
    })
    const createdApiId = pick(apiResp, 'id', 'apiId', 'api_id')
    if (createdApiId != null) prov.apiId = String(createdApiId)
    db.updateClient(client.id, {
      tenantApiId: prov.apiId || undefined,
      tenantApiToken: prov.apiToken || undefined,
    })
    return undefined
  }

  if (key === 'queues') {
    const sectors = collectSectors(client)
    if (sectors.length === 0) return 'sem setores'
    let queues = 0
    for (const q of sectors) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await queuesApi.create(server, prov.apiId ?? '', { queue: q, isActive: true }, prov.apiToken)
        queues++
      } catch {
        /* fila duplicada / erro pontual — segue */
      }
    }
    db.updateClient(client.id, {
      deliveryChecklist: setChecklistItem(currentChecklist(), 'queues_created', true, 'Sistema'),
    })
    return `${queues} fila(s)`
  }

  if (key === 'users') {
    const briefingUsers = client.briefingData?.users ?? []
    const defaultPassword = db.getSettings().defaultTenantPassword || FALLBACK_TENANT_PASSWORD
    let success = 0
    const failures: string[] = []
    for (const u of briefingUsers) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await usersApi.create(
          server,
          prov.apiId ?? '',
          {
            tenant_id: prov.tenantId,
            name: u.name,
            email: u.email,
            password: defaultPassword,
            role: u.role || 'user',
            permissions: [u.role || 'user'],
          },
          prov.apiToken,
        )
        success++
      } catch (err) {
        failures.push(`${u.name}: ${extractErrorMessage(err, 'falha')}`)
      }
    }
    if (success > 0) {
      db.updateClient(client.id, {
        deliveryChecklist: setChecklistItem(currentChecklist(), 'users_created', true, user),
      })
      db.addLog(client.id, 'Usuários criados', `${success} criado(s) em ${server.name}`)
    }
    if (failures.length > 0) {
      throw new Error(`${success} criado(s), ${failures.length} falharam: ${failures[0]}`)
    }
    return `${success} usuário(s)`
  }

  return undefined
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-accent" />
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-success" />
  if (status === 'error') return <AlertCircle className="h-4 w-4 text-danger" />
  if (status === 'skip') return <MinusCircle className="h-4 w-4 text-foreground/30" />
  return <Circle className="h-4 w-4 text-foreground/25" />
}

function ServerCard({
  server,
  selected,
  onSelect,
}: {
  server: ServerConfig
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-accent/50 bg-accent/[0.08] ring-1 ring-accent/30'
          : 'border-line bg-elevate/[0.02] hover:border-line-soft hover:bg-elevate/[0.04]',
      )}
    >
      <span
        className={cn(
          'grid h-8 w-8 place-items-center rounded-lg ring-1',
          selected
            ? 'bg-accent/15 text-accent ring-accent/30'
            : 'bg-elevate/[0.04] text-foreground/65 ring-line',
        )}
      >
        <ServerIcon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{server.name}</div>
        <div className="truncate text-[10px] text-foreground/40">
          {server.baseUrl.replace(/^https?:\/\//, '')}
        </div>
      </div>
    </button>
  )
}
