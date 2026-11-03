import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DemoPlayer } from '@/components/demoStudio/player/DemoPlayer'
import { demoPublicada, demoStudio } from '@/services/demoStudio'
import type { PlayerDemo } from '@/lib/demoStudio/types'

/** Fonte do player (a mesma da Fase 1). Carregada só nas páginas do player, uma vez. */
function useFonteDoPlayer() {
  React.useEffect(() => {
    const id = 'dsp-fonte'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(link)
  }, [])
}

function Aviso({ texto }: { texto: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif', color: '#5b6b82', background: '#eef2f8', textAlign: 'center' }}>
      <p>{texto}</p>
    </div>
  )
}

/** Variáveis pela querystring: ?empresa=…&nome=…&vendedor=… (os links personalizados chegam no M3). */
function useVariaveisDaUrl() {
  const [qs] = useSearchParams()
  return React.useMemo(
    () => ({ empresa: qs.get('empresa') ?? '', nome: qs.get('nome') ?? '', vendedor: qs.get('vendedor') ?? '' }),
    [qs],
  )
}

/** Link público: /d/:slug (padrão) e /e/:slug (incorporação em iframe, sem cabeçalho). */
export function DemoPublicPage({ embed = false }: { embed?: boolean }) {
  useFonteDoPlayer()
  const { slug = '' } = useParams()
  const vars = useVariaveisDaUrl()
  const [demo, setDemo] = React.useState<PlayerDemo | null | undefined>(undefined)

  React.useEffect(() => {
    demoPublicada(slug).then(setDemo).catch(() => setDemo(null))
  }, [slug])

  React.useEffect(() => {
    if (demo) document.title = demo.name
  }, [demo])

  if (demo === undefined) return <Aviso texto="Carregando o tour…" />
  if (demo === null) return <Aviso texto="Esta demo não está disponível. Confira o link com quem te enviou." />
  return <DemoPlayer demo={demo} vars={vars} embed={embed} />
}

/** Rascunho no player, para o iframe da pré-visualização do editor (precisa de login). */
export function DemoPreviewFramePage() {
  useFonteDoPlayer()
  const { id = '' } = useParams()
  const vars = useVariaveisDaUrl()
  const [demo, setDemo] = React.useState<PlayerDemo | null | undefined>(undefined)
  const [erro, setErro] = React.useState('')

  React.useEffect(() => {
    demoStudio.rascunho(id).then(setDemo).catch((e: Error) => { setErro(e.message); setDemo(null) })
  }, [id])

  if (demo === undefined) return <Aviso texto="Carregando o rascunho…" />
  if (demo === null) return <Aviso texto={erro || 'Demo não encontrada.'} />
  return <DemoPlayer demo={demo} vars={vars} />
}
