import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  CheckCircle2,
  Loader2,
  LogOut,
  Pencil,
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
import { MENU_ACCESS_GROUP_LABEL, MENU_ACCESS_ITEMS } from '@/constants/menuAccess'
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
    label: 'Usuário',
    description: 'Não vê contrato/financeiro. Não pode excluir. Pode ter as Permissões de menu restritas ao que ele deve ver.',
  },
]

const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  suporte: 'Usuário',
}

/**
 * Área no funil — define onde a pessoa aparece como responsável (filtros do
 * pipeline e seletores do cliente). Não tem relação com permissão de acesso —
 * isso agora é o bloco "Permissões de menu" no editar usuário.
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

/** "Quem está online agora" pra Equipe — estado inicial via GET, depois se atualiza sozinho pelos
 * eventos de presence do SSE (ver server/src/sse.ts). Uma pessoa pode ter mais de uma aba/
 * dispositivo aberto; só sai da lista quando a ÚLTIMA conexão dela cai. */
function useOnlineUserIds(): Set<string> {
  const [online, setOnline] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    api.get<string[]>('/api/users/online').then((ids) => setOnline(new Set(ids))).catch(() => {})
    const unsub = onSseEvent((table, type, data) => {
      if (table !== 'presence') return
      const userId = (data as { user_id?: string }).user_id
      if (!userId) return
      setOnline((prev) => {
        const next = new Set(prev)
        if (type === 'online') next.add(userId)
        else next.delete(userId)
        return next
      })
    })
    return unsub
  }, [])
  return online
}

export function UsersPage() {
  const { profile, loading: authLoading } = useAuth()
  const [profiles, setProfiles] = React.useState<Profile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const onlineIds = useOnlineUserIds()
  const canForceLogout = profile?.role === 'admin'

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

  const changeArea = async (id: string, area: TeamArea) => {
    try {
      await api.patch(`/api/users/${id}`, { area })
      toast.success('Área atualizada')
      void reload()
    } catch (err) {
      toast.error('Falha ao alterar área: ' + (err instanceof Error ? err.message : 'Erro'))
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
          <div className="overflow-x-auto no-scrollbar lg:overflow-visible" style={{ WebkitOverflowScrolling: 'touch' }}>
            <Table>
              <THead>
                <tr>
                  <TH>Usuário</TH>
                  <TH>Status</TH>
                  <TH>E-mail</TH>
                  <TH>Papel</TH>
                  <TH>Área</TH>
                  <TH>Permissões</TH>
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
                    online={onlineIds.has(p.id)}
                    canForceLogout={canForceLogout}
                    onChangeArea={(area) => changeArea(p.id, area)}
                    onSaved={() => reload()}
                    onDeleted={() => reload()}
                  />
                ))}
              </TBody>
            </Table>
          </div>
        )}

        <p className="mt-6 rounded-lg border border-line bg-elevate/[0.02] px-4 py-3 text-[11.5px] text-foreground/55">
          <strong className="text-foreground/80">Como criar um novo usuário:</strong>{' '}
          clique em <em>"Novo usuário"</em> — você cria o e-mail e a senha; ele
          entra com role <em>suporte</em> por padrão. Clique em <em>"Editar"</em>{' '}
          numa linha pra trocar nome, e-mail, senha, perfil e as{' '}
          <strong className="text-foreground/80">permissões de menu</strong> — exatamente
          o que essa pessoa pode ver (e, dentro do Comercial, quais quadros).
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
  online,
  canForceLogout,
  onChangeArea,
  onSaved,
  onDeleted,
}: {
  profile: Profile
  isSelf: boolean
  online: boolean
  canForceLogout: boolean
  onChangeArea: (area: TeamArea) => void | Promise<void>
  onSaved: () => void
  onDeleted: () => void
}) {
  const [confirmRemoveOpen, setConfirmRemoveOpen] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [loggingOut, setLoggingOut] = React.useState(false)

  const forceLogout = async () => {
    if (!window.confirm(`Deslogar "${profile.name || profile.email}" agora? A sessão dela é encerrada imediatamente.`)) return
    setLoggingOut(true)
    try {
      await api.post(`/api/users/${profile.id}/logout`)
      toast.success('Usuário deslogado')
    } catch (err) {
      toast.error('Falha ao deslogar: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setLoggingOut(false)
    }
  }

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
      <TD>
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground/60">
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', online ? 'bg-success' : 'bg-foreground/20')}
            title={online ? 'Online agora' : 'Offline'}
          />
          {online ? 'Online' : 'Offline'}
        </span>
      </TD>
      <TD className="text-foreground/70">{profile.email}</TD>
      <TD>
        <Badge tone={ROLE_TONE[profile.role]}>{ROLE_LABEL[profile.role]}</Badge>
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
            className="max-w-[120px]"
          />
        </div>
      </TD>
      <TD>
        {profile.role === 'suporte' ? (
          profile.restrictAccess ? (
            <Badge tone="warning">Restrito</Badge>
          ) : (
            <Badge tone="neutral">Acesso total</Badge>
          )
        ) : (
          <span className="text-xs text-foreground/35">Acesso total</span>
        )}
      </TD>
      <TD className="text-foreground/60">{formatDateShort(profile.created_at)}</TD>
      <TD className="text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/65 hover:bg-elevate/[0.06]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </button>
          {canForceLogout && !isSelf && online && (
            <button
              type="button"
              onClick={forceLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-warning hover:bg-warning/10 disabled:opacity-50"
              aria-label="Deslogar"
            >
              {loggingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
              Deslogar
            </button>
          )}
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
        </div>
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

      <EditUserModal
        profile={profile}
        isSelf={isSelf}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={onSaved}
      />
    </TR>
  )
}

interface PageLite {
  id: string
  name: string
  is_financeiro: boolean
}

/** Bloco "marcar todos" + lista de abas de uma área (Comercial ou Financeiro) — cada aba marcada
 * direto, sem herdar de um checkbox "geral" por cima (nenhuma marcada = sem acesso à área). */
function PageAccessGroup({
  label,
  emptyText,
  pages,
  pageIds,
  setPageIds,
  togglePageId,
}: {
  label: string
  emptyText: string
  pages: PageLite[]
  pageIds: Set<string>
  setPageIds: React.Dispatch<React.SetStateAction<Set<string>>>
  togglePageId: (id: string) => void
}) {
  if (pages.length === 0 && label !== MENU_ACCESS_GROUP_LABEL.comercial) return null
  const allChecked = pages.length > 0 && pages.every((p) => pageIds.has(p.id))
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground/40">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => {
            setPageIds((prev) => {
              const next = new Set(prev)
              for (const p of pages) {
                if (allChecked) next.delete(p.id)
                else next.add(p.id)
              }
              return next
            })
          }}
          className="h-3 w-3 rounded border-line"
        />
        {label}
        <span className="font-normal normal-case text-foreground/30">— marcar todos</span>
      </label>
      {pages.length === 0 ? (
        <p className="text-[11px] text-foreground/40">{emptyText}</p>
      ) : (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {pages.map((p) => (
            <label key={p.id} className="flex items-center gap-2 rounded-md border border-line/60 bg-card px-2.5 py-1.5 text-xs">
              <input
                type="checkbox"
                checked={pageIds.has(p.id)}
                onChange={() => togglePageId(p.id)}
                className="h-3.5 w-3.5 rounded border-line"
              />
              <span className="flex-1 text-foreground/85">{p.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function EditUserModal({
  profile,
  isSelf,
  open,
  onClose,
  onSaved,
}: {
  profile: Profile
  isSelf: boolean
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [role, setRole] = React.useState<UserRole>('suporte')
  const [restricted, setRestricted] = React.useState(false)
  const [menuKeys, setMenuKeys] = React.useState<Set<string>>(new Set())
  const [pageIds, setPageIds] = React.useState<Set<string>>(new Set())
  const [pages, setPages] = React.useState<PageLite[]>([])
  const [loadingPerms, setLoadingPerms] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(profile.name ?? '')
    setEmail(profile.email)
    setPassword('')
    setRole(profile.role)
    setRestricted(!!profile.restrictAccess)
    setLoadingPerms(true)
    Promise.all([
      api.get<PageLite[]>('/api/lead-pages'),
      api.get<string[]>(`/api/users/${profile.id}/menu-access`),
      api.get<string[]>(`/api/users/${profile.id}/page-access`),
    ])
      .then(([allPages, menu, pageAccess]) => {
        setPages(allPages)
        setMenuKeys(new Set(menu.length ? menu : MENU_ACCESS_ITEMS.map((i) => i.key)))
        setPageIds(new Set(pageAccess))
      })
      .catch((err) => toast.error('Falha ao carregar permissões: ' + (err instanceof Error ? err.message : 'Erro')))
      .finally(() => setLoadingPerms(false))
  }, [open, profile])

  const toggleMenuKey = (key: string) => {
    setMenuKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const togglePageId = (id: string) => {
    setPageIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error('Informe nome e e-mail')
      return
    }
    if (password.trim() && password.length < 6) {
      toast.error('A nova senha precisa ter no mínimo 6 caracteres')
      return
    }
    setSaving(true)
    try {
      const patch: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        role,
        restrictAccess: role === 'suporte' ? restricted : false,
      }
      if (password.trim()) patch.password = password
      await api.patch(`/api/users/${profile.id}`, patch)
      if (role === 'suporte' && restricted) {
        // "comercial" não tem checkbox próprio — fica ligado sozinho quando pelo menos uma aba
        // está marcada abaixo, e desliga quando nenhuma está (sem abas marcadas = sem Comercial).
        const menuKeysToSave = new Set(menuKeys)
        if (pageIds.size > 0) menuKeysToSave.add('comercial')
        else menuKeysToSave.delete('comercial')
        await Promise.all([
          api.put(`/api/users/${profile.id}/menu-access`, { menuKeys: Array.from(menuKeysToSave) }),
          api.put(`/api/users/${profile.id}/page-access`, { pageIds: Array.from(pageIds) }),
        ])
      }
      toast.success('Usuário atualizado')
      onSaved()
      onClose()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err instanceof Error ? err.message : 'Erro'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar usuário"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} leftIcon={!saving ? <CheckCircle2 className="h-4 w-4" /> : undefined}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Nome *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="E-mail *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Nova senha (deixe em branco pra manter)"
            type="password"
            placeholder="Mínimo 6 caracteres"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Perfil *</label>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              disabled={isSelf}
              className="w-full"
            />
          </div>
        </div>

        {role === 'suporte' && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground/70">Usuário restrito</label>
            <Select
              value={restricted ? 'on' : 'off'}
              onChange={(e) => setRestricted(e.target.value === 'on')}
              options={[
                { value: 'off', label: 'Desabilitado — acesso total' },
                { value: 'on', label: 'Habilitado — só o que for marcado abaixo' },
              ]}
              className="w-full sm:max-w-xs"
            />
          </div>
        )}

        {role === 'suporte' && restricted && (
          <div className="rounded-lg border border-line bg-elevate/[0.015] p-3">
            <div className="mb-2 text-xs font-medium text-foreground/70">
              Permissões de menu — exatamente o que esse usuário vai ver
            </div>
            {loadingPerms ? (
              <div className="flex items-center gap-2 py-3 text-xs text-foreground/50">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando…
              </div>
            ) : (
              <div className="space-y-4">
                {/* Comercial/Financeiro não têm um item "todas as abas" — cada aba é marcada
                    direto, sem marcação por cima; nenhuma marcada = a pessoa não vê nada daquela
                    área. Financeiro (Vendas/Contrato) tem seção própria — mesmo critério do
                    Sidebar (board is_vendas/is_contrato) — pra dar pra liberar/restringir
                    separado do resto do Comercial. */}
                <PageAccessGroup
                  label={MENU_ACCESS_GROUP_LABEL.comercial}
                  emptyText="Nenhuma aba do Comercial cadastrada ainda."
                  pages={pages.filter((p) => !p.is_financeiro)}
                  pageIds={pageIds}
                  setPageIds={setPageIds}
                  togglePageId={togglePageId}
                />
                <PageAccessGroup
                  label="Financeiro"
                  emptyText="Nenhuma aba do Financeiro cadastrada ainda."
                  pages={pages.filter((p) => p.is_financeiro)}
                  pageIds={pageIds}
                  setPageIds={setPageIds}
                  togglePageId={togglePageId}
                />

                {(() => {
                  const groupItems = MENU_ACCESS_ITEMS.filter((item) => item.group === 'suporte')
                  const allChecked = groupItems.every((item) => menuKeys.has(item.key))
                  const toggleGroup = () => {
                    setMenuKeys((prev) => {
                      const next = new Set(prev)
                      for (const item of groupItems) {
                        if (allChecked) next.delete(item.key)
                        else next.add(item.key)
                      }
                      return next
                    })
                  }
                  return (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-foreground/40">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleGroup}
                          className="h-3 w-3 rounded border-line"
                        />
                        {MENU_ACCESS_GROUP_LABEL.suporte}
                        <span className="font-normal normal-case text-foreground/30">— marcar todos</span>
                      </label>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {groupItems.map((item) => (
                          <div key={item.key} className="rounded-md border border-line/60 bg-card px-2.5 py-1.5">
                            <label className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={menuKeys.has(item.key)}
                                onChange={() => toggleMenuKey(item.key)}
                                className="h-3.5 w-3.5 rounded border-line"
                              />
                              <span className="flex-1 text-foreground/85">{item.label}</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
            <p className="mt-2 text-[10.5px] leading-relaxed text-foreground/45">
              Item desmarcado some do menu e das rotas desse usuário. No Comercial, marque as abas
              específicas que a pessoa deve ver — sem nenhuma marcada, ela não vê nada do Comercial.
            </p>
          </div>
        )}
      </div>
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
  const [creating, setCreating] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setEmail('')
      setPassword('')
      setName('')
      setRole('suporte')
      setArea('ambos')
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
      description="Cria a conta de acesso ao painel. Depois de criado, clique em Editar pra ajustar as permissões de menu."
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
      </div>
    </Modal>
  )
}
