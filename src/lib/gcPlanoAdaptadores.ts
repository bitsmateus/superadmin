import type {
  GcClienteLista, GcJornadaPortal, GcPlanejamentoApi,
} from '@/services/gestaoClientes'
import { HORIZONTES_PLANO, type MetasPlano, type Planejamento } from '@/lib/gcPlanejamento'

/** O planejamento como a API de edição entrega → o formato do cálculo. */
export function planoDaApi(a: GcPlanejamentoApi): Planejamento {
  return {
    curva: a.curva,
    dataDiagnostico: a.atual.data_diagnostico,
    atual: {
      leads: a.atual.leads_mes,
      investimento: a.atual.investimento_mes,
      ticket: a.atual.ticket_medio,
      conversao: a.atual.taxa_conversao,
      receita: a.atual.faturamento_mensal,
    },
    metas: {
      '6_meses': a.cenarios['6_meses']?.metas ?? {},
      '12_meses': a.cenarios['12_meses']?.metas ?? {},
    },
  }
}

/** O bloco do portal → o formato do cálculo (a mesma rota projetada do painel). */
export function planoDaJornada(j: GcJornadaPortal): Planejamento {
  return {
    curva: j.curva,
    dataDiagnostico: j.data_diagnostico,
    atual: j.atual,
    metas: { '6_meses': j.cenarios['6_meses'].metas, '12_meses': j.cenarios['12_meses'].metas },
  }
}

/**
 * O planejamento de uma linha da LISTA de clientes (que traz o ponto A e as metas, mas não os
 * textos) → o formato do cálculo. Null se o cliente não tem planejamento ou nenhuma meta de 6/12
 * meses. As metas vêm em ordem de criação, então a mais recente de cada métrica prevalece — a mesma
 * regra do editor.
 */
export function planoDaLista(c: Pick<GcClienteLista, 'planejamento' | 'metas'>): Planejamento | null {
  if (!c.planejamento) return null
  const metas: Record<'6_meses' | '12_meses', MetasPlano> = { '6_meses': {}, '12_meses': {} }
  for (const m of c.metas ?? []) {
    if (m.status !== 'ativa') continue
    if (!HORIZONTES_PLANO.some((h) => h.valor === m.horizonte)) continue
    const chave = m.chave_metrica as keyof MetasPlano
    if (!['leads', 'cpl', 'vendas', 'roas', 'receita', 'investimento'].includes(chave)) continue
    metas[m.horizonte as '6_meses' | '12_meses'][chave] = Number(m.valor_meta)
  }
  const p = c.planejamento
  return {
    curva: p.curva,
    dataDiagnostico: p.data_diagnostico,
    atual: {
      leads: p.leads, investimento: p.investimento, ticket: p.ticket, conversao: p.conversao, receita: p.receita,
    },
    metas,
  }
}
