import type { GcClienteLista, GcMeta } from '@/services/gestaoClientes'
import { comDerivadas, formatarPorChave, metricaLabel, variacaoDaMetrica } from '@/lib/gcMetricas'

/**
 * Semáforo de saúde do cliente (módulo "Clientes NX Digital").
 *
 * A pergunta que isso responde é "esse cliente está bem?" sem obrigar ninguém a abrir seis abas.
 * Em vez de uma nota mágica, são SINAIS nomeados — cada um com estado e com a frase que explica o
 * estado. É isso que permite agir: "atrasado em 3 pendências" diz o que fazer; "saúde 62" não diz.
 *
 * Regras em um lugar só, de propósito: a lista, a tela de Tráfego e o detalhe do cliente mostram o
 * mesmo semáforo, e duas implementações do mesmo cálculo é como elas passam a discordar.
 *
 * Nada aqui vai pro portal do cliente: é leitura interna.
 */

export type Estado = 'otimo' | 'bom' | 'atencao' | 'risco' | 'neutro'

export interface Sinal {
  chave: string
  titulo: string
  estado: Estado
  /** A frase que explica o estado — curta, com o número que motivou. */
  detalhe: string
  /** Conta pro risco de churn? (contato, retorno, relatório, serviço, status) */
  pesaNoChurn?: boolean
}

export interface Saude {
  nivel: Estado
  rotulo: string
  sinais: Sinal[]
  /** Quantos sinais em cada estado — usado nos contadores das telas. */
  contagem: Record<Estado, number>
  churn: { nivel: 'baixo' | 'medio' | 'alto'; motivos: string[] }
}

export const ROTULO_ESTADO: Record<Estado, string> = {
  otimo: 'Ótimo',
  bom: 'Bom',
  atencao: 'Atenção',
  risco: 'Risco',
  neutro: 'Sem dados',
}

/** Dias cheios entre uma data e hoje. Null quando não há data. */
function diasDesde(iso: string | null | undefined): number | null {
  if (!iso) return null
  const quando = new Date(iso).getTime()
  if (Number.isNaN(quando)) return null
  return Math.floor((Date.now() - quando) / 86400000)
}

/** Dias daqui até uma data 'YYYY-MM-DD' (negativo = já passou). */
function diasAte(data: string | null | undefined): number | null {
  if (!data) return null
  const quando = new Date(`${data}T12:00:00`).getTime()
  if (Number.isNaN(quando)) return null
  return Math.round((quando - Date.now()) / 86400000)
}

/** Quanto do prazo da meta já passou, de 0 a 1 — é com isso que se sabe se ela está no ritmo. */
function tempoDecorrido(meta: GcMeta): number | null {
  if (!meta.prazo || !meta.data_base) return null
  const inicio = new Date(String(meta.data_base).slice(0, 10)).getTime()
  const fim = new Date(String(meta.prazo).slice(0, 10)).getTime()
  if (!(fim > inicio)) return null
  return Math.max(0, Math.min(1, (Date.now() - inicio) / (fim - inicio)))
}

/** Progresso da meta a partir do ponto de partida, de 0 a 100. */
export function progressoDaMeta(meta: GcMeta, atual: number | null | undefined): number | null {
  if (atual === null || atual === undefined) return null
  const base = Number(meta.valor_base)
  const alvo = Number(meta.valor_meta)
  if (alvo === base) return atual >= alvo ? 100 : 0
  return Math.max(0, Math.min(100, Math.round(((atual - base) / (alvo - base)) * 100)))
}

const PIOR: Estado[] = ['neutro', 'otimo', 'bom', 'atencao', 'risco']

/**
 * Monta o semáforo de um cliente a partir da linha da lista (que já traz atrasos, último contato,
 * último relatório, metas e os números do mês e do mês anterior).
 */
export function avaliarSaude(c: GcClienteLista): Saude {
  const sinais: Sinal[] = []
  const mes = comDerivadas(c.metricas_mes ?? {})
  const anterior = comDerivadas(c.metricas_mes_anterior ?? {})
  const temLancamento = Object.keys(c.metricas_mes ?? {}).length > 0

  // ---------------------------------------------------------------- cadastro e contrato
  if (c.status !== 'ativo') {
    sinais.push({
      chave: 'status',
      titulo: 'Situação do cliente',
      estado: c.status === 'pausado' ? 'atencao' : 'risco',
      detalhe: c.status === 'pausado' ? 'Cliente pausado' : 'Cliente encerrado',
      pesaNoChurn: true,
    })
  } else {
    sinais.push({
      chave: 'status',
      titulo: 'Situação do cliente',
      estado: 'otimo',
      detalhe: 'Ativo',
    })
  }

  const pausados = (c.servicos ?? []).filter((s) => s.status !== 'ativo')
  sinais.push(
    pausados.length > 0
      ? {
          chave: 'servicos',
          titulo: 'Serviços contratados',
          estado: pausados.some((s) => s.status === 'cancelado') ? 'risco' : 'atencao',
          detalhe: `${pausados.length} serviço(s) fora do ar`,
          pesaNoChurn: true,
        }
      : {
          chave: 'servicos',
          titulo: 'Serviços contratados',
          estado: (c.servicos ?? []).length > 0 ? 'otimo' : 'atencao',
          detalhe:
            (c.servicos ?? []).length > 0
              ? `${c.servicos.length} ativo(s)`
              : 'Nenhum serviço cadastrado',
        },
  )

  // Renovação é hora de churn: se ninguém conversou antes da data, o cliente decide sozinho.
  const renovacoes = (c.servicos ?? [])
    .filter((s) => s.status === 'ativo' && s.data_renovacao)
    .map((s) => diasAte(String(s.data_renovacao).slice(0, 10)))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)
  if (renovacoes.length > 0) {
    const proxima = renovacoes[0]
    sinais.push({
      chave: 'renovacao',
      titulo: 'Renovação do contrato',
      estado: proxima < 0 ? 'risco' : proxima <= 30 ? 'atencao' : 'otimo',
      detalhe:
        proxima < 0
          ? `Venceu há ${Math.abs(proxima)} dia(s) e não foi renovado`
          : proxima === 0
            ? 'Vence hoje'
            : `Em ${proxima} dia(s)`,
      pesaNoChurn: true,
    })
  }

  // ---------------------------------------------------------------- implantação e pendências
  const etapas = Number(c.etapas_total ?? 0)
  const feitas = Number(c.etapas_concluidas ?? 0)
  const etapasAtrasadas = Number(c.etapas_atrasadas ?? 0)
  sinais.push({
    chave: 'jornada',
    titulo: 'Implantação',
    estado: etapasAtrasadas > 0 ? 'risco' : etapas > 0 && feitas === etapas ? 'otimo' : 'bom',
    detalhe:
      etapasAtrasadas > 0
        ? `${etapasAtrasadas} etapa(s) com prazo vencido`
        : etapas > 0 && feitas === etapas
          ? 'Jornada concluída'
          : `${feitas} de ${etapas} etapas · ${c.etapa_atual ?? '—'}`,
  })

  const atrasados = Number(c.itens_atrasados ?? 0)
  const abertos = Number(c.itens_total ?? 0) - Number(c.itens_concluidos ?? 0)
  sinais.push({
    chave: 'pendencias',
    titulo: 'Pendências',
    estado: atrasados > 0 ? 'risco' : abertos > 0 ? 'bom' : 'otimo',
    detalhe:
      atrasados > 0
        ? `${atrasados} item(ns) atrasado(s)`
        : abertos > 0
          ? `${abertos} em aberto, nenhum atrasado`
          : 'Nada em aberto',
  })

  // ---------------------------------------------------------------- números do mês
  if (!temLancamento) {
    sinais.push({
      chave: 'lancamento',
      titulo: 'Números do mês',
      estado: 'atencao',
      detalhe: 'Nenhuma métrica lançada neste mês — sem isso não há como avaliar resultado',
    })
  } else {
    sinais.push({
      chave: 'lancamento',
      titulo: 'Números do mês',
      estado: 'otimo',
      detalhe: `${Object.keys(c.metricas_mes).length} métrica(s) lançada(s)`,
    })

    for (const chave of ['leads', 'cpl'] as const) {
      const v = variacaoDaMetrica(chave, mes[chave], anterior[chave])
      if (mes[chave] === undefined) continue
      sinais.push({
        chave,
        titulo: chave === 'leads' ? 'Volume de leads' : 'Custo por lead',
        estado: !v ? 'neutro' : Math.abs(v.pct) < 5 ? 'bom' : v.boa ? 'otimo' : 'atencao',
        detalhe: !v
          ? `${formatarPorChave(chave, mes[chave])} (sem mês anterior pra comparar)`
          : `${formatarPorChave(chave, mes[chave])} · ${v.pct > 0 ? '+' : ''}${v.pct.toFixed(0)}% vs. mês anterior`,
      })
    }

    const vendas = mes.vendas
    const leads = mes.leads ?? 0
    if (vendas !== undefined || leads > 0) {
      sinais.push({
        chave: 'vendas',
        titulo: 'Vendas',
        estado: (vendas ?? 0) > 0 ? 'otimo' : leads > 0 ? 'risco' : 'atencao',
        detalhe:
          (vendas ?? 0) > 0
            ? `${vendas} venda(s) no mês`
            : leads > 0
              ? `${leads} leads e nenhuma venda registrada`
              : 'Sem venda e sem lead no mês',
        pesaNoChurn: true,
      })
    }

    const retorno = mes.roas
    if (retorno !== undefined) {
      sinais.push({
        chave: 'retorno',
        titulo: 'Retorno (ROAS)',
        estado: retorno >= 3 ? 'otimo' : retorno >= 1 ? 'bom' : 'risco',
        detalhe:
          retorno >= 1
            ? `R$ ${retorno.toFixed(2).replace('.', ',')} de receita por real investido`
            : `Investiu mais do que voltou (${retorno.toFixed(2).replace('.', ',')}x)`,
        pesaNoChurn: true,
      })
    } else if ((mes.investimento ?? 0) > 0) {
      sinais.push({
        chave: 'retorno',
        titulo: 'Retorno (ROAS)',
        estado: 'neutro',
        detalhe: 'Receita do mês não informada — sem ela não dá pra provar retorno',
      })
    }
  }

  // ---------------------------------------------------------------- metas
  const metasAtivas = (c.metas ?? []).filter((m) => m.status === 'ativa')
  if (metasAtivas.length > 0) {
    const foraDoRitmo = metasAtivas.filter((m) => {
      const progresso = progressoDaMeta(m, mes[m.chave_metrica])
      const decorrido = tempoDecorrido(m)
      if (progresso === null || decorrido === null) return false
      // 20 pontos de folga: meta não anda em linha reta, e cobrar ritmo exato viraria alarme falso
      // todo mês.
      return progresso < decorrido * 100 - 20
    })
    sinais.push({
      chave: 'metas',
      titulo: 'Metas combinadas',
      estado: foraDoRitmo.length > 0 ? 'atencao' : 'otimo',
      detalhe:
        foraDoRitmo.length > 0
          ? `${foraDoRitmo.length} de ${metasAtivas.length} fora do ritmo (${foraDoRitmo
              .map((m) => metricaLabel(m.chave_metrica))
              .join(', ')})`
          : `${metasAtivas.length} meta(s) no ritmo`,
    })
  } else {
    sinais.push({
      chave: 'metas',
      titulo: 'Metas combinadas',
      estado: 'atencao',
      detalhe: 'Nenhuma meta definida — sem meta não há como dizer se o mês foi bom',
    })
  }

  // ---------------------------------------------------------------- relação
  const diasRelatorio = c.ultimo_relatorio
    ? diasDesde(`${String(c.ultimo_relatorio).slice(0, 10)}T12:00:00`)
    : null
  sinais.push({
    chave: 'relatorio',
    titulo: 'Relatório entregue',
    estado: diasRelatorio === null ? 'risco' : diasRelatorio <= 45 ? 'otimo' : diasRelatorio <= 75 ? 'atencao' : 'risco',
    detalhe:
      diasRelatorio === null
        ? 'Nunca foi publicado um relatório pra esse cliente'
        : `Último: ${String(c.ultimo_relatorio).slice(0, 7).split('-').reverse().join('/')}`,
    pesaNoChurn: true,
  })

  const diasContato = diasDesde(c.ultimo_contato)
  sinais.push({
    chave: 'contato',
    titulo: 'Último contato',
    estado:
      diasContato === null ? 'risco' : diasContato <= 14 ? 'otimo' : diasContato <= 30 ? 'atencao' : 'risco',
    detalhe:
      diasContato === null
        ? 'Nenhum registro de conversa com esse cliente'
        : diasContato === 0
          ? 'Hoje'
          : `Há ${diasContato} dia(s)`,
    pesaNoChurn: true,
  })

  // ---------------------------------------------------------------- consolidação
  const contagem: Record<Estado, number> = { otimo: 0, bom: 0, atencao: 0, risco: 0, neutro: 0 }
  for (const s of sinais) contagem[s.estado]++

  // O nível é o pior quadro que os sinais desenham, não uma média: um cliente com tudo verde e
  // ROAS abaixo de 1 não está "bom na média" — está com problema.
  let nivel: Estado
  if (contagem.risco >= 2) nivel = 'risco'
  else if (contagem.risco === 1) nivel = contagem.atencao >= 2 ? 'risco' : 'atencao'
  else if (contagem.atencao >= 2) nivel = 'atencao'
  else if (contagem.atencao === 1) nivel = 'bom'
  else if (contagem.otimo >= 4) nivel = 'otimo'
  else nivel = 'bom'

  const motivos = sinais
    .filter((s) => s.pesaNoChurn && (s.estado === 'risco' || s.estado === 'atencao'))
    .map((s) => s.detalhe)
  const churn = {
    nivel: motivos.length >= 3 ? ('alto' as const) : motivos.length >= 2 ? ('medio' as const) : ('baixo' as const),
    motivos,
  }

  return { nivel, rotulo: ROTULO_ESTADO[nivel], sinais, contagem, churn }
}

/** O pior estado de uma lista — usado quando se agrupa sinais num bloco só. */
export function piorEstado(estados: Estado[]): Estado {
  return estados.reduce<Estado>(
    (pior, e) => (PIOR.indexOf(e) > PIOR.indexOf(pior) ? e : pior),
    'neutro',
  )
}
