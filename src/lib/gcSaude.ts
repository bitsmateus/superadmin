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
 *
 * REGRA DE RISCO. "Risco" é reservado pra sinal REAL de problema: retorno abaixo de 1, meta muito
 * abaixo do ritmo, serviço cancelado, cliente encerrado ou a nota "ruim" do gestor. Falta de dado
 * (nenhuma métrica, nenhum relatório, nenhum contato registrado) NÃO é risco — é "sem dados", e um
 * cliente recém-trazido pra base não pode aparecer vermelho só porque ninguém lançou nada ainda.
 * Esses casos aparecem como atenção na lista de sinais, pra continuar dizendo o que fazer.
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
  churn: { nivel: 'baixo' | 'medio' | 'alto' | 'indefinido'; motivos: string[] }
}

/** Lugar da tela onde o sinal se resolve. */
export type Destino =
  | 'avaliacao' | 'servicos' | 'editar' | 'jornada' | 'metricas' | 'relatorios' | 'notas'

/**
 * Pra onde cada sinal leva ao ser clicado. Fica aqui, junto das regras, e não espalhado pela tela:
 * sinal novo é uma linha nesta tabela, e a tela não precisa saber o que cada um significa.
 */
const DESTINO_DO_SINAL: Record<string, { destino: Destino; rotulo: string }> = {
  avaliacao: { destino: 'avaliacao', rotulo: 'dar a nota' },
  status: { destino: 'editar', rotulo: 'editar o cliente' },
  servicos: { destino: 'servicos', rotulo: 'ver os serviços' },
  renovacao: { destino: 'servicos', rotulo: 'ver a renovação' },
  jornada: { destino: 'jornada', rotulo: 'abrir a jornada' },
  pendencias: { destino: 'jornada', rotulo: 'abrir a jornada' },
  lancamento: { destino: 'metricas', rotulo: 'lançar as métricas' },
  leads: { destino: 'metricas', rotulo: 'ver as métricas' },
  cpl: { destino: 'metricas', rotulo: 'ver as métricas' },
  vendas: { destino: 'metricas', rotulo: 'lançar as vendas' },
  retorno: { destino: 'metricas', rotulo: 'lançar a receita' },
  metas: { destino: 'metricas', rotulo: 'definir as metas' },
  relatorio: { destino: 'relatorios', rotulo: 'publicar o relatório' },
  contato: { destino: 'notas', rotulo: 'registrar o contato' },
}

export function destinoDoSinal(chave: string): { destino: Destino; rotulo: string } | null {
  return DESTINO_DO_SINAL[chave] ?? null
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

/** A nota do gestor vira estado do semáforo. 'regular' é atenção; 'ruim' é risco, sem meio-termo. */
const ESTADO_DA_NOTA: Record<NonNullable<GcClienteLista['avaliacao']>['nivel'], Estado> = {
  otimo: 'otimo',
  bom: 'bom',
  regular: 'atencao',
  ruim: 'risco',
}


/**
 * Monta o semáforo de um cliente a partir da linha da lista (que já traz atrasos, último contato,
 * último relatório, metas e os números do mês e do mês anterior).
 */
export function avaliarSaude(c: GcClienteLista): Saude {
  const sinais: Sinal[] = []
  const mes = comDerivadas(c.metricas_mes ?? {})
  const avaliacao = c.avaliacao ?? null
  const anterior = comDerivadas(c.metricas_mes_anterior ?? {})
  const temLancamento = Object.keys(c.metricas_mes ?? {}).length > 0

  // ---------------------------------------------------------------- a nota do gestor
  // Vem primeiro de propósito: é o julgamento de quem acompanha o cliente, e ele manda no resto.
  if (avaliacao) {
    sinais.push({
      chave: 'avaliacao',
      titulo: 'Resultado, na sua avaliação',
      estado: ESTADO_DA_NOTA[avaliacao.nivel],
      detalhe:
        avaliacao.comentario?.trim() ||
        `Avaliado como "${avaliacao.nivel}"${avaliacao.autor_nome ? ` por ${avaliacao.autor_nome}` : ''}`,
      pesaNoChurn: avaliacao.nivel === 'ruim' || avaliacao.nivel === 'regular',
    })
  } else {
    sinais.push({
      chave: 'avaliacao',
      titulo: 'Resultado, na sua avaliação',
      estado: 'neutro',
      detalhe: 'Ninguém disse ainda se o resultado deste mês está bom ou ruim',
    })
  }

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
      estado: proxima <= 30 ? 'atencao' : 'otimo',
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
    estado: etapasAtrasadas > 0 ? 'atencao' : etapas > 0 && feitas === etapas ? 'otimo' : 'bom',
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
    estado: atrasados > 0 ? 'atencao' : abertos > 0 ? 'bom' : 'otimo',
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
        estado: (vendas ?? 0) > 0 ? 'otimo' : 'atencao',
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
    // Quantos pontos o progresso está atrás de onde deveria estar hoje pelo prazo. Meta não anda em
    // linha reta, então 20 pontos de folga viram só atenção; 40 já é meta muito abaixo e vira risco.
    const atrasoDaMeta = (m: GcMeta): number | null => {
      const progresso = progressoDaMeta(m, mes[m.chave_metrica])
      const decorrido = tempoDecorrido(m)
      if (progresso === null || decorrido === null) return null
      return decorrido * 100 - progresso
    }
    const foraDoRitmo = metasAtivas.filter((m) => (atrasoDaMeta(m) ?? 0) > 20)
    const muitoAbaixo = metasAtivas.filter((m) => (atrasoDaMeta(m) ?? 0) > 40)
    sinais.push({
      chave: 'metas',
      titulo: 'Metas combinadas',
      estado: muitoAbaixo.length > 0 ? 'risco' : foraDoRitmo.length > 0 ? 'atencao' : 'otimo',
      detalhe:
        foraDoRitmo.length > 0
          ? `${foraDoRitmo.length} de ${metasAtivas.length} fora do ritmo (${foraDoRitmo
              .map((m) => metricaLabel(m.chave_metrica))
              .join(', ')})${muitoAbaixo.length > 0 ? ' — muito abaixo do esperado' : ''}`
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
    estado: diasRelatorio !== null && diasRelatorio <= 45 ? 'otimo' : 'atencao',
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
    estado: diasContato !== null && diasContato <= 14 ? 'otimo' : 'atencao',
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

  // Sem dado nenhum pra julgar: nem métrica no mês, nem relatório publicado. É o caso do cliente
  // que acabou de entrar na base — o semáforo diz "Sem dados" em vez de inventar um veredito.
  const semDados = !temLancamento && !c.ultimo_relatorio

  // O nível é o pior quadro que os sinais desenham, não uma média: um cliente com tudo verde e
  // ROAS abaixo de 1 não está "bom na média" — está com problema. Como "risco" só sai de sinal
  // real (ver o cabeçalho), basta um deles pra o cliente aparecer em risco.
  let nivel: Estado
  if (contagem.risco >= 1) nivel = 'risco'
  else if (semDados) nivel = 'neutro'
  else if (contagem.atencao >= 2) nivel = 'atencao'
  else if (contagem.atencao === 1) nivel = 'bom'
  else if (contagem.otimo >= 4) nivel = 'otimo'
  else nivel = 'bom'

  // A nota de quem acompanha o cliente TEM PRIORIDADE: é o julgamento de quem conhece o caso, e os
  // sinais abaixo dela continuam listados pra mostrar os fatos que ela está pesando.
  if (avaliacao) nivel = ESTADO_DA_NOTA[avaliacao.nivel]

  const motivos = sinais
    .filter((s) => s.pesaNoChurn && (s.estado === 'risco' || s.estado === 'atencao'))
    .map((s) => s.detalhe)
  const churn =
    semDados && !avaliacao && contagem.risco === 0
      ? { nivel: 'indefinido' as const, motivos: [] as string[] }
      : {
          nivel:
            motivos.length >= 3
              ? ('alto' as const)
              : motivos.length >= 2
                ? ('medio' as const)
                : ('baixo' as const),
          motivos,
        }

  return { nivel, rotulo: ROTULO_ESTADO[nivel], sinais, contagem, churn }
}

/** Peso da prioridade definida à mão. Alta primeiro, baixa por último. */
const PESO_PRIORIDADE: Record<string, number> = { alta: 0, media: 1, baixa: 2 }

/** Quão grave está o cliente, do pior pro melhor. */
const PESO_ESTADO: Record<Estado, number> = { risco: 0, atencao: 1, neutro: 2, bom: 3, otimo: 4 }

/**
 * A fila de atendimento: em que ordem olhar os clientes hoje.
 *
 * Três critérios, nesta ordem: a PRIORIDADE que a equipe definiu à mão (um cliente grande continua
 * sendo o primeiro mesmo estando verde), depois a gravidade do semáforo, depois quantas pendências
 * estão vencidas. Empate resolve por nome, pra lista não dançar a cada carga.
 *
 * A prioridade vem antes do semáforo de propósito: o semáforo diz o que está pegando fogo, a
 * prioridade diz de quem é o fogo que importa.
 */
export function compararPorPrioridade(
  a: { cliente: GcClienteLista; saude: Saude },
  b: { cliente: GcClienteLista; saude: Saude },
): number {
  const prioridade =
    (PESO_PRIORIDADE[a.cliente.prioridade ?? 'media'] ?? 1) -
    (PESO_PRIORIDADE[b.cliente.prioridade ?? 'media'] ?? 1)
  if (prioridade !== 0) return prioridade

  const gravidade = PESO_ESTADO[a.saude.nivel] - PESO_ESTADO[b.saude.nivel]
  if (gravidade !== 0) return gravidade

  const atrasados = Number(b.cliente.itens_atrasados ?? 0) - Number(a.cliente.itens_atrasados ?? 0)
  if (atrasados !== 0) return atrasados

  return a.cliente.nome_empresa.localeCompare(b.cliente.nome_empresa)
}

/** Só a gravidade, pra quem quiser ver os piores primeiro ignorando a prioridade combinada. */
export function compararPorGravidade(
  a: { cliente: GcClienteLista; saude: Saude },
  b: { cliente: GcClienteLista; saude: Saude },
): number {
  const gravidade = PESO_ESTADO[a.saude.nivel] - PESO_ESTADO[b.saude.nivel]
  if (gravidade !== 0) return gravidade
  const atrasados = Number(b.cliente.itens_atrasados ?? 0) - Number(a.cliente.itens_atrasados ?? 0)
  if (atrasados !== 0) return atrasados
  return a.cliente.nome_empresa.localeCompare(b.cliente.nome_empresa)
}

/** O pior estado de uma lista — usado quando se agrupa sinais num bloco só. */
export function piorEstado(estados: Estado[]): Estado {
  return estados.reduce<Estado>(
    (pior, e) => (PIOR.indexOf(e) > PIOR.indexOf(pior) ? e : pior),
    'neutro',
  )
}
