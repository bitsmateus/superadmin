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
import { cn, deriveSupportEmail, normalizeWhatsappNumber } from '@/lib/utils'
import type { Client } from '@/types/client'

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

/**
 * Extrai um id de respostas da NX em formatos variados: o objeto direto, ou
 * aninhado em wrappers comuns ({ session }, { whatsapp }, { data }...), e com
 * nomes de campo variados (id, sessionId, whatsappId...).
 */
function extractId(resp: unknown): string | number | undefined {
  const idKeys = ['id', 'sessionId', 'session_id', 'whatsappId', 'whatsapp_id', 'channelId', 'apiId', 'api_id']
  const wrappers = ['session', 'whatsapp', 'channel', 'data', 'result', 'connection', 'api', 'tenant']
  // 1) direto no objeto
  const direct = pick(resp, ...idKeys)
  if (direct != null) return direct as string | number
  // 2) dentro de um wrapper conhecido
  for (const w of wrappers) {
    const inner = pick(resp, w)
    const v = pick(inner, ...idKeys)
    if (v != null) return v as string | number
  }
  return undefined
}

/** Heurística de UUID (o apiId externo da NX é um UUID, não o id numérico). */
function looksUuid(v: unknown): v is string {
  return typeof v === 'string' && /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(v)
}

/**
 * Busca recursiva pelo primeiro UUID na resposta. O apiId externo é um UUID
 * (com hifens); o token (plainToken) é hex SEM hifens, então não é confundido.
 * Prefere valores em chaves que mencionam "api".
 */
function deepFindUuid(obj: unknown, depth = 0): string | undefined {
  if (obj == null || depth > 5) return undefined
  if (typeof obj === 'string') return looksUuid(obj) ? obj : undefined
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const f = deepFindUuid(it, depth + 1)
      if (f) return f
    }
    return undefined
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
    // 1ª passada: chave com "api" e valor UUID (mais provável de ser o apiId).
    for (const [k, v] of entries) {
      if (/api/i.test(k) && looksUuid(v)) return v
    }
    // 2ª passada: qualquer UUID no objeto.
    for (const [, v] of entries) {
      const f = deepFindUuid(v, depth + 1)
      if (f) return f
    }
  }
  return undefined
}

/**
 * Escolhe o apiId EXTERNO (UUID) usado em /v2/api/external/{apiId}/... entre os
 * vários campos possíveis da resposta. Prefere um valor em formato UUID; só cai
 * no id numérico se não houver UUID (que provavelmente não serve, mas evita
 * vazio). Importante porque a URL externa NÃO aceita o id numérico da apiConfig.
 */
function pickExternalApiId(...objs: (Record<string, unknown> | undefined)[]): string | undefined {
  const cands: unknown[] = []
  for (const o of objs) {
    if (!o) continue
    cands.push(o.apiId, o.api_id, o.apiID, o.uuid, o.externalId, o.external_id, o.id)
  }
  // 1) UUID direto nos campos conhecidos.
  const uuid = cands.find(looksUuid)
  if (uuid) return String(uuid)
  // 2) UUID em qualquer lugar da resposta (deep search) — o apiId externo é UUID.
  for (const o of objs) {
    const deep = deepFindUuid(o)
    if (deep) return deep
  }
  // 3) Fallback: primeiro valor não vazio (provavelmente id numérico — não ideal).
  const any = cands.find((v) => v != null && v !== '')
  return any != null ? String(any) : undefined
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
  // Quando o cliente já tem tenant, por padrão reaproveitamos ele e criamos só
  // o que falta. Marcar isto força criar um tenant NOVO (novo vínculo).
  const [recreate, setRecreate] = React.useState(false)
  // Estado intermediário compartilhado entre passos (sobrevive a retries).
  const prov = React.useRef<ProvState>({})

  React.useEffect(() => {
    if (!open) return
    setServerId(client.tenantServerId ?? servers[0]?.id ?? '')
    setEmail(client.supportEmail || defaultEmail)
    setSteps([])
    setFinished(false)
    setRunning(false)
    setRecreate(false)
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

    const briefingUsers = client.briefingData?.users ?? []
    const isRetry = steps.length > 0

    // Reuso: o cliente já tem tenant e NÃO pediu pra recriar do zero. Nesse
    // caso pulamos "Criar tenant" (e o canal, se a API já existe) e criamos só
    // o que falta. Sem reuso, ao reprovisionar a NX tentaria criar um tenant
    // duplicado (mesmo e-mail) e devolve 500, travando filas/API/usuários.
    const reuseTenant = Boolean(client.tenantId) && !recreate
    const hasApi = Boolean(client.tenantApiId && client.tenantApiToken)

    // Primeira execução: confirma recriação (se pedida) e monta os passos.
    let working: ProvStep[]
    if (isRetry) {
      working = steps
    } else {
      if (recreate && client.tenantId) {
        const ok = window.confirm(
          'Recriar do zero vai gerar um NOVO tenant (e novos canal/API/filas). ' +
            'Pode duplicar no sistema do cliente. Deseja continuar?',
        )
        if (!ok) return
      }
      working = buildSteps(briefingUsers.length > 0)
      if (reuseTenant) {
        working = working.map((s) => {
          if (s.key === 'tenant') return { ...s, status: 'skip' as StepStatus, detail: 'tenant já existe' }
          if (s.key === 'channel' && hasApi)
            return { ...s, status: 'skip' as StepStatus, detail: 'API já existe' }
          return s
        })
      }
      setSteps(working)
    }

    // Semeia o estado com o tenant/API já salvos no cliente (modo reuso) para
    // os passos seguintes (canal/API/filas/usuários) usarem o tenant existente.
    if (reuseTenant) {
      const c = db.getClient(client.id)
      if (prov.current.tenantId == null && c?.tenantId) prov.current.tenantId = c.tenantId
      if (prov.current.apiId == null && c?.tenantApiId) prov.current.apiId = c.tenantApiId
      if (prov.current.apiToken == null && c?.tenantApiToken)
        prov.current.apiToken = c.tenantApiToken
      // Como o passo "Criar tenant" é pulado no reuso, preenche "Criado em"
      // aqui também, conforme o servidor selecionado.
      db.updateClient(client.id, {
        platformApp: server.id === 'app',
        platformWeb: server.id === 'web',
        platformChat: server.id === 'chat',
      })
    }

    const tenantPassword =
      db.getSettings().defaultTenantPassword || FALLBACK_TENANT_PASSWORD
    setRunning(true)

    // Executa cada passo ainda não concluído, parando no primeiro erro.
    try {
      for (const step of working) {
        if (step.status === 'ok' || step.status === 'skip') continue
        patchStep(step.key, { status: 'running', detail: undefined })
        try {
          // eslint-disable-next-line no-await-in-loop
          const detail = await runStep(step.key, {
            client,
            server,
            finalEmail,
            tenantPassword,
            user,
            prov: prov.current,
          })
          patchStep(step.key, { status: 'ok', detail })
        } catch (err) {
          patchStep(step.key, { status: 'error', detail: extractErrorMessage(err, 'erro') })
          toast.error(`Falha em "${LABELS[step.key]}": ${extractErrorMessage(err, 'erro')}`)
          setRunning(false)
          return
        }
      }
      // Tudo certo — avança etapa e finaliza.
      const preSetup = ['lead', 'welcome', 'contract', 'briefing', 'setup_start']
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
          ? 'Este cliente já possui um tenant — por padrão reaproveitamos ele e criamos só o que falta (canal, API, filas, usuários).'
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
              {hasError
                ? 'Tentar novamente'
                : showSteps
                  ? 'Continuar'
                  : client.tenantId && !recreate
                    ? 'Criar o que falta'
                    : 'Provisionar tudo'}
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

        {client.tenantId && !showSteps && (
          <label className="flex items-start gap-2 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5 text-sm text-foreground/75">
            <input
              type="checkbox"
              checked={recreate}
              onChange={(e) => setRecreate(e.target.checked)}
              disabled={running}
              className="mt-0.5 h-4 w-4 accent-[#4F8EF7]"
            />
            <span>
              Recriar tenant do zero (gera um <strong>novo</strong> vínculo)
              <span className="mt-0.5 block text-[11px] text-foreground/45">
                Deixe desmarcado para reaproveitar o tenant atual e só criar canal, API,
                filas e usuários que faltam.
              </span>
            </span>
          </label>
        )}

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

function buildSteps(hasUsers: boolean): ProvStep[] {
  // O canal/sessão é sempre criado: além de conectar o WhatsApp, é ele que gera
  // a API do tenant + o token (a NX cria API junto com o canal). Sem sessionId,
  // o endpoint de criar API falha ("sessionId is a required field"), e sem o
  // token a criação de usuários/filas falha ("Invalid token"). Por isso, mesmo
  // na API Oficial, o canal precisa existir para hospedar usuários e filas.
  const list: ProvStep[] = [
    { key: 'tenant', label: LABELS.tenant, status: 'idle' },
    { key: 'channel', label: LABELS.channel, status: 'idle' },
    { key: 'api', label: LABELS.api, status: 'idle' },
    { key: 'queues', label: LABELS.queues, status: 'idle' },
  ]
  if (hasUsers) list.push({ key: 'users', label: LABELS.users, status: 'idle' })
  return list
}

interface StepCtx {
  client: Client
  server: ServerConfig
  finalEmail: string
  tenantPassword: string
  user: string
  prov: ProvState
}

/** Executa um passo do provisionamento, persistindo o que conseguiu no cliente. */
async function runStep(key: string, ctx: StepCtx): Promise<string | undefined> {
  const { client, server, finalEmail, tenantPassword, user, prov } = ctx
  // Sempre parte do checklist mais recente (passos anteriores já gravaram).
  const currentChecklist = () => db.getClient(client.id)?.deliveryChecklist ?? client.deliveryChecklist

  if (key === 'tenant') {
    // Limite de usuários do tenant = o configurado no briefing (ou o nº de
    // usuários preenchidos, o que for maior) + 1 extra (admin/suporte). Sem
    // config nem usuários, cai num padrão de 10.
    const briefingMax = client.briefingConfig?.maxUsers ?? 0
    const filledUsers = client.briefingData?.users?.length ?? 0
    const baseUsers = Math.max(briefingMax, filledUsers)
    const maxUsers = baseUsers > 0 ? baseUsers + 1 : 10
    const created = await tenantsApi.store(server, {
      status: 'active',
      name: client.company || client.name,
      maxUsers,
      maxConnections: 10,
      acceptTerms: true,
      email: finalEmail,
      password: tenantPassword,
      userName: 'SUPORTE NX',
      profile: 'admin',
    })
    // A NX devolve { tenant: {...}, user: {...} }. Aceita também formato plano.
    const resp = (created ?? {}) as Record<string, unknown>
    const tenantObj = (
      resp.tenant && typeof resp.tenant === 'object' ? resp.tenant : resp
    ) as Record<string, unknown>
    const userObj = (
      resp.user && typeof resp.user === 'object' ? resp.user : undefined
    ) as Record<string, unknown> | undefined

    prov.tenantId =
      (pick(tenantObj, 'id', 'tenantId', 'tenant_id') as string | number | undefined) ?? undefined
    prov.userId =
      (pick(userObj ?? {}, 'id', 'userId', 'user_id') as string | number | undefined) ??
      (pick(tenantObj, 'ownerId', 'owner_id', 'userId', 'adminUserId') as
        | string
        | number
        | undefined) ??
      1
    // Só usa apiId em UUID (externo). Se o tenant não devolver, o passo do
    // canal/API captura. Não cai no tenantId numérico (não serve na URL externa).
    const tenantApiId = pickExternalApiId(tenantObj)
    if (tenantApiId) prov.apiId = tenantApiId

    const tName = pick(tenantObj, 'name')
    const enriched = enrichChecklistFromBriefing(
      client.deliveryChecklist,
      client.briefingData,
      client.briefingConfig,
    )
    db.updateClient(client.id, {
      tenantId: prov.tenantId !== undefined ? String(prov.tenantId) : undefined,
      tenantServerId: server.id,
      tenantApiId: prov.apiId || undefined,
      tenantName: typeof tName === 'string' ? tName : undefined,
      supportEmail: finalEmail,
      supportPassword: tenantPassword,
      // Preenche automaticamente "Criado em" conforme o servidor escolhido.
      platformApp: server.id === 'app',
      platformWeb: server.id === 'web',
      platformChat: server.id === 'chat',
      deliveryChecklist: setChecklistItem(enriched, 'tenant_created', true, user),
    })
    db.addLog(
      client.id,
      'Tenant criado',
      `${server.name} · ${finalEmail} · tenant #${prov.tenantId ?? '?'} · limite ${maxUsers} usuário(s)`,
    )
    return `${server.name} · ${maxUsers} usuário(s)`
  }

  if (key === 'channel') {
    // Resolve o id do tenant: do passo anterior (memória) OU do que ficou salvo
    // no cliente (sobrevive a recarregar a página). Nunca envia 0.
    const tenantId = prov.tenantId ?? db.getClient(client.id)?.tenantId
    if (!tenantId) {
      throw new Error('Tenant criado, mas o id não foi capturado. Recarregue a página e provisione de novo.')
    }
    prov.tenantId = tenantId

    // Um canal por número de WhatsApp do briefing, nomeado com o número
    // normalizado (55+DDD+número). Sem números, cria um canal padrão com o nome
    // da empresa. Tipo sempre "baileys" — é o que cria a API do tenant no NX.
    const numbers = (client.briefingData?.whatsappNumbers ?? [])
      .map((n) => String(n).trim())
      .filter(Boolean)
    const channelNames =
      numbers.length > 0
        ? numbers.map((n) => normalizeWhatsappNumber(n) || n)
        : [`${client.company || client.name} WhatsApp`]

    // A NX cria a API JUNTO com o primeiro canal e devolve tudo aqui:
    //   sessionId -> whatsapp.id · apiId -> api.apiConfig.id · apiToken -> api.plainToken
    const captureFromSession = (session: unknown): string | number | undefined => {
      // Debug: ajuda a confirmar onde vem o apiId (UUID) e o token na resposta.
      try {
        console.log('[provision] createSession resp:', JSON.stringify(session).slice(0, 2500))
      } catch { /* ignore */ }
      const wa = pick(session, 'whatsapp') as Record<string, unknown> | undefined
      const apiWrap = pick(session, 'api') as Record<string, unknown> | undefined
      const apiConfig = pick(apiWrap, 'apiConfig') as Record<string, unknown> | undefined
      const sessionId =
        (pick(wa ?? session, 'id', 'sessionId') as string | number | undefined) ?? extractId(session)
      if (sessionId != null && (prov as Record<string, unknown>).sessionId == null) {
        ;(prov as Record<string, unknown>).sessionId = sessionId
      }
      // apiId EXTERNO (UUID). Não sobrescreve um UUID já capturado por um valor
      // não-UUID (ex.: id numérico de um canal seguinte).
      const apiId = pickExternalApiId(apiConfig, apiWrap, session as Record<string, unknown>)
      if (apiId && (!prov.apiId || looksUuid(apiId) || !looksUuid(prov.apiId))) {
        prov.apiId = apiId
      }
      const apiToken =
        (pick(apiWrap, 'plainToken') as string | undefined) ??
        (pick(apiConfig, 'token', 'authToken') as string | undefined)
      if (apiToken && !prov.apiToken) prov.apiToken = apiToken
      if (prov.userId == null) prov.userId = pick(wa, 'userId') as string | number | undefined
      return sessionId
    }

    let createdChannels = 0
    const channelFailures: string[] = []
    for (let idx = 0; idx < channelNames.length; idx++) {
      const name = channelNames[idx].slice(0, 60)
      try {
        // eslint-disable-next-line no-await-in-loop
        const session = await tenantsApi.createSession(server, {
          tenant: tenantId,
          name,
          status: 'DISCONNECTED',
          type: 'baileys',
        })
        const sid = captureFromSession(session)
        // O primeiro canal é crítico: é ele que gera a API + token.
        if (idx === 0 && sid == null) {
          throw new Error(
            'Canal criado, mas não encontrei o sessionId na resposta. Retorno: ' +
              JSON.stringify(session).slice(0, 200),
          )
        }
        createdChannels++
      } catch (err) {
        if (idx === 0) throw err // sem o primeiro canal não há API — aborta
        channelFailures.push(`${name}: ${extractErrorMessage(err, 'falha')}`)
      }
    }
    prov.channelCreated = true

    db.updateClient(client.id, {
      tenantApiId: prov.apiId || undefined,
      tenantApiToken: prov.apiToken || undefined,
      deliveryChecklist: setChecklistItem(currentChecklist(), 'channels_created', true, 'Sistema'),
    })
    const base = `${createdChannels} canal(is) · baileys`
    return channelFailures.length > 0
      ? `${base} · ${channelFailures.length} falhou(ram)`
      : base
  }

  if (key === 'api') {
    // A API já é criada junto com o canal (vem na resposta do canal). Se já
    // temos apiId + token, não criamos outra (evita duplicar).
    if (prov.apiId && prov.apiToken) {
      db.updateClient(client.id, {
        tenantApiId: prov.apiId,
        tenantApiToken: prov.apiToken,
      })
      return 'criada junto com o canal'
    }
    // Fallback: cria via /tenantCreateApi (se a sessão não tiver trazido a api).
    const tenantId = prov.tenantId ?? db.getClient(client.id)?.tenantId
    if (!tenantId) {
      throw new Error('Tenant id não disponível. Recarregue a página e provisione de novo.')
    }
    if (!prov.apiToken) prov.apiToken = genToken()
    const apiResp = await tenantsApi.createApi(server, {
      name: `API ${client.company || client.name}`.slice(0, 60),
      sessionId: (prov as Record<string, unknown>).sessionId as string | number | undefined,
      urlServiceStatus: null,
      urlMessageStatus: null,
      userId: (prov.userId ?? 1) as string | number,
      authToken: prov.apiToken,
      tenant: tenantId,
    })
    const respApi = pick(apiResp, 'api') as Record<string, unknown> | undefined
    const respApiConfig = pick(respApi, 'apiConfig') as Record<string, unknown> | undefined
    const createdApiId =
      pickExternalApiId(respApiConfig, respApi, apiResp as Record<string, unknown>) ??
      (extractId(apiResp) != null ? String(extractId(apiResp)) : undefined)
    if (createdApiId != null) prov.apiId = String(createdApiId)
    const respToken =
      (pick(respApi, 'plainToken') as string | undefined) ??
      (pick(apiResp, 'plainToken') as string | undefined)
    if (respToken) prov.apiToken = respToken
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
            name: u.name,
            email: u.email,
            password: defaultPassword,
            // NX aceita 'admin' | 'user'. Só admin do briefing vira admin.
            profile: u.role === 'admin' ? 'admin' : 'user',
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
