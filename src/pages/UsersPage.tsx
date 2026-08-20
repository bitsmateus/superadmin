import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  CheckCircle2,
  Loader2,
  LayoutGrid,
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
  TEAM_AREA_LABEL,
  canManageUsers,
  resolveArea,
  type Profile,
  type TeamArea,
  type UserRole,
} from '@/services/supabase'
import { api, onSseEvent } from '@/services/api'
import { cn, formatDateShort, initials } from '@/lib/utils'
import { ABA_LABELS, ABA_ORDER } from '@/types/leadBoard'

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
    label: 'Usuário',
    description: 'Não vê contrato/financeiro. Não pode excluir. Pode ter o acesso restrito a uma área ou a quadros específicos do Comercial.',
  },
]

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Usuário',
}

/**
 * Área no funil — define onde a pessoa aparece como responsável (filtros do
 * pipeline e seletores do cliente). Também vira controle de acesso quando o
 * usuário (papel "suporte") tem a restrição ligada — aí ele só vê a área definida aqui.
 */
const AREA_OPTIONS: { value: TeamArea; label: string; description: string }[] = [
  {
    value: 'comercial',
    label: 'Comercial',
    description: 'Aparece só como responsável comercial.',
  },
  {
    value: 'entrega',
    label: 'Entrega',
    description: 'Aparece só como responsável de entrega e conta no limite da fila.',
  },
  {
    value: 'ambos',
    label: 'Ambos',
    description: 'Aparece nos dois filtros.',
  },
]

const AREA_TONE: Record<TeamArea, 'info' | 'success' | 'neutral'> = {
  comercial: 'info',
  entrega: 'success',
  ambos: 'neutral',
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

  const changeArea = async (id: string, area: TeamArea) => {
    try {
      await api.patch(`/api/users/${id}`, { area })
      toast.success('Área atualizada')
      void reload()
    } catch (err) {
      toast.error('Falha ao alterar área: ' + (err instanceof Error ? err.message : 'Erro'))
    }
  }

  const changeRestrictAccess = async (id: string, restrictAccess: boolean) => {
    try {
      await api.patch(`/api/users/${id}`, { restrictAccess })
      toast.success(restrictAccess ? 'Acesso restrito ativado' : 'Acesso restrito desativado')
      void reload()
    } catch (err) {
      toast.error('Falha ao alterar restrição: ' + (err instanceof Error ? err.message : 'Erro'))
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

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
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
                <TH>Área</TH>
                <TH>Acesso</TH>
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
                  onChangeArea={(area) => changeArea(p.id, area)}
                  onChangeRestrictAccess={(val) => changeRestrictAccess(p.id, val)}
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
          A <strong className="text-foreground/80">área</strong> é outra coisa:
          define se a pessoa aparece como responsável comercial, de entrega ou
          nos dois — é o que alimenta os filtros do pipeline.
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
  onChangeArea,
  onChangeRestrictAccess,
  onDeleted,
}: {
  profile: Profile
  isSelf: boolean
  onChangeRole: (role: UserRole) => void | Promise<void>
  onChangeArea: (area: TeamArea) => void | Promise<void>
  onChangeRestrictAccess: (val: boolean) => void | Promise<void>
  onDeleted: () => void
}) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const [boardAccessOpen, setBoardAccessOpen] = React.useState(false)

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
      <TD>
        <div className="flex items-center gap-2">
          <Badge tone={AREA_TONE[resolveArea(profile.area)]}>
            {TEAM_AREA_LABEL[resolveArea(profile.area)]}
          </Badge>
          <Select
            value={resolveArea(profile.area)}
            onChange={(e) => onChangeArea(e.target.value as TeamArea)}
            options={AREA_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            className="max-w-[140px]"
          />
        </div>
      </TD>
      <TD>
        {profile.role === 'suporte' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeRestrictAccess(!profile.restrictAccess)}
              title={profile.restrictAccess ? 'Clique pra desligar a restrição' : 'Clique pra restringir o acesso à área definida'}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                profile.restrictAccess ? 'bg-accent' : 'bg-elevate/[0.15]',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  profile.restrictAccess ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </button>
            {profile.restrictAccess && resolveArea(profile.area) !== 'entrega' && (
              <button
                type="button"
                onClick={() => setBoardAccessOpen(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/70 hover:bg-elevate/[0.06]"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Quadros
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-foreground/35">—</span>
        )}
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

      <BoardAccessModal
        profile={profile}
        open={boardAccessOpen}
        onClose={() => setBoardAccessOpen(false)}
      />
    </TR>
  )
}

function BoardAccessModal({
  profile,
  open,
  onClose,
}: {
  profile: Profile
  open: boolean
  onClose: () => void
}) {
  const [boards, setBoards] = React.useState<{ id: string; name: string; color: string; page: string }[]>([])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([
      api.get<{ id: string; name: string; color: string; page: string }[]>('/api/lead-boards'),
      api.get<string[]>(`/api/users/${profile.id}/board-access`),
    ])
      .then(([allBoards, access]) => {
        setBoards(allBoards)
        setSelected(new Set(access))
      })
      .catch((err) => toast.error('Falha ao carregar quadros: ' + (err instanceof Error ? err.message : 'Erro')))
      .finally(() => setLoading(false))
  }, [open, profile.id])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/users/${profile.id}/board-access`, { boardIds: Array.from(selected) })
      toast.success('Quadros atualizados')
      onClose()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setSaving(false)
    }
  }

  const byAba = ABA_ORDER.map((page) => ({
    page,
    label: ABA_LABELS[page],
    boards: boards.filter((b) => b.page === page),
  }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Quadros liberados — ${profile.name || profile.email}`}
      description={
        selected.size === 0
          ? 'Nenhum marcado = vê todos os quadros da área liberada.'
          : `${selected.size} quadro(s) selecionado(s) — só esses vão aparecer pra esse usuário.`
      }
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-foreground/55">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando quadros…
        </div>
      ) : (
        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          {byAba.map(({ page, label, boards: abaBoards }) => (
            <div key={page}>
              <div className="mb-1.5 text-[11px] uppercase tracking-wider text-foreground/45">
                {label}
              </div>
              {abaBoards.length === 0 ? (
                <p className="text-xs text-foreground/40">Nenhum quadro nessa aba.</p>
              ) : (
                <div className="space-y-1">
                  {abaBoards.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-elevate/[0.04]"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={() => toggle(b.id)}
                        className="h-3.5 w-3.5 rounded border-line"
                      />
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                      <span className="truncate text-foreground/85">{b.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
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
  const [area, setArea] = React.useState<TeamArea>('ambos')
  const [restrictAccess, setRestrictAccess] = React.useState(false)
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmail('')
      setPassword('')
      setName('')
      setRole('suporte')
      setArea('ambos')
      setRestrictAccess(false)
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
        area,
        restrictAccess: role === 'suporte' ? restrictAccess : false,
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
            Área no funil
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {AREA_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setArea(o.value)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-left text-xs transition-colors',
                  area === o.value
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
        {role === 'suporte' && (
          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-elevate/[0.02] px-3 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={restrictAccess}
              onChange={(e) => setRestrictAccess(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-line"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">Restringir acesso</span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-foreground/55">
                Esse usuário só vai enxergar a área "{AREA_OPTIONS.find((o) => o.value === area)?.label}"
                definida acima. Dá pra liberar quadros específicos do Comercial depois, aqui em Equipe.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  )
}
