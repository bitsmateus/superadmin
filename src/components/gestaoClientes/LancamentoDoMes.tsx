import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { BarraSalvar } from '@/components/gestaoClientes/BarraSalvar'
import { InfosDoMes } from '@/components/gestaoClientes/InfosDoMes'
import { ModalAvisos } from '@/components/gestaoClientes/ModalAvisos'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import { avisosDoErro, gestaoClientes, type GcMetrica, type GcPlanejamentoApi } from '@/services/gestaoClientes'
import { planoDaApi } from '@/lib/gcPlanoAdaptadores'
import { projecaoTemporal, realizadoPorMes, temPlanejamento } from '@/lib/gcPlanejamento'
import {
  METRICAS_DERIVADAS, METRICAS_LANCADAS, TODAS_METRICAS, comDerivadas, formatarMetrica,
  formatarPorChave, limitesDoMes, mascaraDaUnidade, mascararCampo, mesAtual, mesPorExtenso, metricaLabel, metricaUnidade,
  numeroDigitado, numeroParaCampo, somarMeses, validarMetricas, variacaoDaMetrica,
} from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/** Métricas de um mês viradas em mapa chave → número, com as derivadas calculadas. */
export function doMes(metricas: GcMetrica[], inicio: string): Record<string, number> {
  const brutas: Record<string, string> = {}
  for (const m of metricas) {
    if (String(m.periodo_inicio).slice(0, 10) === inicio) brutas[m.chave] = m.valor
  }
  return comDerivadas(brutas)
}

/** Data do banco ('2026-10-31T...' ou '2026-10-31') em 31/10/2026. */
function dataBr(valor: string | null | undefined): string {
  if (!valor) return '—'
  return String(valor).slice(0, 10).split('-').reverse().join('/')
}

/**
 * O PLANO de um campo no mês: o que se esperava ("plano R$ 5.000") e, com o que está digitado, a diferença.
 * Verde dentro de 10% do plano; âmbar fora disso. Leads "~" são estimados (investimento ÷ CPL médio).
 */
function PlanoDoCampo({
  plano, digitado, unidade, estimado,
}: {
  plano: number | null
  digitado: number | undefined
  unidade: 'reais' | 'inteiro' | 'percentual' | 'decimal'
  estimado?: boolean
}) {
  if (plano === null) return null
  const desvio = digitado !== undefined && plano !== 0 ? ((digitado - plano) / Math.abs(plano)) * 100 : null
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-foreground/50" title="O que o plano esperava pra este mês">
      <span>
        plano {estimado ? '~' : ''}
        {formatarMetrica(plano, unidade)}
      </span>
      {desvio !== null && (
        <span className={cn('rounded-full px-1.5 py-px font-semibold', Math.abs(desvio) <= 10 ? 'bg-success/12 text-success' : 'bg-warning/15 text-warning')}>
          {desvio > 0 ? '+' : ''}
          {desvio.toFixed(0)}% do plano
        </span>
      )}
    </p>
  )
}

/** Variação contra o mês anterior, com a cor certa pra métrica (CPL caindo é bom). */
function Variacao({ chave, atual, anterior }: { chave: string; atual?: number; anterior?: number }) {
  const v = variacaoDaMetrica(chave, atual, anterior)
  if (!v) return null
  if (Math.abs(v.pct) < 0.5) {
    return <span className="text-[11px] text-foreground/40">estável</span>
  }
  return (
    <span className={cn('text-[11px] font-medium', v.boa ? 'text-success' : 'text-danger')}>
      {v.pct > 0 ? '▲' : '▼'} {Math.abs(v.pct).toFixed(0)}%
    </span>
  )
}

/**
 * Métricas e metas do cliente.
 *
 * O lançamento é por mês: a pessoa escolhe o mês, digita o que tem e salva tudo de uma vez. Campo
 * em branco APAGA o lançamento em vez de gravar zero — zero é um número que alguém digitou ("não
 * veio lead nenhum"), branco é "ainda não sei", e as duas coisas não podem virar a mesma.
 *
 * As métricas derivadas (CPL, CTR, ROAS…) não são digitadas nem gravadas: aparecem calculadas do
 * lado. Guardar o CPL junto criaria dois números que podem discordar da própria divisão.
 *
 * A META é o PLANO (aba Planejamento): cada campo mostra o que o plano esperava pra aquele mês, ao lado do
 * que está sendo lançado, com a diferença. Não há mais formulário de meta avulsa por aqui.
 */
/** Os quatro números que todo mês tem: em destaque. O resto é opcional e fica recolhido. */
const CHAVES_EM_DESTAQUE = ['investimento', 'leads', 'vendas', 'receita']
const CHAVES_OPCIONAIS = ['impressoes', 'cliques', 'conversas', 'agendamentos']
/** Calculadas que aparecem sempre; CTR e ticket só quando os números de que dependem existem. */
const DERIVADAS_FIXAS = ['cpl', 'cac', 'roas', 'conversao']

/**
 * O lançamento de UM mês: campos, o que é calculado na hora, o plano ao lado e as informações do mês.
 * Mora aqui pra ser o mesmo nas abas Métricas e Relatórios — o mês que se preenche é o mesmo que vira relatório.
 * `onSalvo` avisa quem está em volta pra recarregar o que depende dos números.
 */
export function LancamentoDoMes({
  clienteId, periodo, onSalvo,
}: {
  clienteId: string
  periodo: string
  onSalvo?: () => void
}) {
  const [metricas, setMetricas] = React.useState<GcMetrica[]>([])
  const [planoApi, setPlanoApi] = React.useState<GcPlanejamentoApi | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [rascunho, setRascunho] = React.useState<Record<string, string>>({})
  const [salvando, setSalvando] = React.useState(false)
  const [maisAberto, setMaisAberto] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const [m, plano] = await Promise.all([
        gestaoClientes.metricas(clienteId),
        // Sem o plano a tela segue funcionando, só sem a comparação.
        gestaoClientes.planejamento(clienteId).catch(() => null),
      ])
      setMetricas(m)
      setPlanoApi(plano)
    } catch (err) {
      toast.error('Falha ao carregar as métricas: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const { inicio, fim } = limitesDoMes(periodo)

  // Trocar de mês (ou recarregar) tem que repreencher os campos com o que está gravado naquele mês.
  React.useEffect(() => {
    const atual: Record<string, string> = {}
    for (const m of metricas) {
      if (String(m.periodo_inicio).slice(0, 10) === inicio) atual[m.chave] = numeroParaCampo(m.valor)
    }
    setRascunho(atual)
  }, [metricas, inicio])

  // O que está digitado, já em número: sem isso "1.500,00" chegaria como NaN nas derivadas e o
  // CPL piscaria em branco enquanto a pessoa digita.
  const valoresDoMes = comDerivadas(
    Object.fromEntries(Object.entries(rascunho).map(([chave, texto]) => [chave, numeroDigitado(texto)])),
  )
  const valoresAnteriores = doMes(metricas, limitesDoMes(somarMeses(periodo, -1)).inicio)

  const [avisos, setAvisos] = React.useState<string[] | null>(null)

  const salvar = async (ignorarAvisos = false) => {
    const valores = Object.fromEntries(
      METRICAS_LANCADAS.map((m) => [m.chave, numeroDigitado(rascunho[m.chave])]),
    )
    if (!ignorarAvisos) {
      const achados = validarMetricas(valores)
      if (achados.length > 0) {
        setAvisos(achados)
        return
      }
    }
    setAvisos(null)
    setSalvando(true)
    try {
      await gestaoClientes.salvarMetricas({
        gc_cliente_id: clienteId,
        periodo_inicio: inicio,
        periodo_fim: fim,
        valores,
        // Quem chegou aqui sem aviso, ou já confirmou na janela, segue — o servidor confere de novo.
        confirmar_avisos: ignorarAvisos,
      })
      toast.success(`Métricas de ${mesPorExtenso(periodo)} salvas`)
      await carregar()
      onSalvo?.()
    } catch (err) {
      // O servidor recusou por números incoerentes que a tela não pegou: mostra os mesmos avisos.
      const doServidor = avisosDoErro(err)
      if (doServidor) setAvisos(doServidor)
      else toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  // Alteração pendente = o rascunho difere do que está gravado no mês (comparando NÚMEROS, pra a máscara
  // "2000" → "2.000,00" não contar como mudança).
  const gravadoDoMes: Record<string, number> = {}
  for (const m of metricas) {
    if (String(m.periodo_inicio).slice(0, 10) === inicio) gravadoDoMes[m.chave] = Number(m.valor)
  }
  const digitado: Record<string, number> = {}
  for (const [k, v] of Object.entries(rascunho)) {
    const n = numeroDigitado(v)
    if (n !== null) digitado[k] = n
  }
  const sujoDoMes = JSON.stringify(Object.entries(digitado).sort()) !== JSON.stringify(Object.entries(gravadoDoMes).sort())
  useAvisoAoSair(sujoDoMes)

  // O que o PLANO esperava pra este mês: a linha do mês na projeção (mês 1 em diante).
  const realizadoPorMesDoPlano = React.useMemo(() => realizadoPorMes(metricas), [metricas])
  const linhaDoPlano = React.useMemo(() => {
    if (!planoApi) return null
    const plano = planoDaApi(planoApi)
    if (!temPlanejamento(plano)) return null
    const proj = projecaoTemporal(plano, 12, { realizado: realizadoPorMesDoPlano, mesCorrente: mesAtual() })
    return proj.linhas.find((l) => l.mes === periodo) ?? null
  }, [planoApi, realizadoPorMesDoPlano, periodo])
  const algumOpcional = CHAVES_OPCIONAIS.some((c) => (rascunho[c] ?? '').trim() !== '')
  const mostrarMais = maisAberto || algumOpcional
  const tem = (c: string) => valoresDoMes[c] !== undefined
  const derivadasVisiveis = METRICAS_DERIVADAS.filter(
    (d) =>
      DERIVADAS_FIXAS.includes(d.chave) ||
      (d.chave === 'ctr' && tem('impressoes') && tem('cliques')) ||
      (d.chave === 'ticket' && tem('vendas') && tem('receita')),
  ).sort((a, b) => {
    const ordem = ['cpl', 'cac', 'roas', 'conversao', 'ctr', 'ticket']
    return ordem.indexOf(a.chave) - ordem.indexOf(b.chave)
  })
  /** Um campo de lançamento. O texto de ajuda mora no tooltip, não embaixo do campo. */
  const campoDoMes = (chave: string) => {
    const m = METRICAS_LANCADAS.find((x) => x.chave === chave)!
    return (
      <div key={m.chave} title={m.ajuda}>
        <Input
          label={m.label}
          value={rascunho[m.chave] ?? ''}
          onChange={(e) => setRascunho((r) => ({ ...r, [m.chave]: e.target.value }))}
          placeholder={m.unidade === 'reais' ? '0,00' : '0'}
          inputMode="decimal"
          onBlur={() => setRascunho((r) => ({ ...r, [m.chave]: mascararCampo(r[m.chave] ?? '', mascaraDaUnidade(m.unidade)) }))}
        />
        <div className="mt-1 min-h-4">
          {linhaDoPlano && (m.chave === 'investimento' || m.chave === 'leads' || m.chave === 'vendas' || m.chave === 'receita') && (
            <PlanoDoCampo
              plano={linhaDoPlano.projetado[m.chave as 'investimento' | 'leads' | 'vendas' | 'receita']}
              digitado={valoresDoMes[m.chave]}
              unidade={m.unidade}
              estimado={m.chave === 'leads' && linhaDoPlano.leadsEstimados}
            />
          )}
          <Variacao chave={m.chave} atual={valoresDoMes[m.chave]} anterior={valoresAnteriores[m.chave]} />
        </div>
      </div>
    )
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">Valores de {mesPorExtenso(periodo).toLowerCase()}</p>
          <Button onClick={() => void salvar()} loading={salvando}>
            Salvar o mês
          </Button>
        </div>

        {planoApi && (
          <p
            className={cn(
              'mb-3 rounded-lg px-3 py-2 text-xs',
              linhaDoPlano ? 'border border-accent/20 bg-accent/[0.05] text-foreground/75' : 'border border-line bg-elevate/[0.02] text-foreground/50',
            )}
          >
            {linhaDoPlano ? (
              <>
                <strong className="text-foreground">Plano para {mesPorExtenso(periodo).toLowerCase()}: mês {linhaDoPlano.k}.</strong> Em cada campo você vê
                o que o plano esperava ("plano") ao lado do que está lançando.
              </>
            ) : (
              <>
                Este mês não está no plano (o plano começa no mês seguinte ao diagnóstico). Defina o <strong>Mês 1</strong> e as metas na aba <strong>Planejamento</strong> para
                comparar aqui.
              </>
            )}
          </p>
        )}

        {/* Os campos e o que eles geram ficam LADO A LADO e juntos: preencher à esquerda, ver o resultado
            (CPL, ROAS…) na hora à direita, sem esticar os campos pela largura toda da tela. */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-8">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/50">1 · Preencha o mês</p>
            <div className="grid grid-cols-2 gap-3">{CHAVES_EM_DESTAQUE.map((chave) => campoDoMes(chave))}</div>

            <div className="mt-2">
              <button
                type="button"
                onClick={() => setMaisAberto((a) => !a)}
                aria-expanded={mostrarMais}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground/55 transition-colors hover:text-foreground"
              >
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !mostrarMais && '-rotate-90')} />
                Mais métricas (opcional)
                {!mostrarMais && algumOpcional && <span className="text-accent">· preenchidas</span>}
              </button>
              {mostrarMais && <div className="mt-2 grid grid-cols-2 gap-3">{CHAVES_OPCIONAIS.map((chave) => campoDoMes(chave))}</div>}
            </div>
          </div>

          <div className="rounded-2xl bg-elevate/[0.03] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/50">2 · Calculado na hora</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
              {derivadasVisiveis.map((d) => (
                <div key={d.chave} title={d.ajuda}>
                  <dt className="text-xs text-foreground/50">{d.label}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">{formatarMetrica(valoresDoMes[d.chave] ?? null, d.unidade)}</dd>
                  <Variacao chave={d.chave} atual={valoresDoMes[d.chave]} anterior={valoresAnteriores[d.chave]} />
                </div>
              ))}
            </dl>
          </div>
        </div>

        <InfosDoMes clienteId={clienteId} inicio={inicio} onMudou={onSalvo} />
      </section>

      <BarraSalvar
        visivel={sujoDoMes}
        salvando={salvando}
        rotulo="Salvar o mês"
        onSalvar={() => void salvar()}
        onDescartar={() => {
          const atual: Record<string, string> = {}
          for (const m of metricas) {
            if (String(m.periodo_inicio).slice(0, 10) === inicio) atual[m.chave] = numeroParaCampo(m.valor)
          }
          setRascunho(atual)
        }}
      />

      <ModalAvisos
        avisos={avisos}
        salvando={salvando}
        onCorrigir={() => setAvisos(null)}
        onSalvarMesmoAssim={() => void salvar(true)}
      />
    </div>
  )
}
