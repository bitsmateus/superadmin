import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogoDePaginas, escolhidas, paginaDoEndereco, registrarRecente } from './paginasDaInicio'

const abas = [
  { id: 'novos_leads', name: 'Novos Leads', section: 'comercial' as const },
  { id: 'crm-arthur', name: 'CRM LUIS ATUALIZADO', section: 'comercial' as const },
  { id: 'crm-ia-luiza', name: 'CRM IA LUIZA', section: 'comercial' as const },
  { id: 'vendas', name: 'Vendas', section: 'comercial' as const },
  { id: 'pipe-x', name: 'Pipe Cliente X', section: 'demandas' as const },
  { id: 'crm-jean', name: 'CRM JEAN', section: 'demandas' as const, noPipeline: true },
]
const base = {
  abas,
  abasFinanceiras: new Set(['vendas']),
  copiasDoSuporte: [{ id: 'pipeline', name: 'Pipeline', sourceKey: 'pipeline' }, { id: 'pipeline-2', name: 'Pipeline do João', sourceKey: 'pipeline' }],
  abaDeFora: (id: string) => (id === 'crm-ia-luiza' ? 'crm-arthur' : undefined),
}

test('catálogo: só o que a pessoa pode abrir; abas, cópias e aba de dentro de outra', () => {
  const tudo = catalogoDePaginas({ ...base, podeAbrir: () => true })
  const caminhos = tudo.map((p) => p.to)
  assert.ok(caminhos.includes('/comercial/crm-arthur'))
  assert.ok(caminhos.includes('/demandas/pipe-x'))
  assert.ok(caminhos.includes('/pipeline/crm/crm-jean'))
  assert.ok(caminhos.includes('/visao/pipeline-2'))
  assert.ok(!caminhos.includes('/visao/pipeline'), 'o original não vira cópia')
  assert.ok(!caminhos.includes('/comercial/vendas'), 'aba financeira fica de fora')
  assert.ok(!caminhos.includes('/comercial/crm-ia-luiza'), 'aba que mora dentro de outra entra pela de fora')
  const restrito = catalogoDePaginas({ ...base, podeAbrir: (to) => to === '/clients' || to.startsWith('/comercial/') })
  assert.deepEqual(restrito.map((p) => p.to), ['/clients', '/comercial/novos_leads', '/comercial/crm-arthur'])
})

test('página do endereço: a própria ou a mãe; a raiz não conta', () => {
  const cat = catalogoDePaginas({ ...base, podeAbrir: () => true })
  assert.equal(paginaDoEndereco(cat, '/clients/123')?.to, '/clients')
  assert.equal(paginaDoEndereco(cat, '/tickets/9')?.to, '/tickets')
  assert.equal(paginaDoEndereco(cat, '/gestao/vendas')?.to, '/gestao/vendas')
  assert.equal(paginaDoEndereco(cat, '/clientesnxdigital/clientes/abc')?.to, '/clientesnxdigital/clientes')
  assert.equal(paginaDoEndereco(cat, '/'), null)
  assert.equal(paginaDoEndereco(cat, '/nao-existe'), null)
})

test('recentes: mais recente primeiro, sem repetir, no máximo 5', () => {
  let r: string[] = []
  for (const p of ['/a', '/b', '/c', '/a', '/d', '/e', '/f']) r = registrarRecente(r, p)
  assert.deepEqual(r, ['/f', '/e', '/d', '/a', '/c'])
})

test('escolhidas: salvas valem (sem o que perdeu acesso); sem escolha, padrão da área completado', () => {
  const cat = catalogoDePaginas({ ...base, podeAbrir: (to) => to !== '/tarefas' })
  assert.deepEqual(escolhidas(cat, ['/agenda', '/tarefas', '/clients'], 'atalhos', 'entrega').map((p) => p.to), ['/agenda', '/clients'])
  assert.deepEqual(escolhidas(cat, [], 'atalhos', 'entrega'), [])
  assert.deepEqual(escolhidas(cat, null, 'atalhos', 'entrega').map((p) => p.to), ['/pipeline', '/clients', '/dashboard-suporte'])
  assert.deepEqual(escolhidas(cat, null, 'atalhos', 'comercial').map((p) => p.to), ['/comercial/crm-arthur', '/agenda', '/comercial-dashboard'])
  const rapido = escolhidas(cat, null, 'acessoRapido', 'ambos').map((p) => p.to)
  assert.equal(rapido.length, 8)
  assert.deepEqual(rapido.slice(0, 3), ['/dashboard-suporte', '/clients', '/comercial/novos_leads'])
  const soComercial = catalogoDePaginas({ ...base, podeAbrir: (to) => to.startsWith('/comercial/') })
  assert.deepEqual(escolhidas(soComercial, null, 'atalhos', 'entrega').map((p) => p.to), ['/comercial/novos_leads', '/comercial/crm-arthur'])
})
