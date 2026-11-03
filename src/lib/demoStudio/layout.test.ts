// Roda pelo `npm test` do servidor (node --test + tsx). Regras puras do player, sem DOM.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularVisao, paraTela, posicionarBalao } from './layout'

const frame = { width: 1536, height: 695 }
const hotspot = { x: 280, y: 312, w: 400, h: 190 } // 1ª etapa do tour NX Systems

test('desktop: tela inteira, palco acompanha a proporção do frame', () => {
  const v = calcularVisao({ vw: 1280, alturaJanela: 900, larguraJanela: 1440, frame, hotspot, telaInteira: false })
  assert.equal(v.z, 1280 / 1536)
  assert.equal(v.ox, 0)
  assert.equal(v.oy, 0)
  assert.equal(v.vh, Math.round(695 * (1280 / 1536)))
})

test('celular: mesmo resultado da fórmula da Fase 1 (390×844)', () => {
  const vw = 358 // 390 - 2×16 de margem
  const v = calcularVisao({ vw, alturaJanela: 844, larguraJanela: 390, frame, hotspot, telaInteira: false })
  // palco = clamp(280, 95vw, 52vh)
  const vh = Math.round(Math.min(Math.max(vw * 0.95, 280), 844 * 0.52))
  assert.equal(v.vh, vh)
  const z = Math.max(Math.min(vw / (400 + 56), vh / (190 + 56), 0.95), vw / 1536)
  assert.equal(v.z, z)
  // hotspot centralizado (não encostou em borda neste caso)
  assert.ok(Math.abs(v.ox + vw / z / 2 - (280 + 200)) < 1e-9)
  assert.ok(Math.abs(v.oy + vh / z / 2 - (312 + 95)) < 1e-9)
})

test('celular: deslocamento preso às bordas do frame', () => {
  const canto = { x: 1500, y: 680, w: 30, h: 10 }
  const v = calcularVisao({ vw: 358, alturaJanela: 844, larguraJanela: 390, frame, hotspot: canto, telaInteira: false })
  assert.ok(v.z <= 0.95)
  assert.ok(Math.abs(v.ox - (1536 - 358 / v.z)) < 1e-9)
  assert.ok(Math.abs(v.oy - (695 - v.vh / v.z)) < 1e-9)
})

test('celular: "Tela inteira" e etapa sem hotspot mostram o frame todo, centralizado na vertical', () => {
  const v = calcularVisao({ vw: 358, alturaJanela: 844, larguraJanela: 390, frame, hotspot, telaInteira: true })
  assert.equal(v.z, 358 / 1536)
  assert.equal(v.ox, 0)
  assert.ok(v.oy < 0) // sobra espaço em cima e embaixo
  const semHotspot = calcularVisao({ vw: 358, alturaJanela: 844, larguraJanela: 390, frame, hotspot: null, telaInteira: false })
  assert.deepEqual(semHotspot, v)
})

test('paraTela aplica a folga de 6px e a escala', () => {
  const r = paraTela({ x: 100, y: 50, w: 10, h: 20 }, { z: 2, ox: 10, oy: 5 })
  assert.deepEqual(r, { L: (94 - 10) * 2, T: (44 - 5) * 2, W: 22 * 2, H: 32 * 2 })
})

test('balão: direita quando cabe, senão esquerda, abaixo, acima', () => {
  const base = { vw: 1200, vh: 600, tw: 330, th: 150 }
  assert.equal(posicionarBalao({ ...base, r: { L: 100, T: 100, W: 100, H: 50 } }).lado, 'right')
  assert.equal(posicionarBalao({ ...base, r: { L: 800, T: 100, W: 350, H: 50 } }).lado, 'left')
  assert.equal(posicionarBalao({ ...base, r: { L: 0, T: 50, W: 1200, H: 60 } }).lado, 'bottom')
  assert.equal(posicionarBalao({ ...base, r: { L: 0, T: 400, W: 1200, H: 180 } }).lado, 'top')
})

test('balão: lado preferido da etapa vale quando cabe; posição presa ao palco', () => {
  const base = { vw: 1200, vh: 600, tw: 330, th: 150, r: { L: 500, T: 200, W: 100, H: 50 } }
  assert.equal(posicionarBalao({ ...base, preferido: 'left' }).lado, 'left')
  assert.equal(posicionarBalao({ ...base, preferido: 'auto' }).lado, 'right')
  const preso = posicionarBalao({ ...base, r: { L: 0, T: 0, W: 1200, H: 10 } })
  assert.ok(preso.x >= 8 && preso.y >= 8)
})
