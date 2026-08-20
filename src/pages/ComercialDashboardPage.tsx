import { LayoutDashboard } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { EmptyState } from '@/components/ui/EmptyState'

export function ComercialDashboardPage() {
  return (
    <>
      <TopBar title="Dashboard" subtitle="Comercial" />
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <EmptyState
          icon={<LayoutDashboard className="h-5 w-5" />}
          title="Em branco por enquanto"
          description="Essa página ainda vai ser montada."
        />
      </div>
    </>
  )
}
