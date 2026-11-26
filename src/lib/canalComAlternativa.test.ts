import test from 'node:test'
import assert from 'node:assert/strict'
import { criarCanalComAlternativa, servidorNaoTemEsseTipo, type TipoDeCanal } from './canalComAlternativa'

const msg = (e: unknown) => (e as Error).message
const criador = (falhas: Partial<Record<TipoDeCanal, string>>, tentativas: TipoDeCanal[]) => async (tipo: TipoDeCanal) => {
  tentativas.push(tipo)
  if (falhas[tipo]) throw new Error(falhas[tipo])
  return { id: tipo }
}

test('deu certo de primeira: usa o tipo preferido e não tenta o outro', async () => {
  const t: TipoDeCanal[] = []
  const r = await criarCanalComAlternativa(criador({}, t), 'uazapi', msg)
  assert.equal(r.tipo, 'uazapi')
  assert.deepEqual(t, ['uazapi'])
})

test('servidor Web sem UAZAPI (ERR_UAZAPI_HOST_NOT_FOUND): cria como evo', async () => {
  const t: TipoDeCanal[] = []
  const r = await criarCanalComAlternativa(criador({ uazapi: 'ERR_UAZAPI_HOST_NOT_FOUND' }, t), 'uazapi', msg)
  assert.equal(r.tipo, 'evo')
  assert.deepEqual(t, ['uazapi', 'evo'])
})

test('servidor sem a biblioteca evo: cria como uazapi', async () => {
  const r = await criarCanalComAlternativa(criador({ evo: 'ERR_CHANNEL_LIB_NOT_CONFIGURED' }, []), 'evo', msg)
  assert.equal(r.tipo, 'uazapi')
})

test('os dois recusados: erro explica os dois e manda configurar o servidor', async () => {
  await assert.rejects(
    () => criarCanalComAlternativa(criador({ uazapi: 'ERR_UAZAPI_HOST_NOT_FOUND', evo: 'ERR_CHANNEL_LIB_NOT_CONFIGURED' }, []), 'uazapi', msg),
    /como uazapi deu ERR_UAZAPI_HOST_NOT_FOUND; como evo deu ERR_CHANNEL_LIB_NOT_CONFIGURED/,
  )
})

test('outro erro qualquer NÃO tenta o outro tipo (pra não criar canal duplicado ou errado)', async () => {
  const t: TipoDeCanal[] = []
  await assert.rejects(() => criarCanalComAlternativa(criador({ uazapi: 'ERR_NO_PERMISSION' }, t), 'uazapi', msg), /ERR_NO_PERMISSION/)
  assert.deepEqual(t, ['uazapi'])
  assert.equal(servidorNaoTemEsseTipo('timeout'), false)
})
