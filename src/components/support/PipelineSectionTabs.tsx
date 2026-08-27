import { useNavigate, useLocation } from 'react-router-dom'
import { Columns3, ListTodo } from 'lucide-react'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/pipeline', label: 'Pipeline', icon: Columns3 },
  { to: '/tarefas', label: 'Tarefas', icon: ListTodo },
]

/** Alterna entre Pipeline e Tarefas sem precisar passar pelo menu lateral — as duas telas viraram
 * uma coisa só do ponto de vista de quem trabalha nelas (funil de clientes + demandas do dia a
 * dia), então esse par de abas fica no topo das duas, pra trocar direto. Some numa "cópia" do
 * menu (/visao/:id) — lá a navegação é outra, já resolvida pelo SupportViewContext. */
export function PipelineSectionTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 sm:px-6 lg:px-8">
      {TABS.map((t) => {
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
