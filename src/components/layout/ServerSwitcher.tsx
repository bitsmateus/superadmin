import * as React from 'react'
import { Check, ChevronDown, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

export function ServerSwitcher() {
  const servers = useAuthStore((s) => s.servers)
  const selectedServerId = useAuthStore((s) => s.selectedServerId)
  const setSelectedServer = useAuthStore((s) => s.setSelectedServer)
  const active = servers.find((s) => s.id === selectedServerId) ?? servers[0]

  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!active) return null

  const enabledServers = servers.filter((s) => s.enabled)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-left',
          'text-sm text-white/85 transition-colors hover:bg-white/[0.06] focus-ring',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent ring-1 ring-accent/30">
            <Server className="h-3 w-3" />
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-white/40">
              Servidor
            </span>
            <span className="truncate font-medium">{active.name}</span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-white/40 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-lg border border-line bg-card shadow-2xl animate-fade-in">
          <ul className="py-1">
            {enabledServers.length === 0 && (
              <li className="px-3 py-2 text-xs text-white/40">
                Nenhum servidor habilitado
              </li>
            )}
            {enabledServers.map((s) => {
              const isActive = s.id === active.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedServer(s.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-white/[0.05] text-white'
                        : 'text-white/70 hover:bg-white/[0.04] hover:text-white',
                    )}
                  >
                    <span className="flex flex-col items-start leading-tight">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[10px] text-white/40">
                        {s.baseUrl.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                    {isActive && (
                      <Check className="ml-auto h-3.5 w-3.5 text-accent" />
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
