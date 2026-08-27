import { KanbanSquare, ListTodo } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Botão duplo Lista/Kanban — mesmo visual em Tarefas e Pipeline. */
export function ListKanbanToggle({
  value,
  onChange,
}: {
  value: 'list' | 'kanban'
  onChange: (v: 'list' | 'kanban') => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line">
      <ToggleBtn active={value === 'list'} onClick={() => onChange('list')} icon={<ListTodo className="h-4 w-4" />}>
        Lista
      </ToggleBtn>
      <ToggleBtn active={value === 'kanban'} onClick={() => onChange('kanban')} icon={<KanbanSquare className="h-4 w-4" />}>
        Kanban
      </ToggleBtn>
    </div>
  )
}

function ToggleBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
        active ? 'bg-accent/10 text-accent' : 'text-foreground/55 hover:bg-elevate/[0.04]',
      )}
    >
      {icon}
      {children}
    </button>
  )
}
