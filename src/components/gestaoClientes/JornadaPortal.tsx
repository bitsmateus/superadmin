import * as React from 'react'
import { Flag, Sprout } from 'lucide-react'
import { GraficoProjecao } from '@/components/gestaoClientes/GraficoProjecao'
import type { GcJornadaPortal } from '@/services/gestaoClientes'
import {
  CHAVES_PLANO, HORIZONTES_PLANO, projecaoMensal, realizadoPorMes, rotaProjetada, type ChavePlano,
} from '@/lib/gcPlanejamento'
import { planoDaJornada } from '@/lib/gcPlanoAdaptadores'
import { formatarMetrica, mesAtual, metricaUnidade } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/** No portal, o cliente escolhe entre o que o portal realmente tem de realizado. */
const CHAVES_DO_PORTAL: ChavePlano[] = ['leads', 'vendas', 'receita']

function dataBr(data: string | null): string {
  return data ? data.slice(0, 10).split('-').reverse().join('/') : ''
}

/**
 * "Nossa jornada" — o bloco do portal que conta ao cliente de onde partimos, onde estamos indo e se
 * o caminho está sendo cumprido.
 *
 * O que chega aqui já foi filtrado pelo servidor: a estratégia e as premissas nem são enviadas, e a
 * situação de hoje e o "onde quer chegar" só vêm se a equipe marcou. O realizado vem só dos meses de
 * relatório publicado, então o gráfico nunca mostra um número que o cliente ainda não viu num
 * relatório.
 *
 * Sem faixa de desvio: no portal o gráfico é "o que combinamos × o que está acontecendo". O desvio
 * em percentual é ferramenta de acompanhamento interno.
 */
export function JornadaPortal({ jornada }: { jornada: GcJornadaPortal }) {
  const plano = React.useMemo(() => planoDaJornada(jornada), [jornada])
  const realizado = React.useMemo(() => {
    // Do formato do servidor (métrica → mês → valor) pro que o cálculo espera, com CPL e ROAS derivados.
    const linhas = Object.entries(jornada.realizado).flatMap(([chave, porMes]) =>
      Object.entries(porMes).map(([mes, valor]) => ({ periodo_inicio: `${mes}-01`, chave, valor })),
    )
    return realizadoPorMes(linhas)
  }, [jornada])

  const disponiveis = CHAVES_PLANO.filter(
    (c) => CHAVES_DO_PORTAL.includes(c.chave) && rotaProjetada(plano, c.chave).length > 0,
  )
  const [escolhida, setEscolhida] = React.useState<ChavePlano | null>(null)
  const chave = (disponiveis.find((d) => d.chave === escolhida) ?? disponiveis[0])?.chave ?? null
  const linhas = chave ? projecaoMensal(plano, chave, realizado, mesAtual()) : []

  const pontoA = [
    { rotulo: 'Leads por mês', valor: jornada.atual.leads, unidade: 'inteiro' as const },
    { rotulo: 'Investimento por mês', valor: jornada.atual.investimento, unidade: 'reais' as const },
    { rotulo: 'Ticket médio', valor: jornada.atual.ticket, unidade: 'reais' as const },
    { rotulo: 'Taxa de conversão', valor: jornada.atual.conversao, unidade: 'percentual' as const },
    { rotulo: 'Faturamento mensal', valor: jornada.atual.receita, unidade: 'reais' as const },
  ].filter((p) => p.valor !== null)

  const temMetas = HORIZONTES_PLANO.some((h) => Object.keys(jornada.cenarios[h.valor].metas).length > 0)
  if (pontoA.length === 0 && !jornada.situacao && !temMetas) return null

  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">Nossa jornada</h2>
        <p className="text-xs text-foreground/50">De onde partimos, aonde estamos indo e como o caminho está sendo cumprido.</p>
      </header>

      {(pontoA.length > 0 || jornada.situacao) && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-foreground/45">
            <Sprout className="h-3.5 w-3.5" /> Onde começamos
            {jornada.data_diagnostico && (
              <span className="normal-case text-foreground/35"> · diagnóstico em {dataBr(jornada.data_diagnostico)}</span>
            )}
          </h3>
          {jornada.situacao && (
            <p className="mb-3 whitespace-pre-wrap rounded-xl border-l-2 border-line bg-elevate/[0.02] px-4 py-3 text-sm text-foreground/85">
              {jornada.situacao}
            </p>
          )}
          {pontoA.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {pontoA.map((p) => (
                <div key={p.rotulo} className="rounded-xl border border-line px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-foreground/45">{p.rotulo}</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatarMetrica(p.valor, p.unidade)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {temMetas && (
        <div className="mt-5">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-foreground/45">
            <Flag className="h-3.5 w-3.5" /> Aonde queremos chegar
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {HORIZONTES_PLANO.map((h) => {
              const c = jornada.cenarios[h.valor]
              const metas = CHAVES_PLANO.filter((k) => c.metas[k.chave] !== undefined)
              if (metas.length === 0 && !c.objetivo) return null
              return (
                <div key={h.valor} className="rounded-xl border border-line p-3">
                  <p className="mb-1.5 text-sm font-semibold text-foreground">Em {h.label}</p>
                  {c.objetivo && <p className="mb-2 whitespace-pre-wrap text-sm text-foreground/80">{c.objetivo}</p>}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {metas.map((k) => (
                      <div key={k.chave} className="flex items-baseline justify-between gap-2 border-b border-line/60 py-1">
                        <dt className="text-xs text-foreground/55">{k.chave === 'receita' ? 'Faturamento' : k.label}</dt>
                        <dd className="text-sm font-semibold tabular-nums text-foreground">
                          {formatarMetrica(c.metas[k.chave]!, metricaUnidade(k.chave))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {chave && (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-wide text-foreground/45">O caminho: combinado × realizado</h3>
            {disponiveis.length > 1 && (
              <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Métrica do gráfico">
                {disponiveis.map((d) => (
                  <button
                    key={d.chave}
                    type="button"
                    onClick={() => setEscolhida(d.chave)}
                    aria-pressed={chave === d.chave}
                    className={cn(
                      'h-8 px-3 text-xs transition-colors',
                      chave === d.chave ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/50 hover:text-foreground/80',
                    )}
                  >
                    {d.chave === 'receita' ? 'Faturamento' : d.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <GraficoProjecao linhas={linhas} chave={chave} mostrarDesvio={false} />
          <p className="mt-1 text-[11px] text-foreground/40">
            O realizado aparece mês a mês, conforme os relatórios são publicados.
          </p>
        </div>
      )}
    </section>
  )
}
