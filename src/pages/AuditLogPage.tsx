import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  FileSearch,
  Search,
  ShieldAlert,
  Trash2,
  UserCog,
  Settings as SettingsIcon,
  Archive,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/hooks/useAuth'
import { useAnalyticsBooted, useAuditEntries } from '@/hooks/useAnalytics'
import { canManageUsers } from '@/services/supabase'
import { cn, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { AuditEntry } from '@/types/client'

const ACTION_LABEL: Record<string, string> = {
  delete: 'Exclusão',
  role_change: 'Mudança de role',
  update: 'Edição',
  export: 'Backup exportado',
  restore: 'Backup restaurado',
}

const ENTITY_LABEL: Record<string, string> = {
  client: 'Cliente',
  profile: 'Equipe',
  settings: 'Configurações',
  backup: 'Backup',
}

function entityIcon(entity: string) {
  switch (entity) {
    case 'client':
      return <Trash2 className="h-3.5 w-3.5" />
    case 'profile':
      return <UserCog className="h-3.5 w-3.5" />
    case 'settings':
      return <SettingsIcon className="h-3.5 w-3.5" />
    case 'backup':
      return <Archive className="h-3.5 w-3.5" />
    default:
      return <ShieldAlert className="h-3.5 w-3.5" />
  }
}

function entityTone(entity: string): 'danger' | 'warning' | 'info' | 'neutral' {
  switch (entity) {
    case 'client':
      return 'danger'
    case 'profile':
      return 'warning'
    case 'settings':
      return 'info'
    case 'backup':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export function AuditLogPage() {
  const { profile, loading: authLoading } = useAuth()
  const entries = useAuditEntries()
  const booted = useAnalyticsBooted()

  const [search, setSearch] = React.useState('')
  const [entityFilter, setEntityFilter] = React.useState<string>('all')
  const [periodFilter, setPeriodFilter] = React.useState<'7d' | '30d' | '90d' | 'all'>('30d')

  const filtered = React.useMemo(() => {
    const now = Date.now()
    const periodMs: Record<typeof periodFilter, number | null> = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      all: null,
    }
    const cutoff = periodMs[periodFilter]
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (cutoff && now - new Date(e.at).getTime() > cutoff) return false
      if (entityFilter !== 'all' && e.entityType !== entityFilter) return false
      if (q) {
        const blob = (
          (e.summary ?? '') +
          ' ' +
          (e.actorName ?? '') +
          ' ' +
          (e.actorEmail ?? '') +
          ' ' +
          e.action +
          ' ' +
          (e.entityId ?? '')
        ).toLowerCase()
        if (!blob.includes(q)) return false
      }
      return true
    })
  }, [entries, periodFilter, entityFilter, search])

  if (authLoading) return null
  if (!canManageUsers(profile?.role)) return <Navigate to="/" replace />

  return (
    <>
      <TopBar
        title="Auditoria"
        subtitle={
          booted
            ? `${filtered.length} evento(s) encontrado(s)`
            : 'Carregando…'
        }
      />

      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Input
            placeholder="Buscar por usuário, resumo, id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="lg:max-w-md"
          />
          <div className="flex flex-wrap gap-2">
            <Select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Toda entidade' },
                { value: 'client', label: 'Clientes' },
                { value: 'profile', label: 'Equipe' },
                { value: 'settings', label: 'Configurações' },
                { value: 'backup', label: 'Backup' },
              ]}
            />
            <Select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)}
              options={[
                { value: '7d', label: 'Últimos 7 dias' },
                { value: '30d', label: 'Últimos 30 dias' },
                { value: '90d', label: 'Últimos 90 dias' },
                { value: 'all', label: 'Tudo' },
              ]}
            />
          </div>
        </div>

        {!booted ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileSearch className="h-5 w-5" />}
            title={entries.length === 0 ? 'Sem eventos registrados' : 'Nada encontrado'}
            description={
              entries.length === 0
                ? 'Ações sensíveis (excluir cliente, mudar role, editar settings, backup) aparecem aqui automaticamente.'
                : 'Ajuste os filtros pra ampliar a busca.'
            }
          />
        ) : (
          <ul className="space-y-2">
            {filtered.map((e) => (
              <AuditRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = React.useState(false)
  const tone = entityTone(entry.entityType)
  const hasChanges = entry.changes && Object.keys(entry.changes).length > 0
  return (
    <li
      className={cn(
        'rounded-xl border bg-card px-4 py-3',
        tone === 'danger' && 'border-danger/20',
        tone === 'warning' && 'border-warning/20',
        tone === 'info' && 'border-accent/20',
        tone === 'neutral' && 'border-line',
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
            tone === 'danger' && 'bg-danger/10 text-danger',
            tone === 'warning' && 'bg-warning/10 text-warning',
            tone === 'info' && 'bg-accent/10 text-accent',
            tone === 'neutral' && 'bg-white/[0.04] text-white/55',
          )}
        >
          {entityIcon(entry.entityType)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>
              {ENTITY_LABEL[entry.entityType] ?? entry.entityType}
            </Badge>
            <span className="text-[11px] text-white/45">
              {ACTION_LABEL[entry.action] ?? entry.action}
            </span>
            <span className="text-[11px] text-white/35">·</span>
            <span className="text-[11px] text-white/45">{timeAgo(entry.at)}</span>
          </div>
          <div className="mt-1 text-sm text-white">{entry.summary ?? '—'}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/45">
            <div className="grid h-5 w-5 place-items-center rounded-full bg-white/[0.04] text-[9px] text-white/70 ring-1 ring-line">
              {initials(entry.actorName ?? entry.actorEmail ?? '?')}
            </div>
            <span>
              {entry.actorName ?? entry.actorEmail ?? 'Sistema'}
            </span>
          </div>
          {hasChanges && (
            <button
              onClick={() => setExpanded((x) => !x)}
              className="mt-2 text-[11px] text-accent hover:underline"
            >
              {expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
            </button>
          )}
          {expanded && hasChanges && (
            <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-bg p-2 text-[11px] text-white/70">
              {JSON.stringify(entry.changes, null, 2)}
            </pre>
          )}
        </div>
        <div className="shrink-0 text-right text-[11px] text-white/45">
          {new Date(entry.at).toLocaleString('pt-BR')}
        </div>
      </div>
    </li>
  )
}

