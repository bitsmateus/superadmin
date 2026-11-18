import test from 'node:test'
import assert from 'node:assert/strict'
import { BRIEFING_MODELO } from './gcBriefingModelo'
import { MODELOS_DO_BRIEFING, TODAS_AS_CHAVES, etapasDoBriefing, itemPedido, normalizarItens, resumoDosItens } from './gcBriefingItens'

test('sem seleção (null) o briefing é o completo, como sempre foi', () => {
  assert.equal(itemPedido(null, 'site'), true)
  assert.equal(itemPedido(undefined, 'p:3'), true)
  const e = etapasDoBriefing(null)
  assert.deepEqual(e.slice(0, 3).map((x) => x.tipo), ['empresa', 'acessos', 'contas'])
  assert.equal(e.filter((x) => x.tipo === 'perguntas').length, 7)
  assert.deepEqual(e.slice(-2).map((x) => x.tipo), ['materiais', 'revisao'])
})

test('briefing curto da Consensus: só site, whatsapp, instagram e facebook → uma etapa de empresa, uma de acessos e a revisão', () => {
  const curto = MODELOS_DO_BRIEFING.find((m) => m.id === 'acessos')!.itens
  assert.deepEqual(etapasDoBriefing(curto).map((x) => x.tipo), ['empresa', 'acessos', 'revisao'])
  assert.equal(itemPedido(curto, 'instagram'), true)
  assert.equal(itemPedido(curto, 'crm'), false)
  assert.equal(itemPedido(curto, 'p:0'), false)
})

test('modelo de tráfego pago: sem materiais, com as perguntas de tráfego, CRM e verba', () => {
  const itens = MODELOS_DO_BRIEFING.find((m) => m.id === 'trafego')!.itens!
  const perguntas = itens.filter((c) => c.startsWith('p:')).map((c) => BRIEFING_MODELO[Number(c.slice(2))].pergunta)
  assert.ok(perguntas.some((p) => p.startsWith('Já fez tráfego pago')))
  assert.ok(perguntas.some((p) => p.startsWith('Qual verba de mídia')))
  assert.ok(perguntas.some((p) => p.startsWith('Os contatos e vendas são anotados')))
  assert.equal(itemPedido(itens, 'materiais'), false)
  assert.equal(itemPedido(itens, 'google_ads'), true)
})

test('etapa de perguntas só existe pro bloco que tem alguma pergunta pedida', () => {
  const e = etapasDoBriefing(['p:0', 'p:1'])
  assert.deepEqual(e.map((x) => x.tipo), ['perguntas', 'revisao'])
})

test('normalizarItens: só chaves conhecidas; vazio ou tudo volta pro completo', () => {
  assert.equal(normalizarItens(null), null)
  assert.equal(normalizarItens([]), null)
  assert.equal(normalizarItens(['xyz']), null)
  assert.equal(normalizarItens(TODAS_AS_CHAVES), null)
  assert.deepEqual(normalizarItens(['site', 'site', 'inventado', 'instagram']), ['site', 'instagram'])
})

test('resumo', () => {
  assert.equal(resumoDosItens(null), 'Briefing completo')
  assert.equal(resumoDosItens(['site', 'instagram', 'p:1']), 'Personalizado: 2 campos e 1 pergunta')
})

test('resposta obrigatória: vazio e "Não sei"/"Não sabe" não valem', async () => {
  const { respostaValida } = await import('./gcBriefingItens')
  for (const r of ['', '   ', undefined, null, 'Não sei', 'não sei.', 'NAO SEI', 'Não sabe', 'nao sabe']) assert.equal(respostaValida(r), false, String(r))
  for (const r of ['R$ 30 mil', '0', 'Não sei bem, uns 20', 'Sim']) assert.equal(respostaValida(r), true, r)
})
