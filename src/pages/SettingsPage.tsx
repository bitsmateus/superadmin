import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link as LinkIcon,
  PlugZap,
  Power,
  RefreshCcw,
  RotateCcw,
  Save,
  Server as ServerIcon,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  DEFAULT_SERVERS,
  ServerConfig,
  useAuthStore,
} from '@/store/authStore'
import { DEFAULT_SYSTEM_URL, useAccessStore } from '@/store/accessStore'
import { tenantsApi } from '@/api/tenants'
import { extractErrorMessage } from '@/api/client'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import { CrmSettingsSection } from '@/components/crm/CrmSettingsSection'

export function SettingsPage() {
  const qc = useQueryClient()
  const servers = useAuthStore((s) => s.servers)
  const selectedServerId = useAuthStore((s) => s.selectedServerId)
  const setSelectedServer = useAuthStore((s) => s.setSelectedServer)
  const upsertServer = useAuthStore((s) => s.upsertServer)
  const toggleServer = useAuthStore((s) => s.toggleServer)

  return (
    <>
      <TopBar
        title="Configurações"
        subtitle="Servidores conectados e acesso ao sistema externo"
      />

      <div className="px-8 py-6 space-y-6">
        <SettingsHeader />

        <section className="space-y-4">
          <header className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-white">Servidores</h2>
              <p className="text-xs text-white/45">
                Cada servidor tem sua própria URL e API token. O servidor
                selecionado é usado em todas as páginas; troque pelo switcher
                no rodapé da barra lateral.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                DEFAULT_SERVERS.forEach((s) => upsertServer(s))
                toast.success('Servidores padrão restaurados')
              }}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Restaurar padrões
            </Button>
          </header>

          <div className="grid grid-cols-1 gap-4">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                isSelected={server.id === selectedServerId}
                onSelect={() => setSelectedServer(server.id)}
                onSave={(next) => {
                  upsertServer(next)
                  qc.invalidateQueries()
                  toast.success(`Servidor "${next.name}" salvo`)
                }}
                onToggle={(enabled) => toggleServer(server.id, enabled)}
              />
            ))}
          </div>
        </section>

        <AccessSettings />

        <CrmSettingsSection />
      </div>
    </>
  )
}

function SettingsHeader() {
  const servers = useAuthStore((s) => s.servers)
  const active = useAuthStore((s) =>
    s.servers.find((x) => x.id === s.selectedServerId),
  )
  const enabledCount = servers.filter((s) => s.enabled).length

  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-3">
      <Stat
        icon={<ServerIcon className="h-4 w-4 text-accent" />}
        label="Servidor ativo"
        value={active?.name ?? '—'}
        sub={active?.baseUrl}
      />
      <Stat
        icon={<Power className="h-4 w-4 text-success" />}
        label="Habilitados"
        value={`${enabledCount}/${servers.length}`}
      />
      {import.meta.env.DEV && (
        <Stat
          icon={<PlugZap className="h-4 w-4 text-warning" />}
          label="Modo"
          value="dev + proxy"
          sub="Requisições passam pelo Vite (sem CORS)"
        />
      )}
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.04] ring-1 ring-line">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-white/40">{label}</p>
        <p className="truncate text-sm font-medium text-white">{value}</p>
        {sub && (
          <p className="truncate text-[11px] text-white/40" title={sub}>
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

const serverSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  baseUrl: z
    .string()
    .min(8, 'URL inválida')
    .url('URL inválida — use o formato https://…'),
  apiToken: z.string().min(8, 'Token muito curto'),
  loginUrl: z
    .string()
    .min(8, 'URL inválida')
    .url('URL inválida — use o formato https://…'),
  enabled: z.boolean(),
})

type ServerFormValues = z.infer<typeof serverSchema>

function ServerCard({
  server,
  isSelected,
  onSelect,
  onSave,
  onToggle,
}: {
  server: ServerConfig
  isSelected: boolean
  onSelect: () => void
  onSave: (next: ServerConfig) => void
  onToggle: (enabled: boolean) => void
}) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty, isValid },
  } = useForm<ServerFormValues>({
    resolver: zodResolver(serverSchema),
    mode: 'onChange',
    defaultValues: {
      name: server.name,
      baseUrl: server.baseUrl,
      apiToken: server.apiToken,
      loginUrl: server.loginUrl,
      enabled: server.enabled,
    },
  })

  const [showToken, setShowToken] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<
    { ok: true; count: number } | { ok: false; message: string } | null
  >(null)

  React.useEffect(() => {
    reset({
      name: server.name,
      baseUrl: server.baseUrl,
      apiToken: server.apiToken,
      loginUrl: server.loginUrl,
      enabled: server.enabled,
    })
  }, [server, reset])

  const onSubmit = (values: ServerFormValues) => {
    const next: ServerConfig = {
      ...server,
      name: values.name.trim(),
      baseUrl: values.baseUrl.replace(/\/$/, ''),
      apiToken: values.apiToken.trim(),
      loginUrl: values.loginUrl.trim().replace(/\/$/, ''),
      enabled: values.enabled,
    }
    onSave(next)
    reset({
      name: next.name,
      baseUrl: next.baseUrl,
      apiToken: next.apiToken,
      loginUrl: next.loginUrl,
      enabled: next.enabled,
    })
    setTestResult(null)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const values = watch()
    const next: ServerConfig = {
      ...server,
      name: values.name.trim(),
      baseUrl: values.baseUrl.replace(/\/$/, ''),
      apiToken: values.apiToken.trim(),
      loginUrl: values.loginUrl.trim().replace(/\/$/, ''),
      enabled: values.enabled,
    }
    onSave(next)
    onSelect()
    try {
      await new Promise((r) => setTimeout(r, 60))
      const list = await tenantsApi.list(next)
      setTestResult({ ok: true, count: list.length })
      toast.success(`${next.name}: ${list.length} tenant(s)`)
    } catch (err) {
      const message = extractErrorMessage(err, 'Falha ao conectar')
      setTestResult({ ok: false, message })
      toast.error(message)
    } finally {
      setTesting(false)
    }
  }

  const copy = async (value: string, label: string) => {
    const ok = await copyToClipboard(value)
    if (ok) {
      toast.success(`${label} copiado`)
    } else {
      toast.error('Não foi possível copiar')
    }
  }

  const current = watch()

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className={cn(
        'rounded-xl border bg-card transition-colors',
        isSelected
          ? 'border-accent/40 ring-1 ring-accent/20'
          : 'border-line',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'grid h-8 w-8 place-items-center rounded-lg ring-1',
              isSelected
                ? 'bg-accent/15 text-accent ring-accent/30'
                : 'bg-white/[0.04] text-white/65 ring-line',
            )}
          >
            <ServerIcon className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-white">{server.name}</h3>
            <p className="text-[11px] text-white/40">{server.id}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSelected && (
            <Badge tone="info" dot>
              Selecionado
            </Badge>
          )}
          <label className="flex items-center gap-2 rounded-md border border-line bg-white/[0.02] px-2 py-1 text-[11px] text-white/70 cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[#4F8EF7]"
              {...register('enabled')}
              onChange={(e) => {
                register('enabled').onChange(e)
                onToggle(e.target.checked)
              }}
            />
            Habilitado
          </label>
          {!isSelected && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onSelect}
            >
              Usar este
            </Button>
          )}
        </div>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nome"
            placeholder="Chat"
            {...register('name')}
            error={errors.name?.message}
          />
          <Input
            label="Base URL"
            placeholder="https://chatapi.nxsystems.com.br"
            leftIcon={<LinkIcon className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => copy(current.baseUrl, 'URL')}
                className="pointer-events-auto text-white/40 hover:text-white/80"
                aria-label="Copiar URL"
              >
                <Copy className="h-4 w-4" />
              </button>
            }
            {...register('baseUrl')}
            error={errors.baseUrl?.message}
          />
        </div>

        <Input
          label="URL de Login (front-end)"
          placeholder="https://chat.nxsystems.com.br/login"
          leftIcon={<ExternalLink className="h-4 w-4" />}
          rightIcon={
            <button
              type="button"
              onClick={() => copy(current.loginUrl, 'URL')}
              className="pointer-events-auto text-white/40 hover:text-white/80"
              aria-label="Copiar URL"
            >
              <Copy className="h-4 w-4" />
            </button>
          }
          {...register('loginUrl')}
          error={errors.loginUrl?.message}
          hint="Aberta ao clicar em 'Acessar' nos tenants deste servidor."
        />

        <Input
          label="API Token"
          type={showToken ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          leftIcon={<KeyRound className="h-4 w-4" />}
          rightIcon={
            <div className="pointer-events-auto flex items-center gap-2 text-white/40">
              <button
                type="button"
                onClick={() => copy(current.apiToken, 'Token')}
                className="hover:text-white/80"
                aria-label="Copiar token"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="hover:text-white/80"
                aria-label={showToken ? 'Ocultar' : 'Mostrar'}
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          }
          {...register('apiToken')}
          error={errors.apiToken?.message}
          hint="Enviado como Authorization: Bearer {apiToken}."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={testConnection}
              loading={testing}
              leftIcon={
                !testing ? <RefreshCcw className="h-3.5 w-3.5" /> : undefined
              }
            >
              Testar conexão
            </Button>
            {testResult && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs',
                  testResult.ok ? 'text-success' : 'text-danger',
                )}
              >
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> OK —{' '}
                    {testResult.count} tenant(s)
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" /> {testResult.message}
                  </>
                )}
              </span>
            )}
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!isDirty || !isValid}
            leftIcon={<Save className="h-3.5 w-3.5" />}
          >
            Salvar alterações
          </Button>
        </div>
      </div>
    </form>
  )
}

const accessSchema = z.object({
  masterkey: z.string().min(0).max(2048),
  systemUrl: z
    .string()
    .min(8, 'URL inválida')
    .url('URL inválida — use o formato https://…'),
})
type AccessFormValues = z.infer<typeof accessSchema>

function AccessSettings() {
  const {
    masterkey,
    systemUrl,
    setMasterkey,
    clearMasterkey,
    setSystemUrl,
    resetSystemUrl,
  } = useAccessStore()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isValid },
  } = useForm<AccessFormValues>({
    resolver: zodResolver(accessSchema),
    mode: 'onChange',
    defaultValues: { masterkey: masterkey ?? '', systemUrl },
  })

  const [showKey, setShowKey] = React.useState(false)

  const onSubmit = (values: AccessFormValues) => {
    const url = values.systemUrl.trim()
    setSystemUrl(url)
    if (values.masterkey.trim()) setMasterkey(values.masterkey.trim())
    else clearMasterkey()
    reset({ masterkey: values.masterkey.trim(), systemUrl: url })
    toast.success('Configurações de acesso salvas')
  }

  return (
    <section>
      <header className="mb-3">
        <h2 className="text-sm font-medium text-white">Acesso ao sistema externo</h2>
        <p className="text-xs text-white/45">
          Masterkey lembrada e URL aberta pelo botão{' '}
          <span className="text-white/70">Acessar</span> de cada tenant.
        </p>
      </header>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-line bg-card p-5 space-y-4">
            <Input
              label="Masterkey"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Cole aqui sua masterkey"
              leftIcon={<KeyRound className="h-4 w-4" />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Ocultar' : 'Mostrar'}
                  className="pointer-events-auto text-white/40 hover:text-white/80"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
              {...register('masterkey')}
              error={errors.masterkey?.message}
              hint={
                masterkey
                  ? 'Salva neste dispositivo (localStorage: tenanthub_masterkey).'
                  : 'Deixe vazio para não salvar.'
              }
            />

            <Input
              label="URL do sistema"
              placeholder={DEFAULT_SYSTEM_URL}
              leftIcon={<ExternalLink className="h-4 w-4" />}
              {...register('systemUrl')}
              error={errors.systemUrl?.message}
              hint="Aberta em nova aba ao clicar em Acessar."
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-5 py-4">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => {
                  clearMasterkey()
                  reset({ masterkey: '', systemUrl })
                  toast.success('Masterkey removida')
                }}
                disabled={!masterkey}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Limpar masterkey salva
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetSystemUrl()
                  reset({
                    masterkey: masterkey ?? '',
                    systemUrl: DEFAULT_SYSTEM_URL,
                  })
                  toast.success('URL do sistema restaurada')
                }}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                URL padrão
              </Button>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!isDirty || !isValid}
              leftIcon={<Save className="h-4 w-4" />}
            >
              Salvar acesso
            </Button>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-line bg-card p-5">
            <header className="mb-3 flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.04] text-white/70 ring-1 ring-line">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-medium text-white">Estado do acesso</h3>
            </header>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-white/40">
                  Masterkey
                </dt>
                <dd className="mt-1 flex items-center gap-2">
                  <Badge tone={masterkey ? 'success' : 'neutral'} dot>
                    {masterkey ? 'Salva' : 'Não salva'}
                  </Badge>
                  {masterkey && (
                    <span className="font-mono text-[11px] text-white/55">
                      …{masterkey.slice(-4)}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-white/40">
                  URL atual
                </dt>
                <dd className="mt-1 truncate text-white/85" title={systemUrl}>
                  {systemUrl}
                </dd>
              </div>
            </dl>
          </div>
        </aside>
      </form>
    </section>
  )
}
