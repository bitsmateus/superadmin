/**
 * Geometria do player, portada 1:1 de docs/demo-studio/reference/player/player-v1.html (Fase 1, validado
 * no celular). Não mexa nas constantes sem testar no celular de verdade: o zoom no hotspot depende delas.
 * Tudo em px CSS do frame; `view` é o recorte visível do frame: escala `z` e deslocamento `ox/oy`.
 */
export const LIMITE_CELULAR = 760
const FOLGA_ZOOM = 28
const FOLGA_DESTAQUE = 6
const DISTANCIA_BALAO = 16

export interface Caixa {
  x: number
  y: number
  w: number
  h: number
}
export interface Visao {
  z: number
  ox: number
  oy: number
}

export function ehCelular(larguraJanela: number): boolean {
  return larguraJanela <= LIMITE_CELULAR
}

/** Altura do palco no celular: clamp(280px, 95vw, 52vh). */
export function alturaPalcoCelular(vw: number, alturaJanela: number): number {
  return Math.round(Math.min(Math.max(vw * 0.95, 280), alturaJanela * 0.52))
}

/**
 * Quanto do frame aparece. Desktop: a tela inteira (`z = vw/largura`) e o palco acompanha a altura.
 * Celular: zoom centralizado no hotspot, nunca menor que caber a largura toda, preso às bordas do frame.
 * Devolve também a altura do palco (vh) que o player deve aplicar.
 */
export function calcularVisao(params: {
  vw: number
  alturaJanela: number
  larguraJanela: number
  frame: { width: number; height: number }
  hotspot: Caixa | null
  telaInteira: boolean
}): Visao & { vh: number } {
  const { vw, alturaJanela, larguraJanela, frame, hotspot, telaInteira } = params
  const W = frame.width
  const H = frame.height
  if (!ehCelular(larguraJanela)) {
    const z = vw / W
    return { z, ox: 0, oy: 0, vh: Math.round(H * z) }
  }
  const vh = alturaPalcoCelular(vw, alturaJanela)
  const zMin = vw / W
  if (!hotspot || telaInteira) return { z: zMin, ox: 0, oy: -(vh / zMin - H) / 2, vh }
  const { x, y, w, h } = hotspot
  let z = Math.min(vw / (w + FOLGA_ZOOM * 2), vh / (h + FOLGA_ZOOM * 2), 0.95)
  z = Math.max(z, zMin)
  const cw = vw / z
  const ch = vh / z
  const cx = x + w / 2
  const cy = y + h / 2
  let ox = cx - cw / 2
  let oy = cy - ch / 2
  ox = Math.max(0, Math.min(ox, W - cw))
  oy = ch >= H ? -(ch - H) / 2 : Math.max(0, Math.min(oy, H - ch))
  return { z, ox, oy, vh }
}

/** Retângulo do destaque na tela (px do palco), com a folga de 6px em volta do hotspot. */
export function paraTela(b: Caixa, v: Visao): { L: number; T: number; W: number; H: number } {
  const p = FOLGA_DESTAQUE
  return { L: (b.x - p - v.ox) * v.z, T: (b.y - p - v.oy) * v.z, W: (b.w + p * 2) * v.z, H: (b.h + p * 2) * v.z }
}

export type Lado = 'right' | 'left' | 'bottom' | 'top'

/**
 * Onde o balão flutua no desktop: direita → esquerda → abaixo → acima, o primeiro que couber, preso ao
 * palco com 8px de margem. `preferido` (placement da etapa) é tentado antes quando não é 'auto'.
 * Devolve a posição (px do palco) e a da setinha (relativa ao balão).
 */
export function posicionarBalao(params: {
  r: { L: number; T: number; W: number; H: number }
  vw: number
  vh: number
  tw: number
  th: number
  preferido?: string
}): { lado: Lado; x: number; y: number; seta: { left?: number; top?: number } } {
  const { r, vw, vh, tw, th } = params
  const g = DISTANCIA_BALAO
  const opcoes: Record<Lado, { cabe: boolean; x: number; y: number }> = {
    right: { cabe: r.L + r.W + g + tw <= vw, x: r.L + r.W + g, y: r.T + r.H / 2 - th / 2 },
    left: { cabe: r.L - g - tw >= 0, x: r.L - g - tw, y: r.T + r.H / 2 - th / 2 },
    bottom: { cabe: r.T + r.H + g + th <= vh, x: r.L + r.W / 2 - tw / 2, y: r.T + r.H + g },
    top: { cabe: true, x: r.L + r.W / 2 - tw / 2, y: r.T - g - th },
  }
  const ordem: Lado[] = ['right', 'left', 'bottom', 'top']
  const pref = params.preferido as Lado | undefined
  if (pref && pref in opcoes && opcoes[pref].cabe) ordem.unshift(pref)
  const lado = ordem.find((l) => opcoes[l].cabe) ?? 'top'
  let { x, y } = opcoes[lado]
  x = Math.max(8, Math.min(x, vw - tw - 8))
  y = Math.max(8, Math.min(y, vh - th - 8))
  const cx = Math.max(14, Math.min(r.L + r.W / 2 - x, tw - 28))
  const cy = Math.max(14, Math.min(r.T + r.H / 2 - y, th - 28))
  const seta = lado === 'right' || lado === 'left' ? { top: cy } : { left: cx }
  return { lado, x, y, seta }
}
