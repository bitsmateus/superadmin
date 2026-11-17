import * as React from 'react'
import { documentoDaPagina, montarPaginas, type DadosTabloide } from '../../../server/src/lib/tabloide/layout'

/**
 * Prévia ao vivo do tabloide: o MESMO HTML que o servidor fotografa pro PNG/PDF/vídeo, dentro de um
 * iframe encolhido. Atualiza com um pequeno atraso pra não recarregar o iframe a cada tecla.
 */

export const LOGO_TABLOIDE = '/assets/mercadonunes-logo.jpg'

/** Miniatura da primeira página (cartões de Templates). */
export function MiniaturaTabloide({ dados, largura }: { dados: DadosTabloide; largura: number }) {
  const pagina = React.useMemo(() => montarPaginas(dados, `${window.location.origin}${LOGO_TABLOIDE}`)[0], [dados])
  const escala = largura / pagina.w
  return (
    <div className="overflow-hidden rounded-md shadow" style={{ width: pagina.w * escala, height: pagina.h * escala }}>
      <iframe
        title="Miniatura"
        srcDoc={documentoDaPagina(dados, pagina)}
        sandbox="allow-same-origin"
        loading="lazy"
        style={{ width: pagina.w, height: pagina.h, border: 0, transform: `scale(${escala})`, transformOrigin: '0 0', pointerEvents: 'none' }}
      />
    </div>
  )
}

export function PreviaTabloide({ dados, largura }: { dados: DadosTabloide; largura: number }) {
  const [atual, setAtual] = React.useState(dados)
  React.useEffect(() => {
    const t = setTimeout(() => setAtual(dados), 250)
    return () => clearTimeout(t)
  }, [dados])

  const paginas = React.useMemo(
    () => montarPaginas(atual, `${window.location.origin}${LOGO_TABLOIDE}`),
    [atual],
  )
  const escala = largura / paginas[0].w

  return (
    <div className="flex flex-col gap-3">
      {paginas.map((p, i) => (
        <div key={i}>
          {paginas.length > 1 && (
            <div className="mb-1 text-xs font-semibold text-[#7A716A]">
              Página {i + 1} de {paginas.length}
            </div>
          )}
          <div
            className="overflow-hidden rounded-lg shadow-md"
            style={{ width: p.w * escala, height: p.h * escala, background: '#ddd' }}
          >
            <iframe
              title={`Página ${i + 1}`}
              srcDoc={documentoDaPagina(atual, p)}
              // Sem scripts (o HTML é só layout); allow-same-origin deixa carregar a logo e as fotos.
              sandbox="allow-same-origin"
              style={{ width: p.w, height: p.h, border: 0, transform: `scale(${escala})`, transformOrigin: '0 0', pointerEvents: 'none' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Como o post vai sair: cada imagem na ordem (capa manual primeiro), já no formato escolhido — é o mesmo HTML
 * que o servidor fotografa. `paginas` (só com um tabloide) limita às páginas marcadas.
 */
export function PreviaDoPost({
  tabloides,
  formato,
  capa,
  paginas,
  largura = 96,
}: {
  tabloides: DadosTabloide[]
  formato: 'feed' | 'story'
  capa?: string | null
  paginas?: number[]
  largura?: number
}) {
  const imagens = React.useMemo(() => {
    const logo = `${window.location.origin}${LOGO_TABLOIDE}`
    const out: { dados: DadosTabloide; pagina: ReturnType<typeof montarPaginas>[number] }[] = []
    for (const t of tabloides) {
      const d = { ...t, formato }
      montarPaginas(d, logo).forEach((pagina, i) => {
        if (tabloides.length === 1 && paginas && !paginas.includes(i)) return
        out.push({ dados: d, pagina })
      })
    }
    return out
  }, [tabloides, formato, paginas])
  const ref = formato === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }
  const escala = largura / ref.w
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7A716A]">
        Como vai sair · {formato === 'story' ? 'Story (1080×1920)' : 'Feed (1080×1350)'} · {imagens.length + (capa ? 1 : 0)} imagem{imagens.length + (capa ? 1 : 0) !== 1 ? 'ns' : ''}
      </div>
      <div className="flex gap-2 overflow-x-auto rounded-lg bg-[#EDE8E1] p-2">
        {capa && (
          <div className="shrink-0">
            <img src={capa} alt="Capa" className="rounded-md object-cover shadow" style={{ width: largura, height: ref.h * escala }} />
            <div className="mt-0.5 text-center text-[10px] font-bold text-[#7A716A]">1 · capa</div>
          </div>
        )}
        {imagens.map(({ dados, pagina }, i) => (
          <div key={i} className="shrink-0">
            <div className="overflow-hidden rounded-md shadow" style={{ width: pagina.w * (largura / pagina.w), height: pagina.h * (largura / pagina.w), background: '#ddd' }}>
              <iframe
                title={`Imagem ${i + 1}`}
                srcDoc={documentoDaPagina(dados, pagina)}
                sandbox="allow-same-origin"
                loading="lazy"
                style={{ width: pagina.w, height: pagina.h, border: 0, transform: `scale(${largura / pagina.w})`, transformOrigin: '0 0', pointerEvents: 'none' }}
              />
            </div>
            <div className="mt-0.5 text-center text-[10px] font-bold text-[#7A716A]">{i + 1 + (capa ? 1 : 0)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
