import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Hash,
  KeyRound,
  Mail,
  RefreshCw,
  Sparkles,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { cn, deriveSupportEmail } from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import { tenantsApi } from '@/api/tenants'
import { extractErrorMessage, toMessage } from '@/api/client'
import { tenantKeys } from '@/hooks/useTenants'
import { userKeys } from '@/hooks/useUsers'
import { useAuthStore, getServerById } from '@/store/authStore'
import { db } from '@/services/db'
import type { StoreTenantPayload } from '@/types'

// Fallback usado quando settings.defaultTenantPassword não está configurado.
const FALLBACK_SUPPORT_PASSWORD = 'Nxim01@!'
const SUPPORT_USER_NAME = 'Suporte NX'

const tenantStep = z.object({
  serverId: z.string().min(1, 'Selecione um servidor'),
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  status: z.enum(['active', 'inactive']),
  maxUsers: z.coerce.number().int().min(1, 'Mínimo 1').max(999, 'Máx. 999'),
  maxConnections: z.coerce.number().int().min(1, 'Mínimo 1').max(999, 'Máx. 999'),
})

const supportStep = z.object({
  userName: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  profile: z.enum(['admin', 'user']),
})

type TenantValues = z.infer<typeof tenantStep>
type SupportValues = z.infer<typeof supportStep>

const STEPS = ['Tenant', 'Acesso de suporte', 'Revisão'] as const

export interface OnboardingWizardProps {
  open: boolean
  onClose: () => void
  onCreated?: (tenantId: string | number) => void
}

export function OnboardingWizard({
  open,
  onClose,
  onCreated,
}: OnboardingWizardProps) {
  const qc = useQueryClient()
  const [step, setStep] = React.useState(0)
  const [direction, setDirection] = React.useState<'left' | 'right'>('right')

  const [tenantData, setTenantData] = React.useState<TenantValues | null>(null)
  const [supportData, setSupportData] = React.useState<SupportValues | null>(
    null,
  )

  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{
    tenantId?: string | number
    tenant: unknown
    payload: StoreTenantPayload
    serverName: string
  } | null>(null)
  const [finished, setFinished] = React.useState(false)

  const reset = React.useCallback(() => {
    setStep(0)
    setDirection('right')
    setTenantData(null)
    setSupportData(null)
    setRunning(false)
    setError(null)
    setResult(null)
    setFinished(false)
  }, [])

  const handleClose = () => {
    if (running) return
    onClose()
    setTimeout(reset, 250)
  }

  const next = () => {
    setDirection('right')
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }
  const back = () => {
    setDirection('left')
    setStep((s) => Math.max(s - 1, 0))
  }

  const submitAll = async () => {
    if (!tenantData || !supportData) return
    setRunning(true)
    setError(null)

    const payload: StoreTenantPayload = {
      status: tenantData.status,
      name: tenantData.name.trim(),
      maxUsers: tenantData.maxUsers,
      maxConnections: tenantData.maxConnections,
      acceptTerms: true,
      userName: supportData.userName.trim(),
      email: supportData.email.trim(),
      password: supportData.password,
      profile: supportData.profile,
    }

    const server = getServerById(tenantData.serverId)
    if (!server) {
      const msg = 'Selecione um servidor habilitado em Configurações.'
      setError(msg)
      setRunning(false)
      toast.error(msg)
      return
    }

    try {
      const created = (await tenantsApi.store(server, payload)) as
        | ({ id?: string | number } & Record<string, unknown>)
        | null
      const tenantId =
        (created && (created.id as string | number | undefined)) ?? undefined

      qc.invalidateQueries({ queryKey: tenantKeys.all })
      qc.invalidateQueries({ queryKey: userKeys.all })

      setResult({
        tenantId,
        tenant: created ?? {},
        payload,
        serverName: server.name,
      })
      setRunning(false)
      setFinished(true)
      toast.success(`Tenant criado em "${server.name}"`)
      if (tenantId !== undefined) onCreated?.(tenantId)
    } catch (err) {
      const msg = extractErrorMessage(err, 'Falha ao criar tenant')
      setError(msg)
      setRunning(false)
      toast.error(msg)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="xl"
      closeOnBackdrop={!running}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          Novo tenant
        </span>
      }
      description="Cria o tenant e o acesso de suporte em uma única chamada à API (/tenantApiStoreTenant)."
    >
      <Stepper currentStep={step} done={finished} />

      <div className="relative mt-6">
        <div
          key={step}
          className={cn(
            'animate-fade-in',
            direction === 'right' && 'animate-slide-in-right',
            direction === 'left' && 'animate-slide-in-left',
          )}
        >
          {step === 0 && (
            <StepTenant
              defaults={tenantData ?? undefined}
              onCancel={handleClose}
              onNext={(v) => {
                if (tenantData && tenantData.name !== v.name) {
                  setSupportData(null)
                }
                setTenantData(v)
                next()
              }}
            />
          )}
          {step === 1 && (
            <StepSupport
              defaults={
                supportData ?? {
                  userName: SUPPORT_USER_NAME,
                  email: deriveSupportEmail(tenantData?.name ?? ''),
                  password:
                    db.getSettings().defaultTenantPassword ||
                    FALLBACK_SUPPORT_PASSWORD,
                  profile: 'admin',
                }
              }
              onBack={back}
              onNext={(v) => {
                setSupportData(v)
                next()
              }}
            />
          )}
          {step === 2 && (
            <StepReview
              tenant={tenantData!}
              support={supportData!}
              running={running}
              error={error}
              finished={finished}
              result={result}
              onBack={back}
              onConfirm={submitAll}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

function Stepper({
  currentStep,
  done,
}: {
  currentStep: number
  done: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const active = i === currentStep
        const complete = done || i < currentStep
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-full border text-[11px] font-medium transition-all',
                  complete
                    ? 'border-accent bg-accent/15 text-accent'
                    : active
                      ? 'border-accent bg-accent/10 text-accent shadow-ringSoft'
                      : 'border-line bg-elevate/[0.03] text-foreground/40',
                )}
              >
                {complete ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-xs',
                  active
                    ? 'text-foreground'
                    : complete
                      ? 'text-foreground/70'
                      : 'text-foreground/40',
                )}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px flex-1 transition-colors',
                  complete ? 'bg-accent/60' : 'bg-elevate/[0.10]',
                )}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function StepTenant({
  defaults,
  onNext,
  onCancel,
}: {
  defaults?: TenantValues
  onNext: (v: TenantValues) => void
  onCancel: () => void
}) {
  const enabledServers = useAuthStore((s) =>
    s.servers.filter((x) => x.enabled),
  )
  const selectedServerId = useAuthStore((s) => s.selectedServerId)
  const fallbackServerId =
    defaults?.serverId ??
    (enabledServers.find((s) => s.id === selectedServerId)?.id ??
      enabledServers[0]?.id ??
      '')

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<TenantValues>({
    resolver: zodResolver(tenantStep),
    mode: 'onChange',
    defaultValues: defaults ?? {
      serverId: fallbackServerId,
      status: 'active',
      maxUsers: 3,
      maxConnections: 3,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(onNext)}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <Select
          label="Servidor *"
          options={enabledServers.map((s) => ({
            value: s.id,
            label: `${s.name} — ${s.baseUrl.replace(/^https?:\/\//, '')}`,
          }))}
          {...register('serverId')}
          error={errors.serverId?.message}
        />
      </div>

      <div className="sm:col-span-2">
        <Input
          label="Nome do tenant *"
          placeholder="Acme Ltda"
          leftIcon={<Building2 className="h-4 w-4" />}
          {...register('name')}
          error={errors.name?.message}
        />
      </div>

      <Select
        label="Status *"
        options={[
          { value: 'active', label: 'Ativo' },
          { value: 'inactive', label: 'Inativo' },
        ]}
        {...register('status')}
      />

      <div />

      <Input
        label="Máx. usuários *"
        type="number"
        min={1}
        leftIcon={<Hash className="h-4 w-4" />}
        {...register('maxUsers', { valueAsNumber: true })}
        error={errors.maxUsers?.message}
      />
      <Input
        label="Máx. conexões *"
        type="number"
        min={1}
        leftIcon={<Hash className="h-4 w-4" />}
        {...register('maxConnections', { valueAsNumber: true })}
        error={errors.maxConnections?.message}
      />

      <div className="sm:col-span-2 mt-2 flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!isValid}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          Próximo
        </Button>
      </div>
    </form>
  )
}

function StepSupport({
  defaults,
  onBack,
  onNext,
}: {
  defaults: SupportValues
  onBack: () => void
  onNext: (v: SupportValues) => void
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<SupportValues>({
    resolver: zodResolver(supportStep),
    mode: 'onChange',
    defaultValues: defaults,
  })

  return (
    <form onSubmit={handleSubmit(onNext)} className="grid grid-cols-1 gap-4">
      <div className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-foreground/55">
        <span className="text-foreground/85">Acesso de suporte</span> — criado junto
        com o tenant. E-mail e senha já vêm preenchidos com o padrão{' '}
        <code className="rounded bg-elevate/[0.06] px-1 py-0.5 text-foreground/85">
          suportenx-(empresa)@gmail.com
        </code>{' '}
        / <code className="rounded bg-elevate/[0.06] px-1 py-0.5 text-foreground/85">Nxim01@!</code>
        .
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome do usuário *"
          leftIcon={<UserCircle2 className="h-4 w-4" />}
          {...register('userName')}
          error={errors.userName?.message}
        />
        <Select
          label="Perfil *"
          options={[
            { value: 'admin', label: 'Administrador' },
            { value: 'user', label: 'Usuário' },
          ]}
          {...register('profile')}
        />
        <div className="sm:col-span-2">
          <Input
            label="E-mail *"
            type="email"
            leftIcon={<Mail className="h-4 w-4" />}
            {...register('email')}
            error={errors.email?.message}
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Senha *"
            type="text"
            autoComplete="new-password"
            spellCheck={false}
            leftIcon={<KeyRound className="h-4 w-4" />}
            {...register('password')}
            error={errors.password?.message}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Voltar
        </Button>
        <Button
          type="submit"
          disabled={!isValid}
          rightIcon={<ArrowRight className="h-4 w-4" />}
        >
          Próximo
        </Button>
      </div>
    </form>
  )
}

function StepReview({
  tenant,
  support,
  running,
  error,
  finished,
  result,
  onBack,
  onConfirm,
  onClose,
}: {
  tenant: TenantValues
  support: SupportValues
  running: boolean
  error: string | null
  finished: boolean
  result: {
    tenantId?: string | number
    tenant: unknown
    payload: StoreTenantPayload
    serverName: string
  } | null
  onBack: () => void
  onConfirm: () => void
  onClose: () => void
}) {
  if (finished && result) {
    return <SuccessView result={result} tenantName={String(tenant.name ?? '')} onClose={onClose} />
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      <section className="rounded-xl border border-line bg-elevate/[0.02] p-4">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-foreground/40">
          Tenant
        </h4>
        <dl className="mt-3 space-y-2 text-sm">
          <ReviewRow
            k="Servidor"
            v={
              <Badge tone="info">
                {getServerById(tenant.serverId)?.name ?? tenant.serverId}
              </Badge>
            }
          />
          <ReviewRow k="Nome" v={tenant.name} />
          <ReviewRow
            k="Status"
            v={
              <Badge tone={tenant.status === 'active' ? 'success' : 'danger'} dot>
                {tenant.status === 'active' ? 'Ativo' : 'Inativo'}
              </Badge>
            }
          />
          <ReviewRow k="Máx. usuários" v={String(tenant.maxUsers)} />
          <ReviewRow k="Máx. conexões" v={String(tenant.maxConnections)} />
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-elevate/[0.02] p-4">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-foreground/40">
          Acesso de suporte
        </h4>
        <dl className="mt-3 space-y-2 text-sm">
          <ReviewRow k="Nome" v={support.userName} />
          <ReviewRow
            k="Perfil"
            v={
              <Badge tone="info">
                {support.profile === 'admin' ? 'Administrador' : 'Usuário'}
              </Badge>
            }
          />
          <ReviewRow k="E-mail" v={support.email} />
          <ReviewRow
            k="Senha"
            v={<code className="font-mono text-foreground/85">{support.password}</code>}
          />
        </dl>
      </section>

      {error && (
        <div className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{toMessage(error)}</span>
        </div>
      )}

      <div className="sm:col-span-2 mt-2 flex items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={running}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Voltar
        </Button>
        {error ? (
          <Button
            onClick={onConfirm}
            loading={running}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Tentar novamente
          </Button>
        ) : (
          <Button onClick={onConfirm} loading={running}>
            Confirmar e criar
          </Button>
        )}
      </div>
    </div>
  )
}

function ReviewRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[11px] uppercase tracking-wider text-foreground/40">{k}</dt>
      <dd className="text-sm text-foreground/90 text-right">{v}</dd>
    </div>
  )
}

function SuccessView({
  result,
  tenantName,
  onClose,
}: {
  result: {
    tenantId?: string | number
    tenant: unknown
    payload: StoreTenantPayload
    serverName: string
  }
  tenantName: string
  onClose: () => void
}) {
  const summary = React.useMemo(() => {
    const lines = [
      `Servidor: ${result.serverName}`,
      `Tenant: ${tenantName}`,
      result.tenantId !== undefined ? `ID: ${String(result.tenantId)}` : null,
      `Nome do usuário: ${result.payload.userName}`,
      `E-mail: ${result.payload.email}`,
      `Senha: ${result.payload.password}`,
      `Perfil: ${result.payload.profile}`,
    ]
    return lines.filter(Boolean).join('\n')
  }, [result, tenantName])

  const copy = async () => {
    const ok = await copyToClipboard(summary)
    if (ok) toast.success('Credenciais copiadas')
    else toast.error('Não foi possível copiar')
  }

  return (
    <div className="animate-fade-in flex flex-col items-center text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-success/15 text-success ring-1 ring-success/30">
        <Check className="h-7 w-7" />
      </div>
      <h3 className="text-base font-semibold text-foreground">Tenant criado</h3>
      <p className="mt-1 text-sm text-foreground/55">
        <span className="text-foreground/85">{tenantName}</span> está pronto para uso
        — acesso de suporte foi criado junto.
      </p>

      <div className="mt-5 w-full rounded-xl border border-line bg-elevate/[0.02] p-4 text-left">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-foreground/40">
            Credenciais de suporte
          </span>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-foreground/70 hover:bg-elevate/[0.06] hover:text-foreground"
          >
            <Copy className="h-3 w-3" /> Copiar
          </button>
        </div>
        <pre className="max-h-56 overflow-auto rounded-md bg-black/40 p-3 text-[11px] leading-relaxed text-foreground/80">
{summary}
        </pre>
      </div>

      <div className="mt-6 flex w-full items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  )
}

export default OnboardingWizard
