import * as React from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { cn } from '@/lib/utils'
import { useAsaasAutoSync } from '@/hooks/useAsaasAutoSync'
import { useTicketNotifications } from '@/hooks/useTicketNotifications'

const isDesktop = () =>
  typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches

export function Layout() {
  useAsaasAutoSync()
  useTicketNotifications()

  // Aberto por padrão no desktop, fechado no celular/tablet.
  const [open, setOpen] = React.useState(isDesktop)

  return (
    <div className="min-h-screen bg-bg text-foreground">
      {/* Backdrop — só no mobile/tablet, ao abrir o menu */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          aria-hidden
        />
      )}

      <Sidebar
        open={open}
        onClose={() => setOpen(false)}
        onToggle={() => setOpen((o) => !o)}
      />

      {/* Botão flutuante para reabrir o menu quando recolhido */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="fixed left-3 top-3 z-40 grid h-10 w-10 place-items-center rounded-lg border border-line bg-sidebar text-foreground/70 shadow-sm transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      <main
        className={cn(
          'transition-[padding] duration-200 ease-out',
          open ? 'lg:pl-[220px]' : 'pl-0',
        )}
      >
        <div className="min-h-screen">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
