import * as React from 'react'
import { TopBar } from '@/components/layout/TopBar'
import { KanbanDemandas } from '@/components/gestaoClientes/KanbanDemandas'
import { gestaoClientes } from '@/services/gestaoClientes'

/** O kanban geral: as demandas de TODOS os clientes NX Digital num quadro só. */
export function DemandasNxPage() {
  const [clientes, setClientes] = React.useState<{ id: string; nome_empresa: string }[]>([])
  React.useEffect(() => {
    gestaoClientes
      .listar()
      .then((l) => setClientes(l.map((c) => ({ id: c.id, nome_empresa: c.nome_empresa })).sort((a, b) => a.nome_empresa.localeCompare(b.nome_empresa))))
      .catch(() => undefined)
  }, [])

  return (
    <>
      <TopBar
        compacto
        title="Kanban demandas"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Kanban demandas' },
        ]}
      />
      <div className="px-4 pb-10 lg:px-6">
        <KanbanDemandas clientes={clientes} />
      </div>
    </>
  )
}
