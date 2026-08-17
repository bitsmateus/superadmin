import type { LucideIcon } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { EmptyState } from '@/components/ui/EmptyState'

export interface ComercialBlankPageProps {
  title: string
  icon: LucideIcon
}

export function ComercialBlankPage({ title, icon: Icon }: ComercialBlankPageProps) {
  return (
    <>
      <TopBar title={title} subtitle="Em construção" />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <EmptyState
          icon={<Icon className="h-5 w-5" />}
          title="Nada por aqui ainda"
          description="Esta área está em construção."
        />
      </div>
    </>
  )
}
