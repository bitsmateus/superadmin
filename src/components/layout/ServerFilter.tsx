import { Server } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'

export interface ServerFilterProps {
  selected: Set<string>
  onChange: (next: Set<string>) => void
  className?: string
}

export function ServerFilter({ selected, onChange, className }: ServerFilterProps) {
  const servers = useAuthStore((s) => s.servers.filter((x) => x.enabled))
  if (servers.length === 0) return null

  const allSelected = servers.every((s) => selected.has(s.id))

  const selectAll = () => onChange(new Set(servers.map((s) => s.id)))

  // Radio-style: clicking a server selects ONLY that server
  const selectOne = (id: string) => onChange(new Set([id]))

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <span className="mr-1 text-[10px] uppercase tracking-wider text-foreground/40 flex items-center gap-1">
        <Server className="h-3 w-3" />
        Servidor
      </span>
      <button
        type="button"
        onClick={selectAll}
        className={cn(
          'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          allSelected
            ? 'bg-elevate/[0.08] text-foreground ring-1 ring-line'
            : 'text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground',
        )}
      >
        Todos
      </button>
      {servers.map((s) => {
        const active = !allSelected && selected.has(s.id)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => selectOne(s.id)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              active
                ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                : 'text-foreground/55 hover:bg-elevate/[0.04] hover:text-foreground',
            )}
          >
            {s.name}
          </button>
        )
      })}
    </div>
  )
}
