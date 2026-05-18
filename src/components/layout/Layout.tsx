import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function Layout() {
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
