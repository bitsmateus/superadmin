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
