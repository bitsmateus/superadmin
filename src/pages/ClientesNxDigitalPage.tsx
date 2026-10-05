import { useLocation } from 'react-router-dom'
import { TopBar } from '@/components/layout/TopBar'

/**
 * CLIENTES NX DIGITAL — aba nova, ainda em branco. Serve pra reservar o endereço e o lugar no
 * menu; o conteúdo entra depois. A sub-aba "Clientes" (/clientesnxdigital/clientes) usa a mesma
 * tela, só mudando o título.
 */
export function ClientesNxDigitalPage() {
  const { pathname } = useLocation()
  const ehSubAbaClientes = pathname.startsWith('/clientesnxdigital/clientes')

  return (
    <>
      <TopBar
        title={ehSubAbaClientes ? 'Clientes' : 'CLIENTES NX DIGITAL'}
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital' },
          ...(ehSubAbaClientes ? [{ label: 'Clientes' }] : []),
        ]}
      />
      <div className="px-4 pb-10 lg:px-6" />
    </>
  )
}
