import type {
  GcClienteLista, GcJornadaPortal, GcPlanejamentoApi,
} from '@/services/gestaoClientes'
import {
  HORIZONTES_PLANO, comMetasCalculadas, montarPontoA, type MetasPlano, type Planejamento,
} from '@/lib/gcPlanejamento'

// A curva é sempre linear (o seletor saiu da tela) e CPL/ROAS são sempre calculados das metas digitadas:
// o que vier gravado pra essas duas chaves, de planejamentos antigos, é ignorado em todos os adaptadores.

/** O primeiro mês e o CPL médio (null vira ausente: "sem número" não é zero). */
function primeiroMesDe(pm: { investimento: number | null; vendas: number | null; faturamento: number | null; cpl_medio: number | null } | undefined) {
  const out: Pick<Planejamento, 'primeiroMes' | 'cplMedio'> = {}
  if (!pm) return out
  const mes: NonNullable<Planejamento['primeiroMes']> = {}
  if (pm.investimento !== null) mes.investimento = Number(pm.investimento)
  if (pm.vendas !== null) mes.vendas = Number(pm.vendas)
  if (pm.faturamento !== null) mes.receita = Number(pm.faturamento)
  if (Object.keys(mes).length) out.primeiroMes = mes
  if (pm.cpl_medio !== null) out.cplMedio = Number(pm.cpl_medio)
  return out
}

/** O planejamento como a API de edição entrega → o formato do cálculo. */
export function planoDaApi(a: GcPlanejamentoApi): Planejamento {
  return {
    ...primeiroMesDe(a.primeiro_mes),
    curva: 'linear',
    dataDiagnostico: a.atual.data_diagnostico,
    atual: montarPontoA({
      leads: a.atual.leads_mes,
      investimento: a.atual.investimento_mes,
      vendas: a.atual.vendas_mes,
      receita: a.atual.faturamento_mensal,
    }),
    metas: {
      '6_meses': comMetasCalculadas(a.cenarios['6_meses']?.metas ?? {}),
      '12_meses': comMetasCalculadas(a.cenarios['12_meses']?.metas ?? {}),
    },
  }
}

/** O bloco do portal → o formato do cálculo (a mesma rota projetada do painel). */
export function planoDaJornada(j: GcJornadaPortal): Planejamento {
  return {
    ...primeiroMesDe(j.primeiro_mes),
    curva: 'linear',
    dataDiagnostico: j.data_diagnostico,
    atual: montarPontoA({
      leads: j.atual.leads, investimento: j.atual.investimento, vendas: j.atual.vendas, receita: j.atual.receita,
    }),
    metas: {
      '6_meses': comMetasCalculadas(j.cenarios['6_meses'].metas),
      '12_meses': comMetasCalculadas(j.cenarios['12_meses'].metas),
    },
  }
}

const CHAVES_GRAVADAS = ['leads', 'vendas', 'investimento', 'receita']

/**
 * O planejamento de uma linha da LISTA de clientes (que traz o ponto A e as metas, mas não os
 * textos) → o formato do cálculo. Null se o cliente não tem linha de planejamento nem meta de 6/12
 * meses. As metas vêm em ordem de criação, então a mais recente de cada métrica prevalece — a mesma
 * regra do editor.
 *
 * Sem data do diagnóstico, a rota começa no primeiro mês lançado em Métricas.
 */
export function planoDaLista(
  c: Pick<GcClienteLista, 'planejamento' | 'metas'> & { primeiro_mes_metricas?: string | null },
): Planejamento | null {
  const metas: Record<'6_meses' | '12_meses', MetasPlano> = { '6_meses': {}, '12_meses': {} }
  for (const m of c.metas ?? []) {
    if (m.status !== 'ativa') continue
    if (!HORIZONTES_PLANO.some((h) => h.valor === m.horizonte)) continue
    if (!CHAVES_GRAVADAS.includes(m.chave_metrica)) continue
    metas[m.horizonte as '6_meses' | '12_meses'][m.chave_metrica as keyof MetasPlano] = Number(m.valor_meta)
  }
  const p = c.planejamento
  const temMeta = HORIZONTES_PLANO.some((h) => Object.keys(metas[h.valor]).length > 0)
  if (!p && !temMeta) return null
  return {
    ...primeiroMesDe(
      p
        ? {
            investimento: p.mes1_investimento ?? null, vendas: p.mes1_vendas ?? null,
            faturamento: p.mes1_faturamento ?? null, cpl_medio: p.cpl_medio ?? null,
          }
        : undefined,
    ),
    curva: 'linear',
    dataDiagnostico:
      p?.data_diagnostico ?? (c.primeiro_mes_metricas ? `${c.primeiro_mes_metricas}-01` : null),
    atual: montarPontoA({
      leads: p?.leads ?? null, investimento: p?.investimento ?? null, vendas: p?.vendas ?? null, receita: p?.receita ?? null,
    }),
    metas: { '6_meses': comMetasCalculadas(metas['6_meses']), '12_meses': comMetasCalculadas(metas['12_meses']) },
  }
}
