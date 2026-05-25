import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Copy,
  Edit3,
  ExternalLink,
  KeyRound,
  Mail,
  Plus,
  UserCircle2,
  UserPlus,
  Users as UsersIcon,
} from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import {
  TenantForm,
  TenantFormValues,
} from '@/components/tenants/TenantForm'
import {
  useTenant,
  useUpdateTenant,
} from '@/hooks/useTenants'
import {
  useCreateUser,
  useUpdateUser,
  useUsers,
} from '@/hooks/useUsers'
import { extractErrorMessage } from '@/api/client'
import { useServerById } from '@/store/authStore'
import {
  asText,
  cn,
  formatDate,
  formatDateShort,
  initials,
  isTenantActive,
} from '@/lib/utils'
import { copyToClipboard } from '@/lib/clipboard'
import type { AppUser } from '@/types'

const userSchema = z.object({
  name: z.string().min(2, 'Mínimo 2 caracteres'),
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres').optional().or(z.literal('')),
  role: z.string().optional().or(z.literal('')),
})
type UserSchema = z.infer<typeof userSchema>

export function TenantDetailPage() {
  const { serverId, id } = useParams<{ serverId: string; id: string }>()
  const navigate = useNavigate()
  const server = useServerById(serverId)
  const tenantQ = useTenant(serverId, id)
  const tenant = tenantQ.data
  const tenantApiId =
    typeof tenant?.apiId === 'string' ? tenant.apiId : undefined
  const usersQ = useUsers(server, tenantApiId)
  const updateTenantMut = useUpdateTenant()
  const createUserMut = useCreateUser()
  const updateUserMut = useUpdateUser()

  const [editOpen, setEditOpen] = React.useState(false)
  const [userModal, setUserModal] = React.useState<{ mode: 'create' } | { mode: 'edit'; user: AppUser } | null>(null)

  const openServerLogin = () => {
    if (!server?.loginUrl) {
      toast.error('URL de login do servidor não configurada')
      return
    }
    const opened = window.open(server.loginUrl, '_blank', 'noopener,noreferrer')
    if (!opened) {
      toast.error('Pop-up bloqueado — libere para abrir o sistema')
    }
  }

  const active = tenant ? isTenantActive(tenant) : false

  const onTenantSubmit = async (values: TenantFormValues) => {
    if (!tenant || !server) return
    try {
      await updateTenantMut.mutateAsync({
        server,
        payload: { id: tenant.id, ...values },
      })
      toast.success('Tenant atualizado')
      setEditOpen(false)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const onUserSubmit = async (values: UserSchema) => {
    if (!userModal || !tenant || !server || !tenantApiId) {
      toast.error('Não foi possível identificar o tenant/servidor.')
      return
    }
    try {
      if (userModal.mode === 'create') {
        await createUserMut.mutateAsync({
          server,
          apiId: tenantApiId,
          payload: {
            tenant_id: tenant.id,
            name: values.name,
            email: values.email,
            password: values.password || undefined,
            role: values.role || 'support',
            permissions: ['support'],
          },
        })
        toast.success('Usuário criado')
      } else {
        await updateUserMut.mutateAsync({
          server,
          apiId: tenantApiId,
          payload: {
            id: userModal.user.id,
            tenant_id: tenant.id,
            name: values.name,
            email: values.email,
            password: values.password || undefined,
            role: values.role || undefined,
          },
        })
        toast.success('Usuário atualizado')
      }
      setUserModal(null)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  if (tenantQ.isLoading) {
    return (
      <>
        <TopBar />
        <div className="px-8 py-6">
          <Skeleton className="h-9 w-72" />
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </>
    )
  }

  if (tenantQ.isError || !tenant) {
    return (
      <>
        <TopBar />
        <div className="px-8 py-12">
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="Tenant não encontrado"
            description={extractErrorMessage(tenantQ.error, 'O tenant solicitado não existe ou foi removido.')}
            action={
              <Button onClick={() => navigate('/tenants')} variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
                Voltar para Tenants
              </Button>
            }
          />
        </div>
      </>
    )
  }

  const entries = Object.entries(tenant).filter(
    ([k]) =>
      !['id', 'name', 'status', 'active', 'is_active', 'created_at', 'updated_at'].includes(k),
  )

  return (
    <>
      <TopBar
        breadcrumbs={[
          { label: 'TenantHub', to: '/' },
          { label: 'Tenants', to: '/tenants' },
          { label: asText(tenant.name, 'Tenant') },
        ]}
        title={asText(tenant.name, 'Tenant')}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate('/tenants')}
              leftIcon={<ArrowLeft className="h-4 w-4" />}
            >
              Voltar
            </Button>
            <Button
              size="sm"
              onClick={openServerLogin}
              leftIcon={<ExternalLink className="h-4 w-4" />}
            >
              Acessar
            </Button>
            <Button onClick={() => setEditOpen(true)} leftIcon={<Edit3 className="h-4 w-4" />}>
              Editar
            </Button>
          </div>
        }
      />

      <div className="px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent/10 text-sm font-semibold text-accent ring-1 ring-accent/20">
            {initials(asText(tenant.name))}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">{asText(tenant.name, 'Tenant')}</h2>
              <Badge tone={active ? 'success' : 'danger'} dot>
                {active ? 'Ativo' : 'Inativo'}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-foreground/45">
              ID: <code className="text-foreground/70">{String(tenant.id)}</code>
              {tenant.created_at && (
                <>
                  {' · '}criado em {formatDate(tenant.created_at)}
                </>
              )}
            </p>
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-line bg-card">
          <header className="border-b border-line px-5 py-3">
            <h3 className="text-xs font-medium uppercase tracking-wider text-foreground/45">
              Informações
            </h3>
          </header>
          {entries.length === 0 ? (
            <div className="px-5 py-6 text-sm text-foreground/50">
              Nenhuma informação adicional disponível.
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map(([key, value]) => (
                <InfoCell key={key} k={key} v={value} />
              ))}
            </dl>
          )}
        </section>

        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-foreground/60" />
              <h3 className="text-sm font-medium text-foreground">Usuários</h3>
              {usersQ.data && (
                <span className="text-xs text-foreground/40">({usersQ.data.length})</span>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => setUserModal({ mode: 'create' })}
              leftIcon={<UserPlus className="h-4 w-4" />}
            >
              Adicionar usuário de suporte
            </Button>
          </div>

          {usersQ.isLoading ? (
            <div className="rounded-xl border border-line bg-card p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 w-48" />
                </div>
              ))}
            </div>
          ) : usersQ.isError ? (
            <EmptyState
              icon={<UsersIcon className="h-5 w-5" />}
              title="Falha ao carregar usuários"
              description={extractErrorMessage(usersQ.error)}
              action={
                <Button variant="secondary" onClick={() => usersQ.refetch()}>
                  Tentar novamente
                </Button>
              }
            />
          ) : !usersQ.data || usersQ.data.length === 0 ? (
            <EmptyState
              icon={<UsersIcon className="h-5 w-5" />}
              title="Nenhum usuário ainda"
              description="Adicione um usuário de suporte para esse tenant."
              action={
                <Button
                  onClick={() => setUserModal({ mode: 'create' })}
                  leftIcon={<Plus className="h-4 w-4" />}
                >
                  Adicionar usuário
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Usuário</TH>
                  <TH>E-mail</TH>
                  <TH>Status</TH>
                  <TH>Criado em</TH>
                  <TH className="text-right">Ações</TH>
                </tr>
              </THead>
              <TBody>
                {usersQ.data.map((u) => {
                  const isActive =
                    typeof u.active === 'boolean'
                      ? u.active
                      : typeof u.is_active === 'boolean'
                        ? u.is_active
                        : (u.status ?? '').toString().toLowerCase().includes('active') ||
                          (u.status ?? '').toString().toLowerCase().includes('ativo')
                  return (
                    <TR key={String(u.id)}>
                      <TD>
                        <div className="flex items-center gap-3">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-elevate/[0.04] text-[11px] font-medium text-foreground/80 ring-1 ring-line">
                            {initials(asText(u.name)) || <UserCircle2 className="h-4 w-4" />}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-foreground">{asText(u.name, '—')}</div>
                            {u.role && (
                              <div className="text-[11px] text-foreground/40">{asText(u.role)}</div>
                            )}
                          </div>
                        </div>
                      </TD>
                      <TD className="text-foreground/70">{asText(u.email)}</TD>
                      <TD>
                        <Badge tone={isActive ? 'success' : 'neutral'} dot>
                          {u.status ? asText(u.status, isActive ? 'Ativo' : 'Inativo') : isActive ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TD>
                      <TD className="text-foreground/60">{formatDateShort(u.created_at)}</TD>
                      <TD className="text-right">
                        <button
                          onClick={() => setUserModal({ mode: 'edit', user: u })}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/70 hover:bg-elevate/[0.06] hover:text-foreground"
                          aria-label="Editar usuário"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Editar
                        </button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </section>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Editar tenant"
        size="lg"
      >
        <TenantForm
          initialTenant={tenant}
          submitLabel="Salvar alterações"
          onCancel={() => setEditOpen(false)}
          onSubmit={onTenantSubmit}
          loading={updateTenantMut.isPending}
        />
      </Modal>

      <UserFormModal
        open={!!userModal}
        mode={userModal?.mode}
        user={userModal && userModal.mode === 'edit' ? userModal.user : undefined}
        loading={createUserMut.isPending || updateUserMut.isPending}
        onClose={() => setUserModal(null)}
        onSubmit={onUserSubmit}
      />

    </>
  )
}

function InfoCell({ k, v }: { k: string; v: unknown }) {
  const value =
    v === null || v === undefined || v === ''
      ? '—'
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v)

  const isSensitive =
    /token|key|secret|password/i.test(k) && value !== '—' && value.length > 6

  const [shown, setShown] = React.useState(!isSensitive)

  const copy = async () => {
    const ok = await copyToClipboard(value)
    if (ok) {
      toast.success('Copiado')
    } else {
      toast.error('Não foi possível copiar')
    }
  }

  return (
    <div
      className={cn(
        'group flex items-start justify-between gap-4 border-b border-line/70 px-5 py-3 last:border-b-0',
      )}
    >
      <div className="min-w-0 flex-1">
        <dt className="text-[11px] uppercase tracking-wider text-foreground/40">
          {humanize(k)}
        </dt>
        <dd className="mt-1 truncate text-sm text-foreground/85">
          {isSensitive && !shown ? '••••••••' : value}
        </dd>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
        {isSensitive && (
          <button
            onClick={() => setShown((s) => !s)}
            className="rounded-md p-1 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label={shown ? 'Ocultar' : 'Mostrar'}
          >
            <KeyRound className="h-3.5 w-3.5" />
          </button>
        )}
        {value !== '—' && (
          <button
            onClick={copy}
            className="rounded-md p-1 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label="Copiar"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function humanize(s: string) {
  return s
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function UserFormModal({
  open,
  mode,
  user,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean
  mode?: 'create' | 'edit'
  user?: AppUser
  loading: boolean
  onClose: () => void
  onSubmit: (v: UserSchema) => void | Promise<void>
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<UserSchema>({
    resolver: zodResolver(userSchema),
    mode: 'onChange',
    defaultValues: {
      name: user?.name ?? '',
      email: user?.email ?? '',
      password: '',
      role: user?.role ?? 'support',
    },
  })

  React.useEffect(() => {
    if (open) {
      reset({
        name: user?.name ?? '',
        email: user?.email ?? '',
        password: '',
        role: user?.role ?? 'support',
      })
    }
  }, [open, user, reset])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? 'Editar usuário' : 'Adicionar usuário de suporte'}
      size="md"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4">
        <Input
          label="Nome *"
          leftIcon={<UserCircle2 className="h-4 w-4" />}
          {...register('name')}
          error={errors.name?.message}
        />
        <Input
          label="E-mail *"
          type="email"
          leftIcon={<Mail className="h-4 w-4" />}
          {...register('email')}
          error={errors.email?.message}
        />
        <Input
          label={mode === 'edit' ? 'Nova senha (opcional)' : 'Senha *'}
          type="password"
          autoComplete="new-password"
          leftIcon={<KeyRound className="h-4 w-4" />}
          {...register('password')}
          error={errors.password?.message}
        />
        <Input label="Função / Role" placeholder="support" {...register('role')} />
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading} disabled={!isValid}>
            {mode === 'edit' ? 'Salvar' : 'Criar usuário'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
