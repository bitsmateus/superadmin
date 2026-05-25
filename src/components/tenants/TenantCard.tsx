import { Link } from 'react-router-dom'
import { ArrowUpRight, Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { asText, formatDateShort, initials, isTenantActive } from '@/lib/utils'
import type { Tenant } from '@/types'

export function TenantCard({ tenant }: { tenant: Tenant }) {
  const active = isTenantActive(tenant)
  return (
    <Link
      to={`/tenants/${tenant.id}`}
      className="group relative flex flex-col gap-4 rounded-xl border border-line bg-card p-5 transition-all hover:border-elevate/15 hover:bg-card/60 hover:shadow-glow"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-[13px] font-semibold text-accent ring-1 ring-accent/20">
            {initials(asText(tenant.name)) || <Building2 className="h-4 w-4" />}
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">{asText(tenant.name)}</h3>
            {tenant.domain && (
              <p className="mt-0.5 text-xs text-foreground/40">{String(tenant.domain)}</p>
            )}
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-foreground/30 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" />
      </div>

      <div className="flex items-center justify-between">
        <Badge tone={active ? 'success' : 'danger'} dot>
          {active ? 'Ativo' : 'Inativo'}
        </Badge>
        <span className="text-[11px] text-foreground/40">
          {formatDateShort(tenant.created_at)}
        </span>
      </div>
    </Link>
  )
}
