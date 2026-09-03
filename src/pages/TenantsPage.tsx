import * as React from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  Edit3,
  ExternalLink,
  MoreHorizontal,
  PlusCircle,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { useSupportViewValue, useSupportViewText } from '@/components/support/SupportViewContext'
import { ServerFilter } from '@/components/layout/ServerFilter'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { SkeletonRow } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { OnboardingWizard } from '@/components/tenants/OnboardingWizard'
import { TenantForm, TenantFormValues } from '@/components/tenants/TenantForm'
import { TenantImportModal } from '@/components/tenants/TenantImportModal'
import {
  TaggedTenant,
  useAllTenants,
  useDeleteTenantApi,
  useUpdateTenant,
} from '@/hooks/useTenants'
import { getServerById, useAuthStore } from '@/store/authStore'
import { useServerFilter } from '@/hooks/useServerFilter'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useAuth } from '@/hooks/useAuth'
import { canDeleteClient } from '@/services/supabase'
import { extractErrorMessage } from '@/api/client'
import { asText, formatDateShort, isTenantActive } from '@/lib/utils'

export function TenantsPage() {
  const tenantsQ = useAllTenants()
  const updateMut = useUpdateTenant()
  const deleteMut = useDeleteTenantApi()
  const { profile } = useAuth()
  const canDelete = canDeleteClient(profile?.role)
  const enabledServers = useAuthStore((s) => s.servers.filter((x) => x.enabled))

  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [search, setSearch] = React.useState(useSupportViewText('search'))
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>(
    useSupportViewValue<'all' | 'active' | 'inactive'>('statusFilter', 'all'),
  )
  const { selected: serverFilter, setSelected: setServerFilter } = useServerFilter()
  const [editing, setEditing] = React.useState<TaggedTenant | null>(null)
  const [deleting, setDeleting] = React.useState<TaggedTenant | null>(null)

  const openServerLogin = (t: TaggedTenant) => {
    const server = getServerById(t._serverId)
    if (!server?.loginUrl) {
      toast.error('URL de login do servidor não configurada')
      return
    }
    const opened = window.open(server.loginUrl, '_blank', 'noopener,noreferrer')
    if (!opened) {
      toast.error('Pop-up bloqueado — libere para abrir o sistema')
    }
  }

  const filtered = React.useMemo(() => {
    const list = tenantsQ.data
    const q = search.trim().toLowerCase()
    return list.filter((t) => {
      if (!serverFilter.has(t._serverId)) return false
      if (q) {
        const blob =
          asText(t.name).toLowerCase() +
          ' ' +
          asText(t.domain).toLowerCase() +
          ' ' +
          asText(t.email).toLowerCase() +
          ' ' +
          asText(t.identity).toLowerCase() +
          ' ' +
          asText(t._serverName).toLowerCase()
        if (!blob.includes(q)) return false
      }
      if (statusFilter === 'active' && !isTenantActive(t)) return false
      if (statusFilter === 'inactive' && isTenantActive(t)) return false
      return true
    })
  }, [tenantsQ.data, search, statusFilter, serverFilter])

  const onEditSubmit = async (values: TenantFormValues) => {
    if (!editing) return
    const server = getServerById(editing._serverId)
    if (!server) {
      toast.error('Servidor da linha não encontrado em Configurações')
      return
    }
    try {
      await updateMut.mutateAsync({
        server,
        payload: { id: editing.id, ...values },
      })
      toast.success('Tenant atualizado')
      setEditing(null)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const onConfirmDelete = async () => {
    if (!deleting) return
    const server = getServerById(deleting._serverId)
    if (!server) {
      toast.error('Servidor da linha não encontrado em Configurações')
      return
    }
    try {
      await deleteMut.mutateAsync({
        server,
        payload: {
          id: deleting.id,
          tenant_id: deleting.id,
          tenant: deleting.id,
          apiId: typeof deleting.apiId === 'string' ? deleting.apiId : undefined,
        },
      })
      toast.success(`"${asText(deleting.name, 'Tenant')}" excluído`)
      setDeleting(null)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const subtitle = tenantsQ.data.length
    ? `${tenantsQ.data.length} tenant(s) em ${enabledServers.length} servidor(es)`
    : undefined

  return (
    <>
      <TopBar
        title="Tenants"
        subtitle={subtitle}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setImportOpen(true)}
              disabled={tenantsQ.isLoading || tenantsQ.data.length === 0}
              leftIcon={<UserPlus className="h-4 w-4" />}
              aria-label="Importar como clientes"
            >
              <span className="hidden lg:inline">Importar como clientes</span>
            </Button>
            <Button
              onClick={() => setWizardOpen(true)}
              leftIcon={<PlusCircle className="h-4 w-4" />}
              aria-label="Novo tenant"
            >
              <span className="hidden lg:inline">Novo tenant</span>
            </Button>
          </div>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-3 lg:flex-nowrap">
            <Input
              placeholder="Buscar por nome, domínio, e-mail, identity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              containerClassName="sm:max-w-sm"
            />
            <Select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as typeof statusFilter)
              }
              options={[
                { value: 'all', label: 'Todos status' },
                { value: 'active', label: 'Ativos' },
                { value: 'inactive', label: 'Inativos' },
              ]}
              className="sm:max-w-[180px]"
            />
          </div>
          <ServerFilter
            selected={serverFilter}
            onChange={setServerFilter}
            className="flex-wrap lg:flex-nowrap"
          />
        </div>

        {tenantsQ.isLoading ? (
          <div className="overflow-x-auto no-scrollbar lg:overflow-visible" style={{ WebkitOverflowScrolling: 'touch' }}>
            <Table>
              <THead>
                <tr>
                  <TH>Nome</TH>
                  <TH>Servidor</TH>
                  <TH>Status</TH>
                  <TH>Criado em</TH>
                  <TH className="text-right">Ações</TH>
                </tr>
              </THead>
              <TBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </TBody>
            </Table>
          </div>
        ) : tenantsQ.isError && tenantsQ.data.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title="Não foi possível carregar os tenants"
            description={extractErrorMessage(tenantsQ.error)}
            action={
              <Button onClick={() => tenantsQ.refetch()} variant="secondary">
                Tentar novamente
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" />}
            title={
              tenantsQ.data.length === 0
                ? 'Nenhum tenant ainda'
                : 'Nada encontrado com esses filtros'
            }
            description={
              tenantsQ.data.length === 0
                ? 'Crie seu primeiro tenant para começar.'
                : 'Tente outra busca ou limpe os filtros.'
            }
            action={
              tenantsQ.data.length === 0 ? (
                <Button
                  onClick={() => setWizardOpen(true)}
                  leftIcon={<PlusCircle className="h-4 w-4" />}
                >
                  Criar tenant
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {tenantsQ.errorsByServer.length > 0 && (
              <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning">
                Falhas parciais:{' '}
                {tenantsQ.errorsByServer
                  .map((e) => e.server.name)
                  .join(', ')}{' '}
                — verifique tokens em Configurações.
              </div>
            )}
            <div className="overflow-x-auto no-scrollbar lg:overflow-visible" style={{ WebkitOverflowScrolling: 'touch' }}>
            <Table>
              <THead>
                <tr>
                  <TH>Nome</TH>
                  <TH>Servidor</TH>
                  <TH>Status</TH>
                  <TH>Criado em</TH>
                  <TH className="w-px text-right">Ações</TH>
                </tr>
              </THead>
              <TBody>
                {filtered.map((t) => {
                  const active = isTenantActive(t)
                  const id = `${t._serverId}:${String(t.id)}`
                  return (
                    <TR key={id}>
                      <TD>
                        <Link
                          to={`/tenants/${t._serverId}/${t.id}`}
                          className="font-medium text-foreground hover:text-accent"
                        >
                          {asText(t.name)}
                        </Link>
                        {t.domain && (
                          <div className="text-xs text-foreground/40">
                            {asText(t.domain)}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <Badge tone="info">{asText(t._serverName)}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={active ? 'success' : 'danger'} dot>
                          {active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TD>
                      <TD className="text-foreground/60">
                        {formatDateShort(t.created_at)}
                      </TD>
                      <TD className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openServerLogin(t)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-2.5 py-2.5 text-xs font-medium text-accent ring-1 ring-accent/20 hover:bg-accent/20 hover:ring-accent/40 transition-colors lg:py-1"
                            aria-label={`Acessar ${asText(t.name)}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Acessar
                          </button>
                          <TenantRowActions
                            tenant={t}
                            canDelete={canDelete}
                            onEdit={() => setEditing(t)}
                            onDelete={() => setDeleting(t)}
                          />
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            </div>
          </>
        )}
      </div>

      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />

      <TenantImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tenants={tenantsQ.data}
      />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Editar tenant${editing ? ` · ${asText(editing._serverName)}` : ''}`}
        description="Atualize os dados do tenant no servidor de origem."
        size="lg"
      >
        {editing && (
          <TenantForm
            initialTenant={editing}
            submitLabel="Salvar"
            onCancel={() => setEditing(null)}
            onSubmit={onEditSubmit}
            loading={updateMut.isPending}
          />
        )}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir tenant"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={onConfirmDelete}
              loading={deleteMut.isPending}
            >
              Excluir
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/70">
          Excluir{' '}
          <span className="font-semibold text-foreground">
            {asText(deleting?.name)}
          </span>{' '}
          do servidor{' '}
          <span className="font-semibold text-accent">
            {asText(deleting?._serverName)}
          </span>
          ? Esta ação chama{' '}
          <code className="rounded bg-elevate/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/80">
            /tenantDeleteApi
          </code>{' '}
          e não pode ser desfeita.
        </p>
      </Modal>
    </>
  )
}

/** Menu de ações (⋯) de uma linha — em portal com posição calculada (fixed), não mais
 * `position: absolute` dentro da linha. A tabela usa `overflow-hidden` (pros cantos
 * arredondados), então um dropdown posicionado ali dentro ficava cortado/invisível na última
 * linha visível — sobretudo com poucos resultados, tipo uma busca que acha 1 tenant só. O
 * botão só ABRE (nunca fecha no próprio clique, mesmo padrão do AgendamentoField): fechar de
 * novo clicando nele já é coberto pelo useOutsideClose, que dispara no mousedown antes do
 * onClick — tentar fazer o botão também fechar entraria em corrida com isso. */
function TenantRowActions({
  tenant,
  canDelete,
  onEdit,
  onDelete,
}: {
  tenant: TaggedTenant
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top: number; right: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(menuRef, open, () => setOpen(false))

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setCoords({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  return (
    <div className="relative inline-block text-left">
      <button
        ref={btnRef}
        type="button"
        aria-label="Ações"
        onClick={openMenu}
        className="rounded-md p-2.5 text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground lg:p-1.5"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: coords.top, right: coords.right }}
          className="z-50 w-44 rounded-lg border border-line bg-card shadow-xl animate-fade-in"
        >
          <Link
            to={`/tenants/${tenant._serverId}/${tenant.id}`}
            className="flex items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-elevate/[0.05]"
            onClick={() => setOpen(false)}
          >
            <ArrowRight className="h-3.5 w-3.5" />
            Ver detalhes
          </Link>
          <button
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground/80 hover:bg-elevate/[0.05]"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Editar
          </button>
          {canDelete && (
            <>
              <div className="my-1 border-t border-line" />
              <button
                onClick={() => {
                  setOpen(false)
                  onDelete()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Excluir
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
