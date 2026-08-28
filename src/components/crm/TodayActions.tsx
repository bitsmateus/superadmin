import * as React from 'react'
import { CheckCircle2, ChevronRight, Copy, ListTodo } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { useClients, useCurrentUser, useSettings } from '@/hooks/useClients'
import { computeAlerts, type AlertKind, type CrmAlert } from '@/lib/crmAlerts'
import { db } from '@/services/db'
import { cn } from '@/lib/utils'

// Tipos de alerta que representam uma AÇÃO que o operador deve fazer hoje
// (cobrar, enviar, configurar, dar follow-up) — exclui os informativos.
const ACTIONABLE: AlertKind[] = [
  'briefing_pending_send',
  'briefing_sent_waiting',
  'briefing_filled_no_setup',
  'setup_in_progress',
  'delivery_scheduled',
  'followup_pending',
]

const ACTION_LABEL: Record<string, string> = {
  briefing_pending_send: 'Enviar link do briefing',
  briefing_sent_waiting: 'Cobrar briefing do cliente',
  briefing_filled_no_setup: 'Iniciar configuração',
  setup_in_progress: 'Continuar configuração',
  delivery_scheduled: 'Reunião de entrega',
  followup_pending: 'Enviar follow-up',
}

const TONE_ORDER: Record<CrmAlert['tone'], number> = {
  danger: 0,
  warning: 1,
  info: 2,
  success: 3,
}

function norm(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * Donos do cliente: responsável comercial e de entrega. Se ambos vazios, cai
 * para o campo legado `responsavel` (dados antigos). Um cliente pode ter dois
 * donos (comercial ≠ entrega) — ambos contam como "meu" no filtro.
 */
function clientOwners(c: {
  responsavel?: string
  responsavelComercial?: string
  responsavelEntrega?: string
}): string[] {
  const out: string[] = []
  const push = (v?: string) => {
    const t = v?.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  push(c.responsavelComercial)
  push(c.responsavelEntrega)
  if (out.length === 0) push(c.responsavel)
  return out
}

export function TodayActions() {
  const clients = useClients()
  const [currentUser] = useCurrentUser()
  const settings = useSettings()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [filter, setFilter] = React.useState<string>('all') // 'all' | 'mine' | <nome>

  const alerts = React.useMemo(
    () => computeAlerts(clients, settings.slaByStage),
    [clients, settings.slaByStage],
  )

  // Responsáveis distintos (comercial + entrega) pra montar o filtro.
  const responsaveis = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of clients) {
      for (const o of clientOwners(c)) set.add(o)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [clients])

  const actions = React.useMemo(() => {
    const list = alerts.filter((a) => ACTIONABLE.includes(a.kind))
    const filtered = list.filter((a) => {
      if (filter === 'all') return true
      const owners = clientOwners(a.client).map(norm)
      if (filter === 'mine') return owners.includes(norm(currentUser))
      return owners.includes(norm(filter))
    })
    return filtered.sort((a, b) => {
      const t = TONE_ORDER[a.tone] - TONE_ORDER[b.tone]
      if (t !== 0) return t
      const ta = a.whenAt ? new Date(a.whenAt).getTime() : Number.MAX_SAFE_INTEGER
      const tb = b.whenAt ? new Date(b.whenAt).getTime() : Number.MAX_SAFE_INTEGER
      return ta - tb
    })
  }, [alerts, filter, currentUser])

  return (
    <section className="rounded-2xl border border-line bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
            <ListTodo className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="text-sm font-medium text-foreground">Minhas ações de hoje</h3>
            <p className="text-[11px] text-foreground/45">
              O que precisa de atenção, por ordem de urgência
            </p>
          </div>
          <Badge tone={actions.length === 0 ? 'neutral' : 'warning'} dot={actions.length > 0}>
            {actions.length}
          </Badge>
        </div>

        <div className="flex items-center gap-1.5">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            Todos
          </FilterChip>
          <FilterChip active={filter === 'mine'} onClick={() => setFilter('mine')}>
            Meus
          </FilterChip>
          {responsaveis.length > 0 && (
            <select
              value={filter === 'all' || filter === 'mine' ? '' : filter}
              onChange={(e) => setFilter(e.target.value || 'all')}
              className="h-7 rounded-lg border border-line bg-elevate/[0.04] px-2 text-xs text-foreground/70 outline-none focus:border-accent/40"
            >
              <option value="">Responsável…</option>
              {responsaveis.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      {actions.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-foreground/40">
          Nada pendente para {filter === 'mine' ? 'você' : 'este filtro'} agora. 🎉
        </p>
      ) : (
        <ul
          className={cn(
            'divide-y divide-line',
            actions.length > 6 && 'max-h-[26rem] overflow-y-auto',
          )}
        >
          {actions.slice(0, 30).map((a) => (
            <ActionRow
              key={`${a.kind}-${a.client.id}-${a.followUp?.id ?? a.whenAt ?? ''}`}
              alert={a}
              onOpen={() => setOpenId(a.client.id)}
            />
          ))}
        </ul>
      )}

      <ClientDrawer clientId={openId} onClose={() => setOpenId(null)} />
    </section>
  )
}

function ActionRow({ alert, onOpen }: { alert: CrmAlert; onOpen: () => void }) {
  const markSent = () => {
    if (!alert.followUp) return
    const next = (alert.client.followUps ?? []).map((f) =>
      f.id === alert.followUp!.id ? { ...f, sentAt: new Date().toISOString() } : f,
    )
    db.updateClient(alert.client.id, { followUps: next })
    db.addLog(alert.client.id, `Follow-up dia ${alert.followUp.dayNumber} enviado`)
    toast.success('Marcado como enviado')
  }

  const copyMessage = async () => {
    const text = alert.message ?? alert.followUp?.message
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Mensagem copiada')
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const dotCls = {
    danger: 'bg-danger',
    warning: 'bg-warning',
    info: 'bg-accent',
    success: 'bg-success',
  }[alert.tone]

  const owners = clientOwners(alert.client)

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
        }}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevate/[0.03]"
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dotCls)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {ACTION_LABEL[alert.kind] ?? alert.title}
          </p>
          <p className="truncate text-[11px] text-foreground/50">{alert.title}</p>
        </div>
        {owners.length > 0 && (
          <span className="hidden shrink-0 truncate rounded-full bg-elevate/[0.05] px-2 py-0.5 text-[10px] text-foreground/45 sm:block">
            {owners.join(' / ')}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {alert.followUp && (
            <>
              <Button size="sm" variant="ghost" onClick={copyMessage} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                Copiar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={markSent}
                leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
              >
                Enviado
              </Button>
            </>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-foreground/25" />
      </div>
    </li>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
        active
          ? 'bg-accent/10 text-accent ring-accent/30'
          : 'bg-elevate/[0.04] text-foreground/55 ring-line hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}
