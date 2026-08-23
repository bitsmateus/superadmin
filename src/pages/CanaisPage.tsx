import * as React from 'react'
import {
  AlertTriangle,
  Archive,
  Bell,
  BellOff,
  Building2,
  ChevronDown,
  ChevronRight,
  KeyRound,
  Link2,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { TopBar } from '@/components/layout/TopBar'
import { useSupportViewValue, useSupportViewText } from '@/components/support/SupportViewContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useNxChannels,
  useChannelReport,
  useSetChannelAlert,
  useAssignChannel,
  useDeleteInstance,
  useArchiveOrphans,
} from '@/hooks/useNxChannels'
import { useClients } from '@/hooks/useClients'
import { channelsApi } from '@/api/channels'
import type { NxChannel, NxChannelStatus, OrphanInstance } from '@/api/channels'
import { tenantsApi } from '@/api/tenants'
import type { Tenant } from '@/types'
import { extractErrorMessage } from '@/api/client'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { useAuthStore } from '@/store/authStore'
import { asText, cn, normalizeWhatsappNumber } from '@/lib/utils'
import { timeAgo } from '@/lib/time'

const STATUS_META: Record<
  NxChannelStatus,
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  connected: { label: 'Conectado', tone: 'success' },
  disconnected: { label: 'Desconectado', tone: 'danger' },
  connecting: { label: 'Conectando', tone: 'warning' },
  unknown: { label: 'Desconhecido', tone: 'neutral' },
}

function StatusBadge({ status }: { status: NxChannelStatus | null }) {
  if (!status) return <span className="text-foreground/30">—</span>
  const m = STATUS_META[status]
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  )
}

export function CanaisPage() {
  const { data, isLoading, isError, error, isFetching, refetch } = useNxChannels()
  const [view, setView] = React.useState<'canais' | 'relatorios'>(
    useSupportViewValue<'canais' | 'relatorios'>('view', 'canais'),
  )
  const [search, setSearch] = React.useState(useSupportViewText('search'))
  const [statusFilter, setStatusFilter] = React.useState<NxChannelStatus | 'all'>('all')
  const [notifyFilter, setNotifyFilter] = React.useState<'all' | 'on' | 'off'>(
    useSupportViewValue<'all' | 'on' | 'off'>('notifyFilter', 'all'),
  )
  const [onlyDivergent, setOnlyDivergent] = React.useState(false)
  const [assigning, setAssigning] = React.useState<OrphanInstance | null>(null)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const [tokenEditingId, setTokenEditingId] = React.useState<string | null>(null)
  const [notifyEditingId, setNotifyEditingId] = React.useState<string | null>(null)
  const [serverTenantsOpen, setServerTenantsOpen] = React.useState(false)
  const assign = useAssignChannel()
  const deleteInstance = useDeleteInstance()
  const archiveOrphans = useArchiveOrphans()
  const setChannelAlert = useSetChannelAlert()
  const clients = useClients()
  const clientsById = React.useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const [selectedOrphans, setSelectedOrphans] = React.useState<Set<string>>(new Set())
  const [archivedOpen, setArchivedOpen] = React.useState(false)

  const toggleChannelAlert = (c: NxChannel, enabled: boolean) => {
    setChannelAlert.mutate(
      { channel_key: c.channel_key, alerts_enabled: enabled },
      { onError: (e) => toast.error('Falha: ' + extractErrorMessage(e, 'erro')) },
    )
  }

  const orphanKey = (o: OrphanInstance) => `${o.provider}:${o.instance_key}`
  const toggleOrphan = (o: OrphanInstance) =>
    setSelectedOrphans((prev) => {
      const next = new Set(prev)
      const k = orphanKey(o)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const archiveSelected = () => {
    const items = (data?.orphans ?? [])
      .filter((o) => selectedOrphans.has(orphanKey(o)))
      .map((o) => ({ provider: o.provider, instance_key: o.instance_key, name: o.name, number: o.number }))
    if (items.length === 0) return
    archiveOrphans.mutate(
      { items, archived: true },
      {
        onSuccess: () => {
          toast.success(`${items.length} avulso(s) arquivado(s)`)
          setSelectedOrphans(new Set())
        },
        onError: (e) => toast.error('Falha ao arquivar: ' + extractErrorMessage(e, 'erro')),
      },
    )
  }

  const restoreOrphan = (o: OrphanInstance) => {
    archiveOrphans.mutate(
      { items: [{ provider: o.provider, instance_key: o.instance_key, name: o.name, number: o.number }], archived: false },
      {
        onSuccess: () => toast.success('Avulso restaurado'),
        onError: (e) => toast.error('Falha ao restaurar: ' + extractErrorMessage(e, 'erro')),
      },
    )
  }

  const removeOrphan = (o: OrphanInstance) => {
    if (
      !window.confirm(
        `Excluir a instância "${o.name}" no ${o.provider}?\n\n` +
          'Esta ação é IRREVERSÍVEL e apaga a instância no servidor (UAZAPI/Evolution).',
      )
    )
      return
    deleteInstance.mutate(
      { provider: o.provider, instance_key: o.instance_key, server: o.server },
      {
        onSuccess: () => toast.success('Instância excluída no provedor'),
        onError: (e) => toast.error('Falha ao excluir: ' + extractErrorMessage(e, 'erro')),
      },
    )
  }

  // Arquivar o tenant = arquivar o CLIENTE (mesmo archivedAt do pipeline/lista).
  // Sai do pipeline, da lista de clientes e dos canais; pode restaurar em Arquivados.
  const archiveTenant = (clientId: string, label: string) => {
    if (
      !window.confirm(
        `Arquivar "${label}"?\n\nO cliente sai do pipeline, da lista de clientes e dos canais. ` +
          'Você pode restaurá-lo depois em Arquivados.',
      )
    )
      return
    db.archiveClient(clientId)
    toast.success('Cliente arquivado')
    refetch()
  }

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const channels = data?.channels ?? []
  const orphans = data?.orphans ?? []
  const s = data?.summary

  const matchSearch = (blobParts: (string | null)[]) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return blobParts.map((x) => asText(x).toLowerCase()).join(' ').includes(q)
  }

  const filteredChannels = React.useMemo(() => {
    return channels.filter((c) => {
      if (onlyDivergent && !c.divergent) return false
      if (statusFilter !== 'all' && c.effective_status !== statusFilter) return false
      return matchSearch([c.name, c.client_name, c.client_company, c.number, c.waba_id])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, search, statusFilter, onlyDivergent])

  const filteredOrphans = React.useMemo(() => {
    if (onlyDivergent) return []
    return orphans.filter((o) => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      return matchSearch([o.name, o.number, o.provider])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphans, search, statusFilter, onlyDivergent])

  const visibleOrphanKeys = filteredOrphans.map(orphanKey)
  const allOrphansSelected =
    visibleOrphanKeys.length > 0 && visibleOrphanKeys.every((k) => selectedOrphans.has(k))
  const toggleAllOrphans = () =>
    setSelectedOrphans((prev) => {
      const next = new Set(prev)
      if (allOrphansSelected) visibleOrphanKeys.forEach((k) => next.delete(k))
      else visibleOrphanKeys.forEach((k) => next.add(k))
      return next
    })

  // Agrupa os canais por tenant (cliente).
  const groups = React.useMemo(() => {
    const map = new Map<string, { key: string; label: string; channels: NxChannel[] }>()
    for (const c of filteredChannels) {
      const key = c.client_id || '_none'
      const label = c.client_company || c.client_name || '(sem cliente)'
      if (!map.has(key)) map.set(key, { key, label, channels: [] })
      map.get(key)!.channels.push(c)
    }
    let arr = [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
    if (notifyFilter !== 'all') {
      arr = arr.filter((g) => {
        const cid = g.channels[0]?.client_id
        const on = cid ? Boolean(clientsById.get(cid)?.channelNotifyEnabled) : false
        return notifyFilter === 'on' ? on : !on
      })
    }
    return arr
  }, [filteredChannels, notifyFilter, clientsById])

  const nothing = !isLoading && groups.length === 0 && filteredOrphans.length === 0

  return (
    <>
      <TopBar
        title="Canais"
        subtitle={
          data?.updated_at
            ? `${channels.length} canal(is) · ${orphans.length} avulso(s) · atualizado ${timeAgo(data.updated_at)}`
            : `${channels.length} canal(is)`
        }
        rightSlot={
          <Button
            variant="secondary"
            onClick={() => refetch()}
            loading={isFetching}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            Atualizar
          </Button>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-5 inline-flex rounded-xl border border-line bg-card p-1">
          <button
            type="button"
            onClick={() => setView('canais')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              view === 'canais' ? 'bg-accent text-white' : 'text-foreground/60 hover:text-foreground',
            )}
          >
            Canais
          </button>
          <button
            type="button"
            onClick={() => setView('relatorios')}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
              view === 'relatorios' ? 'bg-accent text-white' : 'text-foreground/60 hover:text-foreground',
            )}
          >
            Relatórios
          </button>
        </div>

        {view === 'relatorios' ? (
          <ChannelReportPanel />
        ) : (
        <>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <SummaryCard label="Total" value={s?.total} tone="neutral" icon={<Radio className="h-4 w-4" />} />
          <SummaryCard label="Conectados" value={s?.connected} tone="success" icon={<Wifi className="h-4 w-4" />} />
          <SummaryCard label="Desconectados" value={s?.disconnected} tone="danger" icon={<WifiOff className="h-4 w-4" />} />
          <SummaryCard label="Conectando" value={s?.connecting} tone="warning" icon={<RefreshCw className="h-4 w-4" />} />
          <SummaryCard
            label="Divergências"
            value={s?.divergent}
            tone={(s?.divergent ?? 0) > 0 ? 'danger' : 'neutral'}
            icon={<AlertTriangle className="h-4 w-4" />}
            onClick={() => setOnlyDivergent((v) => !v)}
            active={onlyDivergent}
          />
          <SummaryCard label="Avulsos" value={s?.orphans} tone="warning" icon={<Link2 className="h-4 w-4" />} />
        </div>

        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input
            placeholder="Buscar por canal, cliente, número…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setServerTenantsOpen(true)}
              leftIcon={<Building2 className="h-3.5 w-3.5" />}
            >
              Tenants do servidor
            </Button>
            {groups.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const allKeys = groups.map((g) => g.key)
                  const allCollapsed = allKeys.every((k) => collapsed.has(k))
                  setCollapsed(allCollapsed ? new Set() : new Set(allKeys))
                }}
              >
                {groups.every((g) => collapsed.has(g.key)) ? 'Expandir todos' : 'Recolher todos'}
              </Button>
            )}
            <label className="inline-flex items-center gap-2 text-xs text-foreground/70">
              <input
                type="checkbox"
                checked={onlyDivergent}
                onChange={(e) => setOnlyDivergent(e.target.checked)}
                className="h-4 w-4 accent-[#4F8EF7]"
              />
              Só divergências
            </label>
            <div className="w-44">
              <Select
                value={notifyFilter}
                onChange={(e) => setNotifyFilter(e.target.value as 'all' | 'on' | 'off')}
                options={[
                  { value: 'all', label: 'Notificação: todas' },
                  { value: 'on', label: 'Com notificação ativa' },
                  { value: 'off', label: 'Sem notificação ativa' },
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as NxChannelStatus | 'all')}
                options={[
                  { value: 'all', label: 'Todos os status' },
                  { value: 'connected', label: 'Conectados' },
                  { value: 'disconnected', label: 'Desconectados' },
                  { value: 'connecting', label: 'Conectando' },
                  { value: 'unknown', label: 'Desconhecido' },
                ]}
              />
            </div>
          </div>
        </div>

        {data?.providerErrors && data.providerErrors.length > 0 && (
          <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            Falha ao consultar provedor: {data.providerErrors.join(' · ')}
          </div>
        )}
        {data?.errors && data.errors.length > 0 && (
          <div className="mb-3 overflow-hidden rounded-lg border border-danger/30 bg-danger/5">
            <div className="px-3 py-2 text-xs font-medium text-danger">
              {data.errors.length} tenant(s) já vinculado(s) com erro ao listar canais (token/servidor):
            </div>
            <ul className="divide-y divide-line/60">
              {data.errors.map((e) => (
                <li key={e.client_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-foreground/80">
                    {e.client} <span className="text-danger/70">· {e.error}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setTokenEditingId(e.client_id)}
                    leftIcon={<KeyRound className="h-3.5 w-3.5" />}
                  >
                    Editar / Testar token
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isError ? (
          <EmptyState
            icon={<WifiOff className="h-5 w-5" />}
            title="Não foi possível carregar os canais"
            description={extractErrorMessage(error, 'Tente novamente.')}
          />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : nothing ? (
          <EmptyState
            icon={<Radio className="h-5 w-5" />}
            title={channels.length === 0 && orphans.length === 0 ? 'Nenhum canal encontrado' : 'Nada encontrado'}
            description={
              channels.length === 0 && orphans.length === 0
                ? 'Os canais aparecem a partir dos tenants (com API + token) e das instâncias da UAZAPI/Evolution.'
                : 'Tente outra busca ou limpe os filtros.'
            }
          />
        ) : (
          <div className="space-y-5">
            {/* Por tenant */}
            {groups.map((g) => {
              const isCollapsed = collapsed.has(g.key)
              const down = g.channels.filter((c) => c.effective_status === 'disconnected').length
              return (
                <section key={g.key} className="overflow-hidden rounded-xl border border-line bg-card">
                  <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(g.key)}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-foreground/45" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-foreground/45" />
                      )}
                      <Building2 className="h-4 w-4 text-accent" />
                      <span className="text-sm font-semibold text-foreground">{g.label}</span>
                      <span className="text-xs text-foreground/45">{g.channels.length} canal(is)</span>
                      {down > 0 && (
                        <Badge tone="danger" className="ml-1">
                          {down} desconectado(s)
                        </Badge>
                      )}
                    </button>
                    {g.channels[0]?.client_id && (
                      <>
                        {(() => {
                          const on = clientsById.get(g.channels[0].client_id!)?.channelNotifyEnabled
                          return (
                            <button
                              type="button"
                              title="Notificação de queda do tenant"
                              onClick={() => setNotifyEditingId(g.channels[0].client_id!)}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 transition-colors',
                                on
                                  ? 'bg-success/10 text-success ring-success/30'
                                  : 'text-foreground/55 ring-line hover:bg-elevate/[0.06] hover:text-foreground',
                              )}
                            >
                              {on ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                              Notificar
                            </button>
                          )
                        })()}
                        <button
                          type="button"
                          title="Editar / testar token do tenant"
                          onClick={() => setTokenEditingId(g.channels[0].client_id!)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-foreground/55 ring-1 ring-line hover:bg-elevate/[0.06] hover:text-foreground"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Token
                        </button>
                        <button
                          type="button"
                          title="Arquivar cliente (sai do pipeline, clientes e canais)"
                          onClick={() => archiveTenant(g.channels[0].client_id!, g.label)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-foreground/55 ring-1 ring-line hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          Arquivar
                        </button>
                      </>
                    )}
                  </div>
                  {!isCollapsed && (
                    <ChannelTable
                      channels={g.channels}
                      onToggleAlert={toggleChannelAlert}
                      onUnassign={(c) =>
                        assign.mutate(
                          { provider: c.type, instance_key: c.token_api || c.waba_id || '', client_id: null },
                          {
                            onSuccess: () => toast.success('Vínculo removido (voltou para avulsos)'),
                            onError: (e) => toast.error('Falha: ' + extractErrorMessage(e, 'erro')),
                          },
                        )
                      }
                    />
                  )}
                </section>
              )
            })}

            {/* Avulsos */}
            {filteredOrphans.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-warning/30 bg-card">
                <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
                  <Link2 className="h-4 w-4 text-warning" />
                  <span className="text-sm font-semibold text-foreground">Números avulsos</span>
                  <span className="text-xs text-foreground/45">
                    {filteredOrphans.length} sem tenant atribuído
                  </span>
                  {selectedOrphans.size > 0 && (
                    <div className="ml-auto flex items-center gap-2">
                      <span className="text-xs text-foreground/70">{selectedOrphans.size} selecionado(s)</span>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={archiveOrphans.isPending}
                        onClick={archiveSelected}
                        leftIcon={<Archive className="h-3.5 w-3.5" />}
                      >
                        Arquivar selecionados
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedOrphans(new Set())}>
                        Limpar
                      </Button>
                    </div>
                  )}
                </header>
                <Table>
                  <THead>
                    <tr>
                      <TH className="w-px">
                        <input
                          type="checkbox"
                          checked={allOrphansSelected}
                          onChange={toggleAllOrphans}
                          className="h-4 w-4 accent-[#4F8EF7]"
                          aria-label="Selecionar todos"
                        />
                      </TH>
                      <TH>Instância</TH>
                      <TH>Provedor</TH>
                      <TH>Número</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Ação</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {filteredOrphans.map((o) => (
                      <TR key={`${o.provider}:${o.instance_key}`}>
                        <TD>
                          <input
                            type="checkbox"
                            checked={selectedOrphans.has(orphanKey(o))}
                            onChange={() => toggleOrphan(o)}
                            className="h-4 w-4 accent-[#4F8EF7]"
                            aria-label={`Selecionar ${o.name}`}
                          />
                        </TD>
                        <TD>
                          <div className="font-medium text-foreground">{asText(o.name, '—')}</div>
                          {o.server && <div className="text-[11px] text-foreground/40">{o.server}</div>}
                        </TD>
                        <TD>
                          <Badge tone="neutral">{o.provider}</Badge>
                        </TD>
                        <TD className="text-foreground/60">{asText(o.number, '—')}</TD>
                        <TD>
                          <StatusBadge status={o.status} />
                        </TD>
                        <TD className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => setAssigning(o)} leftIcon={<Link2 className="h-3.5 w-3.5" />}>
                              Atribuir
                            </Button>
                            <button
                              type="button"
                              title="Arquivar (esconder sem excluir no provedor)"
                              onClick={() =>
                                archiveOrphans.mutate(
                                  { items: [{ provider: o.provider, instance_key: o.instance_key, name: o.name, number: o.number }], archived: true },
                                  {
                                    onSuccess: () => toast.success('Avulso arquivado'),
                                    onError: (e) => toast.error('Falha: ' + extractErrorMessage(e, 'erro')),
                                  },
                                )
                              }
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 ring-1 ring-line hover:bg-elevate/[0.06] hover:text-foreground"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              title="Excluir instância no provedor (irreversível)"
                              onClick={() => removeOrphan(o)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 ring-1 ring-line hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            )}

            {/* Avulsos arquivados — minimizado por padrão */}
            {(data?.archivedOrphans?.length ?? 0) > 0 && (
              <section className="overflow-hidden rounded-xl border border-line bg-card">
                <button
                  type="button"
                  onClick={() => setArchivedOpen((o) => !o)}
                  className="flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-left hover:bg-elevate/[0.02]"
                >
                  {archivedOpen ? (
                    <ChevronDown className="h-4 w-4 text-foreground/45" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-foreground/45" />
                  )}
                  <Archive className="h-4 w-4 text-foreground/45" />
                  <span className="text-sm font-semibold text-foreground">Avulsos arquivados</span>
                  <span className="text-xs text-foreground/45">{data!.archivedOrphans.length}</span>
                </button>
                {archivedOpen && (
                <Table>
                  <THead>
                    <tr>
                      <TH>Instância</TH>
                      <TH>Provedor</TH>
                      <TH>Número</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Ação</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {data!.archivedOrphans.map((o) => (
                      <TR key={`arch:${o.provider}:${o.instance_key}`} className="opacity-70">
                        <TD>
                          <div className="font-medium text-foreground">{asText(o.name, '—')}</div>
                          {o.server && <div className="text-[11px] text-foreground/40">{o.server}</div>}
                        </TD>
                        <TD>
                          <Badge tone="neutral">{o.provider}</Badge>
                        </TD>
                        <TD className="text-foreground/60">{asText(o.number, '—')}</TD>
                        <TD>
                          <StatusBadge status={o.status} />
                        </TD>
                        <TD className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button size="sm" variant="secondary" onClick={() => restoreOrphan(o)}>
                              Restaurar
                            </Button>
                            <button
                              type="button"
                              title="Excluir instância no provedor (irreversível)"
                              onClick={() => removeOrphan(o)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 ring-1 ring-line hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                )}
              </section>
            )}

            {/* Tenants sem token vinculado */}
            {(data?.unlinkedTenants?.length ?? 0) > 0 && (
              <section className="overflow-hidden rounded-xl border border-warning/30 bg-card">
                <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <KeyRound className="h-4 w-4 text-warning" />
                  <span className="text-sm font-semibold text-foreground">Tenants sem token vinculado</span>
                  <span className="text-xs text-foreground/45">
                    {data!.unlinkedTenants.length} cliente(s) — vincule o token para listar os canais
                  </span>
                </header>
                <Table>
                  <THead>
                    <tr>
                      <TH>Cliente</TH>
                      <TH>Servidor</TH>
                      <TH>Tenant ID</TH>
                      <TH>API ID</TH>
                      <TH className="text-right">Ação</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {data!.unlinkedTenants.map((t) => (
                      <TR key={t.client_id}>
                        <TD className="font-medium text-foreground">{asText(t.company || t.name, '—')}</TD>
                        <TD className="text-foreground/60">{asText(t.server_id, '—')}</TD>
                        <TD className="text-foreground/60">{asText(t.tenant_id, '—')}</TD>
                        <TD className="text-foreground/60">{asText(t.tenant_api_id, '—')}</TD>
                        <TD className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setTokenEditingId(t.client_id)}
                              leftIcon={<KeyRound className="h-3.5 w-3.5" />}
                            >
                              Vincular token
                            </Button>
                            <button
                              type="button"
                              title="Arquivar cliente"
                              onClick={() => archiveTenant(t.client_id, t.company || t.name)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 ring-1 ring-line hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            )}
          </div>
        )}
        </>
        )}
      </div>

      <TenantNotifyModal clientId={notifyEditingId} onClose={() => setNotifyEditingId(null)} />
      <AssignModal orphan={assigning} onClose={() => setAssigning(null)} />
      <TenantTokenModal clientId={tokenEditingId} onClose={() => setTokenEditingId(null)} />
      <ServerTenantsModal open={serverTenantsOpen} onClose={() => setServerTenantsOpen(false)} />
    </>
  )
}

function TenantTokenModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const servers = useAuthStore((s) => s.servers)
  const qc = useQueryClient()
  const client = clientId ? db.getClient(clientId) : undefined
  const [serverId, setServerId] = React.useState('')
  const [tenantId, setTenantId] = React.useState('')
  const [apiId, setApiId] = React.useState('')
  const [token, setToken] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    setServerId(client?.tenantServerId ?? '')
    setTenantId(client?.tenantId ?? '')
    setApiId(client?.tenantApiId ?? '')
    setToken(client?.tenantApiToken ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const test = async () => {
    if (!apiId.trim() || !token.trim()) {
      toast.error('Preencha API ID e token para testar.')
      return
    }
    setTesting(true)
    try {
      const r = await channelsApi.testTenant({ server_id: serverId, api_id: apiId.trim(), token: token.trim() })
      if (r.ok) {
        toast.success(
          r.count > 0
            ? `OK — ${r.count} canal(is): ${(r.names ?? []).filter(Boolean).join(', ')}`
            : 'Token válido, mas a NX retornou 0 canais para este tenant.',
        )
      } else {
        toast.error(`Falhou${r.status ? ` (HTTP ${r.status})` : ''} — verifique servidor/API ID/token.${r.error ? ' ' + r.error : ''}`)
      }
    } catch (e) {
      toast.error('Falha no teste: ' + extractErrorMessage(e, 'erro'))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!clientId) return
    setSaving(true)
    try {
      // Persiste no banco e AGUARDA — só então reconcilia, senão o list rodaria
      // antes do token gravar (corrida) e não listaria/moveria os avulsos.
      await api.patch(`/api/clients/${clientId}`, {
        tenant_server_id: serverId || null,
        tenant_id: tenantId.trim() || null,
        tenant_api_id: apiId.trim() || null,
        tenant_api_token: token.trim() || null,
      })
      // Sincroniza a cache do CRM (perfil do cliente) com o servidor.
      await db.loadFullClient(clientId)
      db.addLog(clientId, 'Tenant/token vinculado (via Canais)')
      toast.success('Token vinculado — listando canais e movendo avulsos…')
      // Token já persistido → reconcile lista os canais do tenant e os avulsos
      // que casam (por token/nome) deixam de ser avulsos e entram no tenant.
      await qc.invalidateQueries({ queryKey: ['nx-channels'] })
      onClose()
    } catch (e) {
      toast.error('Falha ao vincular: ' + extractErrorMessage(e, 'erro'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={Boolean(clientId)}
      onClose={onClose}
      title="Vincular tenant / token"
      description={client ? client.company || client.name : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={test} loading={testing} leftIcon={<KeyRound className="h-4 w-4" />}>
            Testar
          </Button>
          <Button onClick={save} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Select
          label="Servidor"
          value={serverId}
          onChange={(e) => setServerId(e.target.value)}
          options={[{ value: '', label: '— Selecione —' }, ...servers.map((sv) => ({ value: sv.id, label: sv.name }))]}
        />
        <Input label="Tenant ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="ID do tenant" />
        <Input label="API ID" value={apiId} onChange={(e) => setApiId(e.target.value)} placeholder="apiId do tenant" />
        <Input
          label="API Token (do tenant)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Cole o token da API do tenant"
        />
        <p className="text-[11px] text-foreground/45">
          Necessário para listar os canais do tenant. Salvar atualiza o cliente e recarrega os canais.
        </p>
      </div>
    </Modal>
  )
}

function ServerTenantsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const allServers = useAuthStore((s) => s.servers)
  const servers = React.useMemo(() => allServers.filter((s) => s.enabled), [allServers])
  const clients = useClients()
  const qc = useQueryClient()

  const [serverId, setServerId] = React.useState(() => servers[0]?.id ?? '')
  const [tenantList, setTenantList] = React.useState<Tenant[]>([])
  const [loading, setLoading] = React.useState(false)
  const [tenantSearch, setTenantSearch] = React.useState('')
  const [linkingId, setLinkingId] = React.useState<string | null>(null)
  const [linkApiId, setLinkApiId] = React.useState('')
  const [linkToken, setLinkToken] = React.useState('')
  const [clientSearch, setClientSearch] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const loadTenants = async () => {
    const server = servers.find((s) => s.id === serverId) ?? servers[0]
    if (!server) { toast.error('Selecione um servidor'); return }
    setLoading(true)
    setTenantList([])
    setLinkingId(null)
    try {
      const list = await tenantsApi.list(server)
      setTenantList(list)
      if (list.length === 0) toast.info('Nenhum tenant encontrado neste servidor')
    } catch (err) {
      toast.error('Erro ao listar tenants: ' + extractErrorMessage(err, 'erro'))
    } finally {
      setLoading(false)
    }
  }

  const doLink = async (tenant: Tenant, clientId: string) => {
    const apiId = linkApiId.trim() || String(tenant.apiId ?? tenant.id)
    const token = linkToken.trim()
    setSaving(true)
    try {
      await api.patch(`/api/clients/${clientId}`, {
        tenant_server_id: serverId,
        tenant_id: String(tenant.id),
        tenant_api_id: apiId || null,
        tenant_api_token: token || null,
      })
      await db.loadFullClient(clientId)
      db.addLog(clientId, 'Tenant vinculado (via Canais)', `${tenant.name} · ID ${tenant.id}`)
      toast.success(`Tenant "${tenant.name}" vinculado`)
      await qc.invalidateQueries({ queryKey: ['nx-channels'] })
      setLinkingId(null)
    } catch (err) {
      toast.error('Falha ao vincular: ' + extractErrorMessage(err, 'erro'))
    } finally {
      setSaving(false)
    }
  }

  const filteredTenants = React.useMemo(() => {
    if (!tenantSearch) return tenantList
    const q = tenantSearch.toLowerCase()
    return tenantList.filter(
      (t) => t.name.toLowerCase().includes(q) || String(t.id).includes(q),
    )
  }, [tenantList, tenantSearch])

  const filteredClients = React.useMemo(() => {
    if (!clientSearch) return clients.slice(0, 60)
    const q = clientSearch.toLowerCase()
    return clients
      .filter((c) => [c.company, c.name, c.email].some((x) => asText(x).toLowerCase().includes(q)))
      .slice(0, 60)
  }, [clients, clientSearch])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tenants do servidor"
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <div className="space-y-4">
        {/* Servidor + carregar */}
        <div className="flex gap-2">
          {servers.length > 1 && (
            <div className="flex-1">
              <Select
                value={serverId}
                onChange={(e) => { setServerId(e.target.value); setTenantList([]); setLinkingId(null) }}
                options={servers.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
          )}
          <Button
            onClick={loadTenants}
            loading={loading}
            leftIcon={loading ? undefined : <RefreshCw className="h-4 w-4" />}
          >
            {tenantList.length > 0 ? 'Recarregar' : 'Carregar tenants'}
          </Button>
        </div>

        {/* Busca */}
        {tenantList.length > 0 && (
          <Input
            placeholder="Buscar tenant por nome ou ID…"
            value={tenantSearch}
            onChange={(e) => setTenantSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
        )}

        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-foreground/45">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando tenants…
          </div>
        )}

        {/* Lista de tenants */}
        {!loading && filteredTenants.length > 0 && (
          <ul className="max-h-[55vh] overflow-y-auto divide-y divide-line rounded-xl border border-line">
            {filteredTenants.map((t) => (
              <li key={t.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{t.name}</p>
                    <p className="text-[11px] text-foreground/45">
                      ID: {t.id}
                      {t.email ? ` · ${t.email}` : ''}
                    </p>
                  </div>
                  {linkingId !== String(t.id) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setLinkingId(String(t.id))
                        setLinkApiId(String(t.apiId ?? t.id))
                        setLinkToken(
                          (t.api_token as string | undefined) ??
                          (t.api_key as string | undefined) ??
                          '',
                        )
                        setClientSearch('')
                      }}
                      leftIcon={<Link2 className="h-3.5 w-3.5" />}
                    >
                      Vincular
                    </Button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setLinkingId(null)}
                      className="text-xs text-foreground/40 hover:text-foreground/70"
                    >
                      ✕ Cancelar
                    </button>
                  )}
                </div>

                {/* Painel inline de vínculo */}
                {linkingId === String(t.id) && (
                  <div className="mt-3 space-y-3 rounded-lg border border-line/60 bg-elevate/[0.02] p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        label="API ID"
                        value={linkApiId}
                        onChange={(e) => setLinkApiId(e.target.value)}
                        placeholder={String(t.id)}
                      />
                      <Input
                        label="Token"
                        value={linkToken}
                        onChange={(e) => setLinkToken(e.target.value)}
                        placeholder="(opcional)"
                      />
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-foreground/55">
                        Vincular ao cliente:
                      </p>
                      <Input
                        placeholder="Buscar cliente…"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        leftIcon={<Search className="h-4 w-4" />}
                      />
                      <ul className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-line divide-y divide-line/50">
                        {filteredClients.length === 0 ? (
                          <li className="px-3 py-3 text-center text-xs text-foreground/40">
                            Nenhum cliente encontrado
                          </li>
                        ) : (
                          filteredClients.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                onClick={() => doLink(t, c.id)}
                                disabled={saving}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-elevate/[0.04] disabled:opacity-50"
                              >
                                <span className="min-w-0 truncate text-foreground/85">
                                  {asText(c.company || c.name, '—')}
                                </span>
                                {saving ? (
                                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-foreground/40" />
                                ) : c.tenantId ? (
                                  <Badge tone="neutral" className="shrink-0 text-[10px]">
                                    vinculado
                                  </Badge>
                                ) : null}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

function ChannelTable({
  channels,
  onToggleAlert,
  onUnassign,
}: {
  channels: NxChannel[]
  onToggleAlert: (c: NxChannel, enabled: boolean) => void
  onUnassign: (c: NxChannel) => void
}) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>Canal</TH>
          <TH>Tipo</TH>
          <TH>Status (NX)</TH>
          <TH>Status real</TH>
          <TH>Divergência</TH>
          <TH>Aviso</TH>
        </tr>
      </THead>
      <TBody>
        {channels.map((c) => (
          <TR key={c.channel_key} className={cn(c.divergent && 'bg-danger/[0.04]')}>
            <TD>
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{asText(c.name, '—')}</span>
                {c.source === 'provider' && (
                  <button
                    type="button"
                    title="Desvincular (voltar para avulsos)"
                    onClick={() => onUnassign(c)}
                    className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-foreground/45 hover:text-danger"
                  >
                    <Unlink className="h-3 w-3" /> vinculado
                  </button>
                )}
              </div>
              {c.number && <div className="text-[11px] text-foreground/40">{c.number}</div>}
            </TD>
            <TD>
              <Badge tone="neutral">{asText(c.type, '—')}</Badge>
            </TD>
            <TD>{c.source === 'provider' ? <span className="text-foreground/30">—</span> : <StatusBadge status={c.nx_status} />}</TD>
            <TD>
              <StatusBadge status={c.real_status} />
            </TD>
            <TD>
              {c.divergent ? (
                <Badge tone="danger">
                  <AlertTriangle className="h-3 w-3" />
                  Divergência
                </Badge>
              ) : c.real_status ? (
                <span className="text-xs text-success">OK</span>
              ) : (
                <span className="text-xs text-foreground/30">não verificado</span>
              )}
            </TD>
            <TD>
              <button
                type="button"
                onClick={() => onToggleAlert(c, !c.alerts_enabled)}
                title={c.alerts_enabled ? 'Avisar se cair (clique para desligar)' : 'Não avisar (clique para ligar)'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  c.alerts_enabled
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-line text-foreground/45 hover:text-foreground/80',
                )}
              >
                {c.alerts_enabled ? (
                  <>
                    <Bell className="h-3 w-3" /> Sim
                  </>
                ) : (
                  <>
                    <BellOff className="h-3 w-3" /> Não
                  </>
                )}
              </button>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

function TenantNotifyModal({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const client = clientId ? db.getClient(clientId) : undefined
  const [enabled, setEnabled] = React.useState(false)
  const [number, setNumber] = React.useState('')
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    setEnabled(Boolean(client?.channelNotifyEnabled))
    // Default = telefone do cliente (Visão Geral).
    setNumber(client?.channelNotifyNumber ?? client?.phone ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const sendTest = async () => {
    const num = normalizeWhatsappNumber(number)
    if (!num) {
      toast.error('Informe o número para enviar o teste.')
      return
    }
    setNumber(num)
    setTesting(true)
    try {
      await channelsApi.sendAlertTest(num)
      toast.success('Teste enviado — confira o WhatsApp do número.')
    } catch (e) {
      toast.error('Falha no teste: ' + extractErrorMessage(e, 'erro'))
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    if (!clientId) return
    // Sempre salva no padrão 55(ddd)(numero), ex.: 5548991764454.
    const num = normalizeWhatsappNumber(number)
    if (enabled && !num) {
      toast.error('Informe o número que vai receber os avisos.')
      return
    }
    setNumber(num)
    db.updateClient(clientId, {
      channelNotifyEnabled: enabled,
      channelNotifyNumber: num || undefined,
    })
    db.addLog(clientId, enabled ? 'Notificação de canais ligada' : 'Notificação de canais desligada')
    toast.success('Notificação atualizada')
    onClose()
  }

  return (
    <Modal
      open={Boolean(clientId)}
      onClose={onClose}
      title="Notificação de queda — tenant"
      description={client ? client.company || client.name : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={sendTest} loading={testing} leftIcon={<Bell className="h-4 w-4" />}>
            Enviar teste
          </Button>
          <Button onClick={save}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-foreground/80">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Avisar quando um canal deste tenant cair
        </label>
        <Input
          label="Número que recebe o aviso"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onBlur={() => setNumber((n) => normalizeWhatsappNumber(n))}
          placeholder="5548991764454"
          hint="Salvo sempre no padrão 55(DDD)(número), ex.: 5548991764454. Pode colar com espaços/traços."
        />
        <p className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-[11px] text-foreground/55">
          Quando ligado, o job (a cada 3 min) avisa este número se algum canal marcado como
          <strong> "Sim"</strong> cair — 1× por queda. Marque/desmarque os canais na coluna
          <strong> Aviso</strong> da tabela.
        </p>
      </div>
    </Modal>
  )
}

const ASSIGN_SERVERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os servidores' },
  { value: 'chat', label: 'Chat' },
  { value: 'app', label: 'App' },
  { value: 'web', label: 'Web' },
]

function AssignModal({ orphan, onClose }: { orphan: OrphanInstance | null; onClose: () => void }) {
  const clients = useClients()
  const assign = useAssignChannel()
  const [clientId, setClientId] = React.useState('')
  const [q, setQ] = React.useState('')
  const [server, setServer] = React.useState('all')

  React.useEffect(() => {
    setClientId('')
    setQ('')
    setServer('all')
  }, [orphan])

  const matches = React.useMemo(() => {
    const ql = q.trim().toLowerCase()
    return clients
      .filter((c) => {
        if (server !== 'all' && (c.tenantServerId ?? '') !== server) return false
        if (!ql) return true
        return [c.company, c.name, c.email].some((x) => asText(x).toLowerCase().includes(ql))
      })
      .slice(0, 100)
  }, [clients, q, server])

  const doAssign = (id: string) => {
    if (!orphan) return
    assign.mutate(
      { provider: orphan.provider, instance_key: orphan.instance_key, client_id: id },
      {
        onSuccess: () => {
          toast.success('Número vinculado ao cliente')
          onClose()
        },
        onError: (e) => toast.error('Falha ao vincular: ' + extractErrorMessage(e, 'erro')),
      },
    )
  }

  return (
    <Modal
      open={Boolean(orphan)}
      onClose={onClose}
      title="Atribuir número a um cliente"
      description={orphan ? `${orphan.name} · ${orphan.provider}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => doAssign(clientId)} loading={assign.isPending} disabled={!clientId}>
            Vincular
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Digite o nome do cliente…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="flex-1"
          />
          <div className="w-40">
            <Select value={server} onChange={(e) => setServer(e.target.value)} options={ASSIGN_SERVERS} />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-foreground/45">Nenhum cliente encontrado.</p>
          ) : (
            <ul className="divide-y divide-line/60">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setClientId(c.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                      clientId === c.id ? 'bg-accent/10 text-accent' : 'hover:bg-elevate/[0.04] text-foreground/85',
                    )}
                  >
                    <span className="min-w-0 truncate">{asText(c.company || c.name, '—')}</span>
                    {c.tenantServerId && (
                      <Badge tone="neutral" className="shrink-0">
                        {c.tenantServerId}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-foreground/45">
          Apenas um vínculo local — não altera nada na NX/UAZAPI/Evolution. O número passa a
          aparecer sob este cliente.
        </p>
      </div>
    </Modal>
  )
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
  onClick,
  active,
}: {
  label: string
  value?: number
  tone: 'success' | 'danger' | 'warning' | 'neutral'
  icon: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const toneCls: Record<string, string> = {
    success: 'text-success',
    danger: 'text-danger',
    warning: 'text-warning',
    neutral: 'text-foreground/70',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-xl border bg-card p-4 text-left transition-colors',
        onClick ? 'cursor-pointer hover:bg-elevate/[0.03]' : 'cursor-default',
        active ? 'border-accent/50 ring-1 ring-accent/30' : 'border-line',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-foreground/45">{label}</span>
        <span className={toneCls[tone]}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value ?? '—'}</div>
    </button>
  )
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ChannelReportPanel() {
  const { data, isLoading, isError, error, isFetching, refetch } = useChannelReport()
  const s = data?.summary
  const down = data?.disconnected ?? []
  const events = data?.events ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground/50">
          {data?.updated_at ? `Atualizado ${timeAgo(data.updated_at)}` : ''}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => refetch()}
          loading={isFetching}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Desconectados agora"
          value={s?.disconnected_now}
          tone={(s?.disconnected_now ?? 0) > 0 ? 'danger' : 'success'}
          icon={<WifiOff className="h-4 w-4" />}
        />
        <SummaryCard
          label="Quedas (24h)"
          value={s?.disconnects_24h}
          tone={(s?.disconnects_24h ?? 0) > 0 ? 'warning' : 'neutral'}
          icon={<WifiOff className="h-4 w-4" />}
        />
        <SummaryCard
          label="Divergências"
          value={s?.divergent_now}
          tone={(s?.divergent_now ?? 0) > 0 ? 'danger' : 'neutral'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <SummaryCard label="Total de canais" value={s?.total} tone="neutral" icon={<Radio className="h-4 w-4" />} />
      </div>

      {isError ? (
        <EmptyState
          icon={<WifiOff className="h-5 w-5" />}
          title="Não foi possível carregar o relatório"
          description={extractErrorMessage(error, 'Tente novamente.')}
        />
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <>
          {/* Desconectados agora — ordenados por mais tempo fora */}
          <section className="overflow-hidden rounded-xl border border-line bg-card">
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <WifiOff className="h-4 w-4 text-danger" />
              <span className="text-sm font-semibold text-foreground">Desconectados agora</span>
              <span className="text-xs text-foreground/45">{down.length} canal(is)</span>
            </header>
            {down.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-foreground/50">
                Nenhum canal desconectado no momento. 🎉
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Canal</TH>
                    <TH>Cliente</TH>
                    <TH>Número</TH>
                    <TH>Desde</TH>
                    <TH>Tempo fora</TH>
                  </tr>
                </THead>
                <TBody>
                  {down.map((c) => (
                    <TR key={c.channel_key}>
                      <TD className="font-medium text-foreground">
                        {asText(c.name, '—')}
                        {c.divergent && (
                          <Badge tone="danger" className="ml-2">
                            divergente
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-foreground/70">{asText(c.client_name, '(sem cliente)')}</TD>
                      <TD className="text-foreground/60">{asText(c.number, '—')}</TD>
                      <TD className="text-foreground/60">{fmtDateTime(c.since)}</TD>
                      <TD className="text-foreground/80">{c.since ? timeAgo(c.since) : '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>

          {/* Histórico recente de quedas e retornos */}
          <section className="overflow-hidden rounded-xl border border-line bg-card">
            <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
              <RefreshCw className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-foreground">Histórico recente</span>
              <span className="text-xs text-foreground/45">últimas {events.length} mudanças</span>
            </header>
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-foreground/50">
                Sem histórico ainda. As quedas e retornos aparecem aqui conforme o monitoramento roda (a cada 3 min).
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Quando</TH>
                    <TH>Evento</TH>
                    <TH>Canal</TH>
                    <TH>Cliente</TH>
                    <TH>Número</TH>
                  </tr>
                </THead>
                <TBody>
                  {events.map((e, i) => (
                    <TR key={`${e.channel_key}-${e.changed_at}-${i}`}>
                      <TD className="text-foreground/60" title={fmtDateTime(e.changed_at)}>
                        {timeAgo(e.changed_at)}
                      </TD>
                      <TD>
                        {e.status === 'disconnected' ? (
                          <Badge tone="danger" dot>
                            Caiu
                          </Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Voltou
                          </Badge>
                        )}
                      </TD>
                      <TD className="font-medium text-foreground">{asText(e.channel_name, '—')}</TD>
                      <TD className="text-foreground/70">{asText(e.client_name, '(sem cliente)')}</TD>
                      <TD className="text-foreground/60">{asText(e.channel_number, '—')}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  )
}
