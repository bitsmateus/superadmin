import { useNavigate, useLocation } from 'react-router-dom'
import { Columns3, ListChecks } from 'lucide-react'
import { useLeadPages } from '@/hooks/useLeadPages'
import { cn } from '@/lib/utils'

// "Tarefas" saiu daqui (pedido de 12/11): tarefa nova agora é o botão "Nova tarefa" do Pipeline, que vira card no CRM
// do Jean ou do João. A rota /tarefas continua existindo, só não tem mais aba.
const TABS = [
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
]

/** Abas no topo do Pipeline: o funil de clientes e, depois dele, os CRMs do time do suporte (abas de Demandas com
 * no_pipeline: Jean, João), só os que a pessoa enxerga. Some numa "cópia" do menu (/visao/:id) — lá a navegação é
 * outra, já resolvida pelo SupportViewContext. */
export function PipelineSectionTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const crms = useLeadPages()
    .filter((p) => p.section === 'demandas' && p.noPipeline)
    .map((p) => ({ to: `/pipeline/crm/${p.id}`, label: p.name, icon: ListChecks }))
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 sm:px-6 lg:px-8">
      {[...TABS, ...crms].map((t) => {
        const active = location.pathname === t.to
        const Icon = t.icon
        return (
          <button
            key={t.to}
            type="button"
            onClick={() => navigate(t.to)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-accent/10 text-accent ring-1 ring-accent/25'
                : 'text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
