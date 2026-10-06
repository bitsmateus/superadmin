import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Tabs } from '@/components/ui/Tabs'
import { GestaoModelos } from '@/components/gestaoClientes/GestaoModelos'
import { PainelPendencias } from '@/components/gestaoClientes/PainelPendencias'
import { gestaoClientes } from '@/services/gestaoClientes'
import { contaNoTotal } from '@/lib/gcSaude'

type Aba = 'catalogo' | 'pendencias'

/**
 * CLIENTES NX DIGITAL → Estratégias.
 *
 * Duas abas: o CATÁLOGO dos modelos de estratégia (criar, editar passos, desativar) e as
 * PENDÊNCIAS de todos os clientes numa lista só (filtrar, concluir direto).
 *
 * Aplicar uma estratégia continua sendo feito DENTRO do cliente, porque é lá que ela ganha dono,
 * prazo e checklist; aqui fica a referência e a visão da carteira.
 */
export function EstrategiasNxPage() {
  const navegar = useNavigate()
  const [aba, setAba] = React.useState<Aba>('pendencias')
  const [clientes, setClientes] = React.useState<{ id: string; nome_empresa: string }[]>([])

  React.useEffect(() => {
    gestaoClientes
      .listar()
      .then((lista) =>
        setClientes(
          lista
            .filter((c) => contaNoTotal(c))
            .map((c) => ({ id: c.id, nome_empresa: c.nome_empresa })),
        ),
      )
      .catch((err: Error) => toast.error('Falha ao carregar os clientes: ' + err.message))
  }, [])

  const abrirCliente = (id: string) => navegar(`/clientesnxdigital/clientes/${id}`)

  return (
    <>
      <TopBar
        title="Estratégias"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Estratégias' },
        ]}
      />

      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <Tabs
          value={aba}
          onChange={(v) => setAba(v as Aba)}
          items={[
            { value: 'pendencias', label: 'Pendências' },
            { value: 'catalogo', label: 'Modelos de estratégia' },
          ]}
        />

        {aba === 'pendencias' ? (
          <PainelPendencias onAbrirCliente={abrirCliente} />
        ) : (
          <GestaoModelos clientes={clientes} onAbrirCliente={abrirCliente} />
        )}
      </div>
    </>
  )
}
