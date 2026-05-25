import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAsaasAutoSync } from '@/hooks/useAsaasAutoSync'
import { useTicketNotifications } from '@/hooks/useTicketNotifications'

export function Layout() {
  useAsaasAutoSync()
  useTicketNotifications()
  return (
    <div className="min-h-screen bg-bg text-white">
      <Sidebar />
      <main className="pl-[220px]">
        <div className="min-h-screen">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
