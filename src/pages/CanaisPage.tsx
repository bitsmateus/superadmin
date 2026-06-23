import * as React from 'react'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Building2,
  ChevronDown,
  ChevronRight,
  Link2,
  Radio,
  RefreshCw,
  Search,
  Unlink,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Skeleton } from '@/components/ui/Skeleton'
import { useNxChannels, useSetChannelAlert, useAssignChannel } from '@/hooks/useNxChannels'
import { useClients } from '@/hooks/useClients'
import { channelsApi } from '@/api/channels'
import type { NxChannel, NxChannelStatus, OrphanInstance } from '@/api/channels'
import { extractErrorMessage } from '@/api/client'
import { asText, cn } from '@/lib/utils'
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
  const [search, setSearch] = React.useState('')
  const [statusFilter, setStatusFilter] = React.useState<NxChannelStatus | 'all'>('all')
  const [onlyDivergent, setOnlyDivergent] = React.useState(false)
  const [alertEditing, setAlertEditing] = React.useState<NxChannel | null>(null)
  const [assigning, setAssigning] = React.useState<OrphanInstance | null>(null)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())
  const assign = useAssignChannel()

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

  // Agrupa os canais por tenant (cliente).
  const groups = React.useMemo(() => {
    const map = new Map<string, { key: string; label: string; channels: NxChannel[] }>()
    for (const c of filteredChannels) {
      const key = c.client_id || '_none'
      const label = c.client_company || c.client_name || '(sem cliente)'
      if (!map.has(key)) map.set(key, { key, label, channels: [] })
      map.get(key)!.channels.push(c)
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [filteredChannels])

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

      <div className="px-8 py-6">
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
          <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {data.errors.length} tenant(s) não responderam (token/servidor):{' '}
            {data.errors.slice(0, 3).map((e) => e.client).join(', ')}
            {data.errors.length > 3 ? '…' : ''}
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
                  <button
                    type="button"
                    onClick={() => toggleCollapsed(g.key)}
                    className="flex w-full items-center gap-2 border-b border-line px-4 py-2.5 text-left hover:bg-elevate/[0.02]"
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
                  {!isCollapsed && (
                    <ChannelTable
                      channels={g.channels}
                      onConfigAlert={setAlertEditing}
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
                <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                  <Link2 className="h-4 w-4 text-warning" />
                  <span className="text-sm font-semibold text-foreground">Números avulsos</span>
                  <span className="text-xs text-foreground/45">
                    {filteredOrphans.length} sem tenant atribuído
                  </span>
                </header>
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
                    {filteredOrphans.map((o) => (
                      <TR key={`${o.provider}:${o.instance_key}`}>
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
                          <Button size="sm" variant="secondary" onClick={() => setAssigning(o)} leftIcon={<Link2 className="h-3.5 w-3.5" />}>
                            Atribuir
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            )}
          </div>
        )}
      </div>

      <AlertConfigModal channel={alertEditing} onClose={() => setAlertEditing(null)} />
      <AssignModal orphan={assigning} onClose={() => setAssigning(null)} />
    </>
  )
}

function ChannelTable({
  channels,
  onConfigAlert,
  onUnassign,
}: {
  channels: NxChannel[]
  onConfigAlert: (c: NxChannel) => void
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
                onClick={() => onConfigAlert(c)}
                title="Configurar aviso de queda"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  c.alerts_enabled
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-line text-foreground/45 hover:text-foreground/80',
                )}
              >
                {c.alerts_enabled ? (
                  <>
                    <Bell className="h-3 w-3" />
                    {asText(c.alert_number, 'ligado')}
                  </>
                ) : (
                  <>
                    <BellOff className="h-3 w-3" />
                    Desligado
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

function AlertConfigModal({ channel, onClose }: { channel: NxChannel | null; onClose: () => void }) {
  const setAlert = useSetChannelAlert()
  const [enabled, setEnabled] = React.useState(false)
  const [number, setNumber] = React.useState('')
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    if (channel) {
      setEnabled(channel.alerts_enabled)
      setNumber(channel.alert_number ?? '')
    }
  }, [channel])

  const sendTest = async () => {
    if (!number.trim()) {
      toast.error('Informe o número para enviar o teste.')
      return
    }
    setTesting(true)
    try {
      await channelsApi.sendAlertTest(number.trim())
      toast.success('Teste enviado — confira o WhatsApp do número.')
    } catch (e) {
      toast.error('Falha no teste: ' + extractErrorMessage(e, 'erro'))
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    if (enabled && !number.trim()) {
      toast.error('Informe o número que vai receber o alerta.')
      return
    }
    if (!channel) return
    setAlert.mutate(
      { channel_key: channel.channel_key, alerts_enabled: enabled, alert_number: number.trim() || undefined },
      {
        onSuccess: () => {
          toast.success('Aviso atualizado')
          onClose()
        },
        onError: (e) => toast.error('Falha ao salvar: ' + extractErrorMessage(e, 'erro')),
      },
    )
  }

  return (
    <Modal
      open={Boolean(channel)}
      onClose={onClose}
      title="Aviso de queda do canal"
      description={channel ? `${channel.name} · ${channel.client_company || channel.client_name || '—'}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={sendTest} loading={testing} leftIcon={<Bell className="h-4 w-4" />}>
            Enviar teste
          </Button>
          <Button onClick={save} loading={setAlert.isPending}>
            Salvar
          </Button>
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
          Enviar aviso quando este canal cair
        </label>
        <Input
          label="Número que recebe o alerta"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="55 62 99999-9999"
        />
        <p className="rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-[11px] text-foreground/55">
          🔒 O alerta vai <strong>somente</strong> para este número (envio pela credencial de
          suporte). Nunca é enviado para o cliente. Avisa 1× por queda, por um job a cada 3 min.
          Use <strong>Enviar teste</strong> para validar o número agora.
        </p>
      </div>
    </Modal>
  )
}

function AssignModal({ orphan, onClose }: { orphan: OrphanInstance | null; onClose: () => void }) {
  const clients = useClients()
  const assign = useAssignChannel()
  const [clientId, setClientId] = React.useState('')
  const [q, setQ] = React.useState('')

  React.useEffect(() => {
    setClientId('')
    setQ('')
  }, [orphan])

  const options = React.useMemo(() => {
    const ql = q.trim().toLowerCase()
    return clients
      .filter((c) => !ql || (c.company || c.name).toLowerCase().includes(ql))
      .slice(0, 50)
      .map((c) => ({ value: c.id, label: c.company || c.name }))
  }, [clients, q])

  const save = () => {
    if (!clientId) {
      toast.error('Selecione um cliente.')
      return
    }
    if (!orphan) return
    assign.mutate(
      { provider: orphan.provider, instance_key: orphan.instance_key, client_id: clientId },
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
          <Button onClick={save} loading={assign.isPending}>
            Vincular
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          placeholder="Buscar cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
        />
        <Select
          label="Cliente"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[{ value: '', label: '— Selecione —' }, ...options]}
        />
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
