import test from 'node:test'
import assert from 'node:assert/strict'
import { ehTipoSocialSelling, limiteDeDiasDoTipo } from './diasDeContato'

test('os 3 tipos de Social Selling (frio, novos, curtiu) limitam o dia de contato a 3', () => {
  for (const t of ['LEAD SOCIAL SELLING - FRIO', 'LEAD SOCIAL SELLING - NOVOS', 'LEAD SOCIAL SELLING - CURTIU', 'lead social selling – frio', 'Lead Social Selling Novo']) {
    assert.equal(ehTipoSocialSelling(t), true, t)
    assert.equal(limiteDeDiasDoTipo(t), 3, t)
  }
})

test('qualquer outro tipo segue com todos os dias', () => {
  for (const t of ['', undefined, null, '01 - FRIO - LEAD', 'Tubarão - anúncio', 'LEAD SOCIAL SELLING - SEGUIDOR', 'social selling']) {
    assert.equal(limiteDeDiasDoTipo(t), undefined, String(t))
  }
})
