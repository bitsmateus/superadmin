import * as React from 'react'
import {
  AlertTriangle,
  Bell,
  BellOff,
  Radio,
  RefreshCw,
  Search,
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
import { SkeletonRow } from '@/components/ui/Skeleton'
import { useNxChannels, useSetChannelAlert } from '@/hooks/useNxChannels'
import { channelsApi } from '@/api/channels'
import type { NxChannel, NxChannelStatus } from '@/api/channels'
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
  const [typeFilter, setTypeFilter] = React.useState('all')
  const [onlyDivergent, setOnlyDivergent] = React.useState(false)
  const [alertEditing, setAlertEditing] = React.useState<NxChannel | null>(null)

  const channels = data?.channels ?? []
  const s = data?.summary

  const types = React.useMemo(
    () => Array.from(new Set(channels.map((c) => c.type).filter(Boolean))).sort(),
    [channels],
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return channels.filter((c) => {
      if (onlyDivergent && !c.divergent) return false
      if (statusFilter !== 'all' && c.nx_status !== statusFilter) return false
      if (typeFilter !== 'all' && c.type !== typeFilter) return false
      if (!q) return true
      const blob = [c.name, c.client_name, c.client_company, c.number, c.waba_id]
        .map((x) => asText(x).toLowerCase())
        .join(' ')
      return blob.includes(q)
    })
  }, [channels, search, statusFilter, typeFilter, onlyDivergent])

  return (
    <>
      <TopBar
        title="Canais"
        subtitle={
          data?.updated_at
            ? `${channels.length} canal(is) · atualizado ${timeAgo(data.updated_at)}`
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
        {/* Cards de resumo */}
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
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
        </div>

        {/* Filtros */}
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Input
            placeholder="Buscar por canal, cliente, número…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="sm:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
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
            <div className="w-36">
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'Todos os tipos' },
                  ...types.map((t) => ({ value: t, label: t })),
                ]}
              />
            </div>
          </div>
        </div>

        {data?.errors && data.errors.length > 0 && (
          <div className="mb-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            {data.errors.length} tenant(s) não responderam (token/servidor): {' '}
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
        ) : !isLoading && filtered.length === 0 ? (
          <EmptyState
            icon={<Radio className="h-5 w-5" />}
            title={channels.length === 0 ? 'Nenhum canal encontrado' : 'Nada encontrado'}
            description={
              channels.length === 0
                ? 'Os canais aparecem aqui a partir dos tenants provisionados (com API e token).'
                : 'Tente outra busca ou limpe os filtros.'
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Canal</TH>
                <TH>Cliente</TH>
                <TH>Tipo</TH>
                <TH>Status (NX)</TH>
                <TH>Status real</TH>
                <TH>Divergência</TH>
                <TH>Número</TH>
                <TH>Aviso</TH>
              </tr>
            </THead>
            <TBody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={8} />)
                : filtered.map((c) => (
                    <TR
                      key={`${c.client_id}-${c.nx_channel_id}`}
                      className={cn(c.divergent && 'bg-danger/[0.04]')}
                    >
                      <TD>
                        <div className="font-medium text-foreground">{asText(c.name, '—')}</div>
                        {!c.is_active && (
                          <span className="text-[10px] text-foreground/40">inativo</span>
                        )}
                      </TD>
                      <TD className="text-foreground/70">
                        {asText(c.client_company || c.client_name, '—')}
                      </TD>
                      <TD>
                        <Badge tone="neutral">{asText(c.type, '—')}</Badge>
                      </TD>
                      <TD>
                        <StatusBadge status={c.nx_status} />
                      </TD>
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
                      <TD className="text-foreground/60">{asText(c.number, '—')}</TD>
                      <TD>
                        <button
                          type="button"
                          onClick={() => setAlertEditing(c)}
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
        )}
      </div>

      <AlertConfigModal channel={alertEditing} onClose={() => setAlertEditing(null)} />
    </>
  )
}

function AlertConfigModal({
  channel,
  onClose,
}: {
  channel: NxChannel | null
  onClose: () => void
}) {
  const setAlert = useSetChannelAlert()
  const [enabled, setEnabled] = React.useState(false)
  const [number, setNumber] = React.useState('')
  const [testing, setTesting] = React.useState(false)

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

  React.useEffect(() => {
    if (channel) {
      setEnabled(channel.alerts_enabled)
      setNumber(channel.alert_number ?? '')
    }
  }, [channel])

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
      description={channel ? `${channel.name} · ${channel.client_company || channel.client_name}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="secondary"
            onClick={sendTest}
            loading={testing}
            leftIcon={<Bell className="h-4 w-4" />}
          >
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
