import * as React from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import {
  executeImportPlan,
  matchTenantsToClients,
  type ImportPlanItem,
  type TenantMatchRow,
} from '@/services/tenantImport'
import { useClients } from '@/hooks/useClients'
import { type TaggedTenant } from '@/hooks/useTenants'
import { asText, isTenantActive } from '@/lib/utils'

export function TenantImportModal({
  open,
  onClose,
  tenants,
}: {
  open: boolean
  onClose: () => void
  tenants: TaggedTenant[]
}) {
  const clients = useClients()
  const result = React.useMemo(
    () => matchTenantsToClients(tenants, clients),
    [tenants, clients],
  )

  // Action por tenant key. Default:
  //  - linked → skip (já vinculado)
  //  - suggest_link → link (aceita sugestão)
  //  - new → create
  const [actions, setActions] = React.useState<Record<string, ImportPlanItem['action']>>({})
  const [running, setRunning] = React.useState(false)
  const [done, setDone] = React.useState<null | {
    created: number
    linked: number
    skipped: number
    errors: number
  }>(null)

  React.useEffect(() => {
    if (!open) {
      setActions({})
      setDone(null)
      return
    }
    const next: Record<string, ImportPlanItem['action']> = {}
    for (const r of result.rows) {
      const key = keyOf(r)
      if (r.kind === 'linked') next[key] = 'skip'
      else if (r.kind === 'suggest_link') next[key] = 'link'
      else next[key] = 'create'
    }
    setActions(next)
  }, [open, result])

  const setAction = (key: string, action: ImportPlanItem['action']) => {
    setActions((prev) => ({ ...prev, [key]: action }))
  }

  const plan: ImportPlanItem[] = result.rows.map((r) => ({
    tenant: r.tenant,
    action: actions[keyOf(r)] ?? 'skip',
    existing: r.candidate,
  }))

  const planCreate = plan.filter((p) => p.action === 'create').length
  const planLink = plan.filter((p) => p.action === 'link').length
  const planSkip = plan.filter((p) => p.action === 'skip').length

  const run = async () => {
    setRunning(true)
    try {
      const r = await executeImportPlan(plan)
      if (r.errors.length > 0) {
        toast.error(`${r.errors.length} erro(s) no import`)
      }
      setDone({
        created: r.created,
        linked: r.linked,
        skipped: r.skipped,
        errors: r.errors.length,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao importar')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar tenants como clientes"
      description="Cada tenant ativo vira um Client no CRM (stage 'Ativo'). Os já vinculados são pulados."
      size="xl"
      footer={
        done ? (
          <Button onClick={onClose}>Fechar</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={running}>
              Cancelar
            </Button>
            <Button
              onClick={run}
              loading={running}
              disabled={planCreate + planLink === 0}
            >
              {planCreate + planLink === 0
                ? 'Nada para importar'
                : `Importar (${planCreate} criar, ${planLink} vincular, ${planSkip} ignorar)`}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="grid place-items-center py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" />
          <p className="mt-3 text-sm text-white">Import concluído</p>
          <p className="mt-1 text-xs text-white/55">
            {done.created} criado(s), {done.linked} vinculado(s), {done.skipped}{' '}
            ignorado(s)
            {done.errors > 0 && (
              <> · <span className="text-danger">{done.errors} erro(s)</span></>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <Summary
            total={result.rows.length}
            linked={result.linkedCount}
            suggest={result.suggestCount}
            news={result.newCount}
          />

          {result.rows.length === 0 ? (
            <div className="rounded-lg border border-line bg-white/[0.02] px-3 py-4 text-center text-sm text-white/55">
              Nenhum tenant disponível nos servidores habilitados.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-line bg-white/[0.02] px-3 py-2 text-[10px] uppercase tracking-wider text-white/45">
                <span>Tenant</span>
                <span>Servidor</span>
                <span>Status</span>
                <span className="text-right">Ação</span>
              </div>
              <ul className="max-h-[44vh] overflow-y-auto divide-y divide-white/[0.04]">
                {result.rows.map((r) => {
                  const key = keyOf(r)
                  const action = actions[key] ?? 'skip'
                  return (
                    <li
                      key={key}
                      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white">
                          {asText(r.tenant.name, 'Sem nome')}
                        </div>
                        <div className="truncate text-[11px] text-white/45">
                          {r.kind === 'linked' && r.candidate && (
                            <>↔ {r.candidate.company || r.candidate.name} (já vinculado)</>
                          )}
                          {r.kind === 'suggest_link' && r.candidate && (
                            <>
                              ↔ {r.candidate.company || r.candidate.name} ·
                              <span className="ml-1 text-warning">
                                sugestão via {r.via === 'email' ? 'e-mail' : 'nome'}
                              </span>
                            </>
                          )}
                          {r.kind === 'new' && (
                            <>{asText(r.tenant.email) || 'sem e-mail no tenant'}</>
                          )}
                        </div>
                      </div>
                      <Badge tone="info">{r.tenant._serverName}</Badge>
                      <Badge tone={isTenantActive(r.tenant) ? 'success' : 'neutral'} dot>
                        {isTenantActive(r.tenant) ? 'Ativo' : 'Inativo'}
                      </Badge>
                      <div className="justify-self-end">
                        <ActionPicker
                          kind={r.kind}
                          value={action}
                          onChange={(v) => setAction(key, v)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {result.suggestCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {result.suggestCount} sugestão(ões) automática(s) por
                e-mail/nome. Revise antes de confirmar — se o cliente do CRM
                não é o mesmo tenant, mude pra "Criar novo".
              </span>
            </div>
          )}

          {running && (
            <div className="grid place-items-center py-3 text-sm text-white/55">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Importando…
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Summary({
  total,
  linked,
  suggest,
  news,
}: {
  total: number
  linked: number
  suggest: number
  news: number
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Stat label="Tenants" value={total} />
      <Stat label="Já vinculados" value={linked} tone="success" />
      <Stat label="Sugestões" value={suggest} tone="warning" />
      <Stat label="Novos" value={news} tone="info" />
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'success' | 'info' | 'warning'
}) {
  const tones = {
    neutral: 'text-white',
    success: 'text-success',
    info: 'text-accent',
    warning: 'text-warning',
  }
  return (
    <div className="rounded-lg border border-line bg-white/[0.02] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-white/45">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${tones[tone]}`}>
        {value}
      </div>
    </div>
  )
}

function ActionPicker({
  kind,
  value,
  onChange,
}: {
  kind: TenantMatchRow['kind']
  value: ImportPlanItem['action']
  onChange: (v: ImportPlanItem['action']) => void
}) {
  // Opções variam conforme o tipo de linha
  const options: { value: ImportPlanItem['action']; label: string }[] = []
  if (kind === 'linked') {
    options.push({ value: 'skip', label: 'Ignorar (já vinculado)' })
  } else if (kind === 'suggest_link') {
    options.push({ value: 'link', label: 'Vincular ao existente' })
    options.push({ value: 'create', label: 'Criar novo' })
    options.push({ value: 'skip', label: 'Ignorar' })
  } else {
    options.push({ value: 'create', label: 'Criar novo' })
    options.push({ value: 'skip', label: 'Ignorar' })
  }

  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as ImportPlanItem['action'])}
      options={options}
      className="!h-8 !text-xs min-w-[170px]"
    />
  )
}

function keyOf(r: TenantMatchRow): string {
  return `${r.tenant._serverId}:${String(r.tenant.id)}`
}
