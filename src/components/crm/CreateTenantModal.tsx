import * as React from 'react'
import {
  CheckCircle2,
  Loader2,
  Mail,
  Server as ServerIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { tenantsApi } from '@/api/tenants'
import { queuesApi } from '@/api/queues'
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
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setServerId(client.tenantServerId ?? servers[0]?.id ?? '')
    setEmail(client.supportEmail || defaultEmail)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
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
    // Se já existe tenant, "Recriar" gera um NOVO tenant — confirma e NÃO
    // reprovisiona canal/API/filas pra não duplicar no sistema do cliente.
    const isRecreate = Boolean(client.tenantId)
    if (isRecreate) {
      const ok = window.confirm(
        'Este cliente já tem um tenant.\n\n' +
          'Recriar vai gerar um NOVO tenant e NÃO refaz canal, API e filas ' +
          'automaticamente (pra evitar duplicar). Deseja continuar?',
      )
      if (!ok) return
    }
    setCreating(true)
    const tenantPassword =
      db.getSettings().defaultTenantPassword || FALLBACK_TENANT_PASSWORD
    try {
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
      const tenantId = t.id ?? undefined
      const userId = pick(t, 'userId', 'user_id', 'ownerId', 'owner_id', 'adminUserId') ?? 1

      // Tipo de conexão configurado no briefing. Canal + API são criados
      // automaticamente apenas para API NÃO OFICIAL (a API só pode ser criada
      // depois do canal). Para API Oficial, isso é feito pelo fluxo da Meta.
      const connTypes = client.briefingConfig?.connectionTypes ?? []
      const officialOnly =
        connTypes.includes('api_oficial') && !connTypes.includes('api_comum')
      const sessionType = String(client.briefingData?.whatsappType || 'baileys')

      // apiId começa com o que a resposta do tenant trouxe (fallback p/ id do
      // tenant, mantendo o comportamento anterior quando não provisionamos).
      let apiId = t.apiId != null ? String(t.apiId) : String(t.id ?? '')
      // Token da API do tenant — definido por nós ao criar a API e usado pra
      // autenticar as chamadas /v2/api/external/{apiId}/... (filas, usuários).
      let apiToken = ''
      const steps: string[] = []

      if (!officialOnly && tenantId != null && !isRecreate) {
        try {
          // 1) Criar canal (sessão WhatsApp)
          const session = await tenantsApi.createSession(server, {
            tenant: tenantId,
            name: `${client.company || client.name} WhatsApp`.slice(0, 60),
            status: 'DISCONNECTED',
            type: sessionType,
          })
          const sessionId = pick(session, 'id', 'sessionId', 'session_id')
          steps.push('canal')

          // 2) Criar API vinculada à sessão
          apiToken = genToken()
          const apiResp = await tenantsApi.createApi(server, {
            name: `API ${client.company || client.name}`.slice(0, 60),
            sessionId: sessionId as string | number | undefined,
            urlServiceStatus: null,
            urlMessageStatus: null,
            userId: userId as string | number,
            authToken: apiToken,
            tenant: tenantId,
          })
          const createdApiId = pick(apiResp, 'id', 'apiId', 'api_id')
          if (createdApiId != null) {
            apiId = String(createdApiId)
            steps.push('API')
          }

          // 3) Criar filas a partir dos setores do briefing.
          // Autentica com o token da API do tenant (apiToken), não o do servidor.
          if (apiId) {
            const sectors = collectSectors(client)
            let queues = 0
            for (const q of sectors) {
              try {
                await queuesApi.create(server, apiId, { queue: q, isActive: true }, apiToken)
                queues++
              } catch {
                /* fila duplicada / erro pontual — segue */
              }
            }
            if (queues > 0) steps.push(`${queues} fila(s)`)
          }
        } catch (err) {
          toast.error(
            'Tenant criado, mas falhou ao provisionar canal/API: ' +
              extractErrorMessage(err, 'erro'),
          )
        }
      }

      const enriched = enrichChecklistFromBriefing(
        client.deliveryChecklist,
        client.briefingData,
        client.briefingConfig,
      )
      const checked = setChecklistItem(enriched, 'tenant_created', true, user)

      // Criar o tenant já avança o cliente para a etapa de Configuração
      // (a menos que ele já esteja em uma etapa posterior).
      const preSetup = ['lead', 'welcome', 'contract', 'briefing']
      const advancedStage = preSetup.includes(client.stage) ? 'setup' : client.stage

      db.updateClient(client.id, {
        tenantId: tenantId !== undefined ? String(tenantId) : undefined,
        tenantServerId: server.id,
        tenantApiId: apiId || undefined,
        tenantApiToken: apiToken || undefined,
        tenantName: typeof t.name === 'string' ? t.name : undefined,
        supportEmail: finalEmail,
        supportPassword: tenantPassword,
        deliveryChecklist: checked,
        stage: advancedStage,
      })
      db.addLog(
        client.id,
        'Tenant criado',
        `${server.name} · ${finalEmail}${steps.length ? ` · ${steps.join(', ')}` : ''}`,
      )
      if (advancedStage !== client.stage) {
        db.addLog(client.id, 'Etapa: Configuração', 'Avançado automaticamente após criar o tenant')
      }
      toast.success(
        steps.length
          ? `Tenant provisionado em ${server.name} (${steps.join(', ')})`
          : `Tenant criado em ${server.name}`,
      )
      onClose()
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Falha ao criar tenant'))
    } finally {
      setCreating(false)
    }
  }

  const alreadyCreated = Boolean(client.tenantId)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Criar tenant"
      description={
        alreadyCreated
          ? 'Este cliente já possui um tenant — criar novamente vai sobrescrever o vínculo.'
          : 'Selecione o servidor e confirme o e-mail de suporte para criar o tenant.'
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={creating}>
            Cancelar
          </Button>
          <Button
            onClick={create}
            loading={creating}
            leftIcon={
              !creating ? <CheckCircle2 className="h-4 w-4" /> : undefined
            }
          >
            Criar tenant
          </Button>
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

        {creating && (
          <p className="inline-flex items-center gap-2 text-xs text-foreground/55">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Criando tenant no servidor selecionado…
          </p>
        )}
      </div>
    </Modal>
  )
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
