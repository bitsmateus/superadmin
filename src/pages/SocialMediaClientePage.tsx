import * as React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { SocialDoCliente } from '@/components/gestaoClientes/SocialDoCliente'
import { gestaoClientes } from '@/services/gestaoClientes'

/** O espaço de social media de um cliente (a designer anexa material, os editores pegam a produção). */
export function SocialMediaClientePage() {
  const { id = '' } = useParams<{ id: string }>()
  const navegar = useNavigate()
  const [nome, setNome] = React.useState('')

  React.useEffect(() => {
    gestaoClientes
      .socialResumo()
      .then((l) => setNome(l.find((c) => c.id === id)?.nome_empresa ?? ''))
      .catch(() => undefined)
  }, [id])

  return (
    <>
      <TopBar
        compacto
        title={nome || 'Social media'}
        subtitle="Social media"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Social media', to: '/clientesnxdigital/socialmedia' },
          { label: nome || 'Cliente' },
        ]}
      />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <button
          type="button"
          onClick={() => navegar('/clientesnxdigital/socialmedia')}
          className="flex items-center gap-1.5 text-sm text-foreground/55 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a lista
        </button>
        <SocialDoCliente clienteId={id} />
      </div>
    </>
  )
}
