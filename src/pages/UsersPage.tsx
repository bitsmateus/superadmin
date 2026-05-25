import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Trash2,
  UserCircle2,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import {
  canManageUsers,
  type Profile,
  type UserRole,
} from '@/services/supabase'
import { api, onSseEvent } from '@/services/api'
import { cn, formatDateShort, initials } from '@/lib/utils'

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  {
    value: 'admin',
    label: 'Administrador',
    description: 'Acesso total — único papel que pode excluir e gerenciar a equipe.',
  },
  {
    value: 'supervisor',
    label: 'Supervisor',
    description: 'Acesso total exceto exclusão de clientes/tenants.',
  },
  {
    value: 'suporte',
    label: 'Suporte',
    description: 'Não vê contrato/financeiro. Não pode excluir.',
  },
]

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Suporte',
}

const ROLE_TONE: Record<UserRole, 'info' | 'success' | 'warning'> = {
  admin: 'success',
  supervisor: 'info',
  suporte: 'warning',
}

export function UsersPage() {
  const { profile, loading: authLoading } = useAuth()
  const [profiles, setProfiles] = React.useState<Profile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [inviteOpen, setInviteOpen] = React.useState(false)

  const reload = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<Profile[]>('/api/users')
      setProfiles(data ?? [])
    } catch (err) {
      toast.error('Falha ao carregar equipe: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (canManageUsers(profile?.role)) void reload()
  }, [profile?.role, reload])

  React.useEffect(() => {
    const unsub = onSseEvent((table) => {
      if (table === 'profiles') void reload()
    })
    return unsub
  }, [reload])

  if (authLoading) return null
  if (!canManageUsers(profile?.role)) {
    return <Navigate to="/" replace />
  }

  const changeRole = async (id: string, role: UserRole) => {
    try {
      await api.patch(`/api/users/${id}`, { role })
      toast.success('Papel atualizado')
      void reload()
    } catch (err) {
      toast.error('Falha ao alterar papel: ' + (err instanceof Error ? err.message : 'Erro'))
    }
  }

  return (
    <>
      <TopBar
        title="Equipe"
        subtitle={`${profiles.length} usuário(s) com acesso ao painel`}
        rightSlot={
          <Button
            onClick={() => setInviteOpen(true)}
            leftIcon={<UserPlus className="h-4 w-4" />}
          >
            Novo usuário
          </Button>
        }
      />

      <div className="px-8 py-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-foreground/55">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando equipe…
          </div>
        ) : profiles.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Sem usuários ainda"
            description="Crie o primeiro usuário pela página."
            action={
              <Button
                onClick={() => setInviteOpen(true)}
                leftIcon={<UserPlus className="h-4 w-4" />}
              >
                Novo usuário
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Usuário</TH>
                <TH>E-mail</TH>
                <TH>Papel</TH>
                <TH>Criado em</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {profiles.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  isSelf={p.id === profile?.id}
                  onChangeRole={(role) => changeRole(p.id, role)}
                  onDeleted={() => reload()}
                />
              ))}
            </TBody>
          </Table>
        )}

        <p className="mt-6 rounded-lg border border-line bg-elevate/[0.02] px-4 py-3 text-[11.5px] text-foreground/55">
          <strong className="text-foreground/80">Como criar um novo usuário:</strong>{' '}
          clique em <em>"Novo usuário"</em> — você cria o e-mail e a senha; ele
          entra com role <em>suporte</em> por padrão e você pode promover aqui.
        </p>
      </div>

      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={() => {
          setInviteOpen(false)
          void reload()
        }}
      />
    </>
  )
}

function ProfileRow({
  profile,
  isSelf,
  onChangeRole,
  onDeleted,
}: {
  profile: Profile
  isSelf: boolean
  onChangeRole: (role: UserRole) => void | Promise<void>
  onDeleted: () => void
}) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)

  const removeProfile = async () => {
    setRemoving(true)
    try {
      await api.delete(`/api/users/${profile.id}`)
      toast.success('Acesso removido')
      setConfirmRemoveOpen(false)
      onDeleted()
    } catch (err) {
      toast.error('Falha ao remover: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setRemoving(false)
    }
  }

  return (
    <TR>
      <TD>
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-elevate/[0.04] text-[11px] font-medium text-foreground/80 ring-1 ring-line">
            {initials(profile.name || profile.email) || (
              <UserCircle2 className="h-4 w-4" />
            )}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">
              {profile.name || '—'}
              {isSelf && (
                <span className="ml-2 text-[10px] uppercase tracking-wider text-accent">
                  você
                </span>
              )}
            </div>
          </div>
        </div>
      </TD>
      <TD className="text-foreground/70">{profile.email}</TD>
      <TD>
        <div className="flex items-center gap-2">
          <Badge tone={ROLE_TONE[profile.role]}>
            {ROLE_LABEL[profile.role]}
          </Badge>
          {!isSelf && (
            <Select
              value={profile.role}
              onChange={(e) => onChangeRole(e.target.value as UserRole)}
              options={ROLE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
              }))}
              className="max-w-[160px]"
            />
          )}
        </div>
      </TD>
      <TD className="text-foreground/60">{formatDateShort(profile.created_at)}</TD>
      <TD className="text-right">
        {!isSelf && (
          <button
            type="button"
            onClick={() => setConfirmRemoveOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
            aria-label="Remover acesso"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remover
          </button>
        )}
      </TD>

      <Modal
        open={confirmRemoveOpen}
        onClose={() => setConfirmRemoveOpen(false)}
        title="Remover acesso"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmRemoveOpen(false)}
              disabled={removing}
            >
              Cancelar
            </Button>
            <Button variant="danger" onClick={removeProfile} loading={removing}>
              Remover
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/75">
          Remove o acesso de{' '}
          <strong className="text-foreground">{profile.email}</strong> — o usuário
          perde acesso ao painel imediatamente.
        </p>
      </Modal>
    </TR>
  )
}

function InviteUserModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [name, setName] = React.useState('')
  const [role, setRole] = React.useState<UserRole>('suporte')
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmail('')
      setPassword('')
      setName('')
      setRole('suporte')
    }
  }, [open])

  const submit = async () => {
    if (!email.trim() || !password.trim()) {
      toast.error('Informe e-mail e senha')
      return
    }
    if (password.length < 6) {
      toast.error('A senha precisa ter no mínimo 6 caracteres')
      return
    }
    setCreating(true)
    try {
      await api.post('/api/users', {
        email: email.trim(),
        name: name.trim() || undefined,
        password,
        role,
      })
      toast.success('Usuário criado')
      onCreated()
    } catch (err) {
      toast.error('Falha ao criar: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo usuário"
      description="Cria a conta de acesso ao painel. A senha pode ser trocada depois pelo próprio usuário."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={creating}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            loading={creating}
            leftIcon={
              !creating ? <CheckCircle2 className="h-4 w-4" /> : undefined
            }
          >
            Criar usuário
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome"
          placeholder="Mateus Bitencourt"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="E-mail *"
          type="email"
          placeholder="usuario@empresa.com"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Senha provisória *"
          type="password"
          placeholder="Mínimo 6 caracteres"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/45">
            Papel
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ROLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRole(o.value)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                  role === o.value
                    ? 'border-accent/50 bg-accent/[0.08] ring-1 ring-accent/30'
                    : 'border-line bg-elevate/[0.02] hover:border-elevate/15',
                )}
              >
                <div className="text-sm font-medium text-foreground">{o.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-relaxed text-foreground/55">
                  {o.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
