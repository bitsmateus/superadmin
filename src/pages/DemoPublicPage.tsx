import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DemoPlayer, type PlayerEvent } from '@/components/demoStudio/player/DemoPlayer'
import { URL_COLETA, demoPublicada, demoStudio, enviarLeadPublico, linkPublico, type LinkPublico } from '@/services/demoStudio'
import { criarColetor, type Coletor } from '@/lib/demoStudio/coletor'
import type { PlayerDemo } from '@/lib/demoStudio/types'
import type { Variaveis } from '@/lib/demoStudio/variables'

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

/** Variáveis pela querystring: ?empresa=…&nome=…&vendedor=… */
function useVariaveisDaUrl() {
  const [qs] = useSearchParams()
  return React.useMemo(
    () => ({ empresa: qs.get('empresa') ?? '', nome: qs.get('nome') ?? '', vendedor: qs.get('vendedor') ?? '' }),
    [qs],
  )
}

/**
 * Player com analytics e envio de lead — o mesmo para o link padrão (/d), o nomeado/personalizado (/l)
 * e o iframe (/e).
 */
function PlayerPublico({ demo, vars, embed, linkCode, leadConhecido }: {
  demo: PlayerDemo
  vars: Variaveis
  embed?: boolean
  linkCode?: string
  leadConhecido?: boolean
}) {
  React.useEffect(() => {
    document.title = demo.name
  }, [demo])

  // Os efeitos do player (filho) rodam antes dos desta página: o step_view da 1ª etapa chega antes do
  // coletor existir. Fica guardado aqui e é repassado assim que ele nasce.
  const coletor = React.useRef<Coletor | null>(null)
  const antesDoColetor = React.useRef<PlayerEvent[]>([])
  React.useEffect(() => {
    const c = criarColetor({ endpoint: URL_COLETA, demoId: demo.id, versionId: demo.versionId, linkCode })
    coletor.current = c
    antesDoColetor.current.splice(0).forEach((e) => c.registrar(e))
    return () => {
      c.encerrar()
      coletor.current = null
    }
  }, [demo, linkCode])
  const aoEvento = React.useCallback((e: PlayerEvent) => {
    if (coletor.current) coletor.current.registrar(e)
    else antesDoColetor.current.push(e)
  }, [])

  const enviarLead = React.useCallback(
    async (campos: Record<string, string>, origem: 'form' | 'cta') => {
      const c = coletor.current
      if (!c) return
      await enviarLeadPublico({ demoId: demo.id, ...c.ids, linkCode, origem, consent: origem === 'form' ? true : undefined, fields: campos })
    },
    [demo.id, linkCode],
  )

  return (
    <DemoPlayer
      demo={demo}
      vars={vars}
      embed={embed}
      onEvent={aoEvento}
      enviarLead={enviarLead}
      leadConhecido={leadConhecido}
      consentimento={demo.consent}
    />
  )
}

/** Link padrão: /d/:slug e /e/:slug (incorporação em iframe, sem cabeçalho). */
export function DemoPublicPage({ embed = false }: { embed?: boolean }) {
  useFonteDoPlayer()
  const { slug = '' } = useParams()
  const vars = useVariaveisDaUrl()
  const [demo, setDemo] = React.useState<PlayerDemo | null | undefined>(undefined)

  React.useEffect(() => {
    demoPublicada(slug).then(setDemo).catch(() => setDemo(null))
  }, [slug])

  if (demo === undefined) return <Aviso texto="Carregando o tour…" />
  if (demo === null) return <Aviso texto="Esta demo não está disponível. Confira o link com quem te enviou." />
  return <PlayerPublico demo={demo} vars={vars} embed={embed} />
}

/**
 * Link nomeado ou personalizado: /l/:code (§4.4). As variáveis do link (nome, empresa, vendedor) valem por
 * cima da querystring; link personalizado já conhece o lead, então o gate do formulário é pulado (§7.2).
 */
export function DemoLinkPage() {
  useFonteDoPlayer()
  const { code = '' } = useParams()
  const daUrl = useVariaveisDaUrl()
  const [link, setLink] = React.useState<LinkPublico | null | undefined>(undefined)

  React.useEffect(() => {
    linkPublico(code).then(setLink).catch(() => setLink(null))
  }, [code])

  const vars = React.useMemo(() => {
    const v: Variaveis = { ...daUrl }
    if (link) Object.entries(link.variables).forEach(([k, val]) => { if (val) v[k] = val })
    return v
  }, [daUrl, link])

  if (link === undefined) return <Aviso texto="Carregando o tour…" />
  if (link === null) return <Aviso texto="Este link não está mais disponível. Peça um novo para quem te enviou." />
  return <PlayerPublico demo={link.demo} vars={vars} linkCode={link.linkCode} leadConhecido={link.leadKnown} />
}

/** Rascunho no player, para o iframe da pré-visualização do editor (precisa de login, não registra nada). */
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
