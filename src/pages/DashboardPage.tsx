import * as React from 'react'
import {
  Building2,
  CheckCircle2,
  CircleSlash2,
  PlusCircle,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { ServerFilter } from '@/components/layout/ServerFilter'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAllTenants } from '@/hooks/useTenants'
import { useAuthStore } from '@/store/authStore'
import { OnboardingWizard } from '@/components/tenants/OnboardingWizard'
import { AlertsPanel } from '@/components/crm/AlertsPanel'
import { cn, isTenantActive } from '@/lib/utils'

export function DashboardPage() {
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const tenantsQ = useAllTenants()
  const enabledServers = useAuthStore((s) => s.servers.filter((x) => x.enabled))
  const enabledIds = React.useMemo(
    () => enabledServers.map((s) => s.id),
    [enabledServers],
  )

  const [serverFilter, setServerFilter] = React.useState<Set<string>>(
    () => new Set(enabledIds),
  )

  React.useEffect(() => {
    setServerFilter((prev) => {
      const next = new Set(prev)
      for (const id of Array.from(next)) {
        if (!enabledIds.includes(id)) next.delete(id)
      }
      if (next.size === 0) for (const id of enabledIds) next.add(id)
      return next
    })
  }, [enabledIds])

  const scopedTenants = React.useMemo(
    () => tenantsQ.data.filter((t) => serverFilter.has(t._serverId)),
    [tenantsQ.data, serverFilter],
  )

  const total = scopedTenants.length
  const actives = scopedTenants.filter(isTenantActive).length
  const inactives = total - actives

  return (
    <>
      <TopBar
        title="Dashboard"
        subtitle="Visão geral em todos os servidores"
        rightSlot={
          <Button
            onClick={() => setWizardOpen(true)}
            leftIcon={<PlusCircle className="h-4 w-4" />}
          >
            Novo tenant
          </Button>
        }
      />

      <div className="px-8 py-6">
        <div className="mb-5 flex justify-end">
          <ServerFilter selected={serverFilter} onChange={setServerFilter} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            icon={<Building2 className="h-4 w-4" />}
            label="Total de tenants"
            value={tenantsQ.isLoading ? null : total}
            tone="info"
          />
          <MetricCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Tenants ativos"
            value={tenantsQ.isLoading ? null : actives}
            tone="success"
          />
          <MetricCard
            icon={<CircleSlash2 className="h-4 w-4" />}
            label="Tenants inativos"
            value={tenantsQ.isLoading ? null : inactives}
            tone="danger"
          />
        </div>

        <section className="mt-6">
          <AlertsPanel />
        </section>
      </div>

      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </>
  )
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
  tone: 'info' | 'success' | 'danger'
}) {
  const tones = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
  }
  return (
    <div className="rounded-xl border border-line bg-card p-4 transition-colors hover:border-white/10">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-white/45">
          {label}
        </span>
        <span
          className={cn(
            'grid h-7 w-7 place-items-center rounded-lg ring-1',
            tones[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div className="mt-3">
        {value === null ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span className="text-2xl font-semibold tracking-tight text-white">
            {value.toLocaleString('pt-BR')}
          </span>
        )}
      </div>
    </div>
  )
}
