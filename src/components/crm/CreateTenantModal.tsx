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
      // apiId may be returned as string or number — use id as fallback
      const apiId = t.apiId != null ? String(t.apiId) : String(t.id)

      const enriched = enrichChecklistFromBriefing(
        client.deliveryChecklist,
        client.briefingData,
      )
      const checked = setChecklistItem(enriched, 'tenant_created', true, user)

      db.updateClient(client.id, {
        tenantId: t.id !== undefined ? String(t.id) : undefined,
        tenantServerId: server.id,
        tenantApiId: apiId,
        tenantName: typeof t.name === 'string' ? t.name : undefined,
        supportEmail: finalEmail,
        supportPassword: tenantPassword,
        deliveryChecklist: checked,
      })
      db.addLog(
        client.id,
        'Tenant criado',
        `${server.name} · ${finalEmail}`,
      )
      toast.success(`Tenant criado em ${server.name}`)
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
