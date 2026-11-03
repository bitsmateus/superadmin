import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DemoPlayer, type PlayerEvent } from '@/components/demoStudio/player/DemoPlayer'
import { URL_COLETA, demoPublicada, demoStudio } from '@/services/demoStudio'
import { criarColetor, type Coletor } from '@/lib/demoStudio/coletor'
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

  // Analytics: uma sessão por visita (§8.1). Os eventos do player vão direto para a fila do coletor.
  // Os efeitos do player (filho) rodam antes dos desta página: o step_view da 1ª etapa chega antes do
  // coletor existir. Fica guardado aqui e é repassado assim que ele nasce.
  const coletor = React.useRef<Coletor | null>(null)
  const antesDoColetor = React.useRef<PlayerEvent[]>([])
  React.useEffect(() => {
    if (!demo) return
    const c = criarColetor({ endpoint: URL_COLETA, demoId: demo.id, versionId: demo.versionId })
    coletor.current = c
    antesDoColetor.current.splice(0).forEach((e) => c.registrar(e))
    return () => {
      c.encerrar()
      coletor.current = null
    }
  }, [demo])
  const aoEvento = React.useCallback((e: PlayerEvent) => {
    if (coletor.current) coletor.current.registrar(e)
    else antesDoColetor.current.push(e)
  }, [])

  if (demo === undefined) return <Aviso texto="Carregando o tour…" />
  if (demo === null) return <Aviso texto="Esta demo não está disponível. Confira o link com quem te enviou." />
  return <DemoPlayer demo={demo} vars={vars} embed={embed} onEvent={aoEvento} />
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
