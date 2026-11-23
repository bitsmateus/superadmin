import test from 'node:test'
import assert from 'node:assert/strict'
import { ehMarcoDoCliente, marcosDoCliente } from './linhaDoTempoDoCliente'

const log = (action: string, createdAt: string, detail?: string) => ({ id: action + createdAt, action, detail, createdAt })

test('entram os marcos: briefing gerado/enviado/preenchido, etapas, reunião, entrega, contrato', () => {
  for (const a of [
    'Briefing enviado', 'Briefing de site enviado', 'Briefing enviado no WhatsApp', 'Briefing preenchido pelo cliente', 'Briefing aprovado',
    'Novo briefing', 'Revisão de briefing solicitada', 'Reunião de briefing agendada', 'Etapa alterada', 'Etapa revertida', 'Etapa: Entrega',
    'Etapa: Pronto para Entrega', 'Entrega concluída', 'Contrato assinado', 'Follow-up dia 3 enviado', 'Acessos enviados', 'Pendências enviadas pelo cliente',
    'Tenant vinculado manualmente', 'Configuração pausada',
  ]) assert.equal(ehMarcoDoCliente({ action: a }), true, a)
})

test('ficam de fora: edição de campo, as próprias notas, checklist e outros ruídos', () => {
  for (const a of [
    'Nome atualizado', 'E-mail atualizado', 'Telefone atualizado', 'Empresa atualizada', 'Responsável de entrega atualizado', 'Servidor do tenant atualizado',
    'Tenant ID atualizado', 'API Token do tenant atualizado', 'Nota interna registrada', 'Nota interna editada', 'Nota interna excluída', 'Nota registrada',
    'Checklist atualizado', 'Handoff atualizado', 'Briefing editado manualmente', 'Mensagem do follow-up dia 3 editada', 'Reunião de treinamento atualizada', '',
  ]) assert.equal(ehMarcoDoCliente({ action: a }), false, a)
})

test('marcosDoCliente: filtra e ordena do mais novo pro mais antigo', () => {
  const r = marcosDoCliente([
    log('Briefing enviado', '2026-11-20T10:00:00Z'),
    log('Nome atualizado', '2026-11-21T10:00:00Z'),
    log('Entrega concluída', '2026-11-23T10:00:00Z'),
    log('Etapa alterada', '2026-11-22T10:00:00Z', 'Briefing → Iniciar Configuração'),
  ])
  assert.deepEqual(r.map((x) => x.action), ['Entrega concluída', 'Etapa alterada', 'Briefing enviado'])
  assert.deepEqual(marcosDoCliente(undefined), [])
})
