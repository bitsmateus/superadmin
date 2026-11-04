import * as React from 'react'
import { Rnd } from 'react-rnd'
import { EyeOff, MousePointerClick, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Caixa } from '@/lib/demoStudio/layout'
import type { Mascara } from '@/lib/demoStudio/types'
import { urlDoArquivo, type Etapa, type Frame } from '@/services/demoStudio'

type Ferramenta = 'destaque' | 'blur' | 'cover'

/**
 * Canvas do editor: o frame inteiro, escalado pra caber na largura, e o destaque por cima.
 * Coordenadas SEMPRE em px CSS do frame — a escala da tela do editor só existe aqui dentro (`z`).
 * Ferramenta "Destaque": arrastar no vazio desenha o destaque da etapa; o existente move e redimensiona.
 * Ferramentas de máscara (§4.2): arrastar desenha um retângulo de desfoque ou de cobertura sobre a TELA
 * (vale para todas as etapas que usam esta tela). Na pré-visualização a máscara vai por cima; ao publicar,
 * ela é gravada na imagem.
 */
export function CanvasEtapa({ etapa, frame, onHotspot, onMascaras, somenteLeitura }: {
  etapa: Etapa
  frame: Frame
  onHotspot: (h: Caixa) => void
  onMascaras: (m: Mascara[]) => void
  somenteLeitura?: boolean
}) {
  const caixaRef = React.useRef<HTMLDivElement>(null)
  const [largura, setLargura] = React.useState(0)
  const [desenho, setDesenho] = React.useState<{ x0: number; y0: number; x: number; y: number } | null>(null)
  const [ferramenta, setFerramenta] = React.useState<Ferramenta>('destaque')

  React.useEffect(() => {
    const el = caixaRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const z = largura ? largura / frame.width : 0
  const ehHotspot = etapa.kind === 'HOTSPOT'
  const h = etapa.hotspot
  const mascaras = frame.masks ?? []
  const desenhaMascara = ferramenta !== 'destaque'
  const podeDesenhar = !somenteLeitura && (desenhaMascara || ehHotspot)

  const pontoNoFrame = (e: React.PointerEvent) => {
    const r = caixaRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(frame.width, (e.clientX - r.left) / z)),
      y: Math.max(0, Math.min(frame.height, (e.clientY - r.top) / z)),
    }
  }

  const iniciar = (e: React.PointerEvent) => {
    if (!podeDesenhar || !z || e.button !== 0) return
    if ((e.target as HTMLElement).closest('.ds-rnd, .ds-mascara-x')) return
    const p = pontoNoFrame(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDesenho({ x0: p.x, y0: p.y, x: p.x, y: p.y })
  }
  const mover = (e: React.PointerEvent) => {
    if (!desenho) return
    const p = pontoNoFrame(e)
    setDesenho((d) => (d ? { ...d, x: p.x, y: p.y } : d))
  }
  const terminar = () => {
    if (!desenho) return
    const caixa = {
      x: Math.round(Math.min(desenho.x0, desenho.x)),
      y: Math.round(Math.min(desenho.y0, desenho.y)),
      w: Math.round(Math.abs(desenho.x - desenho.x0)),
      h: Math.round(Math.abs(desenho.y - desenho.y0)),
    }
    setDesenho(null)
    if (caixa.w < 8 || caixa.h < 8) return
    if (ferramenta === 'destaque') return onHotspot(caixa)
    const text = ferramenta === 'cover' ? (window.prompt('Texto na cobertura (opcional):', 'Dado oculto') ?? '').trim().slice(0, 80) : undefined
    onMascaras([...mascaras, { ...caixa, type: ferramenta, ...(text ? { text } : {}) }])
  }

  const corDesenho = desenhaMascara ? '#475569' : '#2c6bc8'

  return (
    <div>
      {!somenteLeitura && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
          {([
            ['destaque', 'Destaque', MousePointerClick],
            ['blur', 'Máscara: desfoque', EyeOff],
            ['cover', 'Máscara: cobertura', Square],
          ] as [Ferramenta, string, typeof EyeOff][]).map(([f, rotulo, Icone]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFerramenta(f)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1',
                ferramenta === f ? 'border-accent/60 bg-accent/10 text-foreground' : 'border-line text-foreground/55 hover:text-foreground',
              )}
            >
              <Icone className="h-3.5 w-3.5" /> {rotulo}
            </button>
          ))}
          {mascaras.length > 0 && <span className="ml-1 text-foreground/45">{mascaras.length} máscara(s) nesta tela</span>}
        </div>
      )}
      <div
        ref={caixaRef}
        className="relative w-full select-none overflow-hidden rounded-lg border border-line bg-white"
        style={{ height: z ? frame.height * z : undefined, aspectRatio: z ? undefined : `${frame.width} / ${frame.height}`, cursor: podeDesenhar ? 'crosshair' : 'default', touchAction: 'none' }}
        onPointerDown={iniciar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={() => setDesenho(null)}
      >
        {z > 0 && (
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: frame.width, height: frame.height, transform: `scale(${z})` }}>
            <img src={urlDoArquivo(frame.image)} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
            {mascaras.map((m, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: m.x, top: m.y, width: m.w, height: m.h,
                  borderRadius: 4 / z,
                  ...(m.type === 'blur'
                    ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', background: 'rgba(226,232,240,.35)' }
                    : { background: '#e2e8f0', color: '#475569', display: 'grid', placeItems: 'center', font: `600 ${13}px system-ui` }),
                  outline: desenhaMascara ? `${1.5 / z}px dashed #475569` : undefined,
                }}
              >
                {m.type === 'cover' && m.text}
                {desenhaMascara && !somenteLeitura && (
                  <button
                    type="button"
                    aria-label="Remover máscara"
                    className="ds-mascara-x absolute grid place-items-center rounded-full bg-slate-800 text-white"
                    style={{ right: -8 / z, top: -8 / z, width: 18 / z, height: 18 / z }}
                    onClick={() => onMascaras(mascaras.filter((_, j) => j !== i))}
                  >
                    <X style={{ width: 11 / z, height: 11 / z }} />
                  </button>
                )}
              </div>
            ))}
            {ehHotspot && h && !desenho && (
              <Rnd
                className="ds-rnd"
                scale={z}
                bounds="parent"
                disableDragging={somenteLeitura || desenhaMascara}
                enableResizing={!somenteLeitura && !desenhaMascara}
                size={{ width: h.w, height: h.h }}
                position={{ x: h.x, y: h.y }}
                minWidth={8}
                minHeight={8}
                onDragStop={(_e, d) => onHotspot({ ...h, x: Math.round(d.x), y: Math.round(d.y) })}
                onResizeStop={(_e, _dir, ref, _delta, pos) =>
                  onHotspot({ x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(ref.offsetWidth), h: Math.round(ref.offsetHeight) })
                }
                resizeHandleStyles={Object.fromEntries(
                  ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'].map((k) => [k, { width: 14 / z, height: 14 / z, background: '#2c6bc8', borderRadius: 999, border: `${2 / z}px solid #fff` }]),
                )}
                style={{
                  border: `${2.5 / z}px solid #2c6bc8`, borderRadius: 12 / z,
                  boxShadow: desenhaMascara ? 'none' : '0 0 0 9999px rgba(9,20,38,.35)',
                  cursor: somenteLeitura || desenhaMascara ? 'default' : 'move',
                  pointerEvents: desenhaMascara ? 'none' : undefined,
                }}
              />
            )}
            {desenho && (
              <div
                className="absolute"
                style={{
                  left: Math.min(desenho.x0, desenho.x),
                  top: Math.min(desenho.y0, desenho.y),
                  width: Math.abs(desenho.x - desenho.x0),
                  height: Math.abs(desenho.y - desenho.y0),
                  border: `${2.5 / z}px dashed ${corDesenho}`,
                  background: desenhaMascara ? 'rgba(71,85,105,.18)' : 'rgba(44,107,200,.12)',
                }}
              />
            )}
          </div>
        )}
        {!ehHotspot && !desenhaMascara && z > 0 && (
          <div className="absolute inset-0 grid place-items-center bg-black/35 p-4">
            <div className="max-w-sm rounded-xl bg-white p-4 text-center text-sm text-slate-700 shadow-lg">
              <p className="font-semibold text-slate-900">{etapa.title || 'Cartão sem título'}</p>
              <p className="mt-1 text-xs text-slate-500">
                {etapa.kind === 'MODAL' ? 'Cartão centralizado (abertura ou explicação).' : etapa.kind === 'CTA' ? 'Chamada final (WhatsApp ou link).' : 'Formulário de lead.'} Edite no painel ao lado.
              </p>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-foreground/45">
        {frame.width}×{frame.height} px CSS · {frame.pixelRatio}x
        {!somenteLeitura && (desenhaMascara
          ? ' · Arraste sobre o dado que não pode aparecer. A máscara vale para esta tela em todas as etapas e é gravada na imagem ao publicar.'
          : ehHotspot && (h ? ' · Arraste o destaque para mover, use as alças para redimensionar ou desenhe outro no vazio.' : ' · Arraste sobre a tela para desenhar o destaque.'))}
      </p>
    </div>
  )
}
