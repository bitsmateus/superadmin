import * as React from 'react'
import { Info } from 'lucide-react'
import { projecaoTemporal, type Planejamento } from '@/lib/gcPlanejamento'
import { formatarMetrica } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloDoMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`

type MetricaDoGrafico = 'receita' | 'investimento' | 'vendas' | 'leads'
const METRICAS_DO_GRAFICO: { chave: MetricaDoGrafico; rotulo: string; unidade: 'reais' | 'inteiro' }[] = [
  { chave: 'receita', rotulo: 'Faturamento', unidade: 'reais' },
  { chave: 'investimento', rotulo: 'Investimento', unidade: 'reais' },
  { chave: 'vendas', rotulo: 'Vendas', unidade: 'inteiro' },
  { chave: 'leads', rotulo: 'Leads', unidade: 'inteiro' },
]

/** Escala "bonita" de eixo: 0, 25%, 50%… do teto, com o teto arredondado pra cima. */
function tetoDoEixo(maximo: number): number {
  if (maximo <= 0) return 1
  const potencia = Math.pow(10, Math.floor(Math.log10(maximo)))
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * potencia >= maximo) return f * potencia
  return maximo
}
const compacto = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
  : v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
  : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

/**
 * PROJEÇÃO TEMPORAL — a tabela mês a mês (investimento, leads, vendas, faturamento e ROAS) com o total,
 * em 6 ou 12 meses, e o gráfico de barras de uma métrica.
 *
 * Serve pra deixar claro pro cliente — e pra quem planeja — o que as metas significam ao longo do tempo.
 * É uma ESTIMATIVA ordenada, não uma promessa: a conta (em gcPlanejamento.projecaoTemporal) é linear do
 * ponto A até as metas, e o aviso embaixo diz isso.
 */
export function ProjecaoTemporalTabela({ plano }: { plano: Planejamento }) {
  const [meses, setMeses] = React.useState<6 | 12>(6)
  const [metrica, setMetrica] = React.useState<MetricaDoGrafico>('receita')
  const p = React.useMemo(() => projecaoTemporal(plano, meses), [plano, meses])
  const temAlgo = p.linhas.some((l) => l.investimento !== null || l.vendas !== null || l.receita !== null || l.leads !== null)

  if (!temAlgo) {
    return (
      <p className="py-6 text-center text-sm text-foreground/45">
        Defina as metas de 6 e 12 meses (investimento, vendas e faturamento) para ver a projeção temporal.
      </p>
    )
  }

  const def = METRICAS_DO_GRAFICO.find((m) => m.chave === metrica)!
  const valores = p.linhas.map((l) => l[metrica] ?? 0)
  const teto = tetoDoEixo(Math.max(...valores))
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto)

  const celula = (v: number | null, unidade: 'reais' | 'inteiro' | 'decimal', estimado = false) => (
    <span className={cn(estimado && 'text-foreground/55')} title={estimado ? 'Estimado: vendas ÷ conversão do ponto A' : undefined}>
      {estimado && v !== null ? '~' : ''}
      {formatarMetrica(v, unidade)}
    </span>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-full bg-elevate/[0.06] p-1" role="group" aria-label="Período da projeção">
          {([6, 12] as const).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={meses === n}
              onClick={() => setMeses(n)}
              className={cn(
                'rounded-full px-3.5 py-1 text-sm font-medium transition-all',
                meses === n ? 'bg-surface text-accent shadow-sm' : 'text-foreground/55 hover:text-foreground/85',
              )}
            >
              {n} meses
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-foreground/55">
          Gráfico
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as MetricaDoGrafico)}
            className="h-8 rounded-lg border border-line bg-transparent px-2 text-sm text-foreground outline-none focus:border-accent/60"
          >
            {METRICAS_DO_GRAFICO.map((m) => (
              <option key={m.chave} value={m.chave} className="bg-surface">
                {m.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-elevate/[0.03] text-xs text-foreground/50">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Mês</th>
              <th className="px-3 py-2.5 text-right font-medium">Investimento</th>
              <th className="px-3 py-2.5 text-right font-medium">Leads</th>
              <th className="px-3 py-2.5 text-right font-medium">Vendas</th>
              <th className="px-3 py-2.5 text-right font-medium">Faturamento</th>
              <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {p.linhas.map((l) => (
              <tr key={l.k} className="border-t border-line">
                <td className="whitespace-nowrap px-3 py-2 text-foreground/80">
                  {l.k}
                  <span className="ml-1.5 text-[11px] text-foreground/35">{rotuloDoMes(l.mes)}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{celula(l.investimento, 'reais')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{celula(l.leads, 'inteiro', l.leadsEstimados)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{celula(l.vendas, 'inteiro')}</td>
                <td className="px-3 py-2 text-right tabular-nums">{celula(l.receita, 'reais')}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-accent">
                  {l.roas === null ? '—' : `${l.roas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-accent/[0.06] font-semibold">
              <td className="px-3 py-2.5 text-accent">Total</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarMetrica(p.total.investimento, 'reais')}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarMetrica(p.total.leads, 'inteiro')}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarMetrica(p.total.vendas, 'inteiro')}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{formatarMetrica(p.total.receita, 'reais')}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-accent">
                {p.total.roas === null ? '—' : `${p.total.roas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Gráfico de barras da métrica escolhida. Os valores ficam também na tabela e no tooltip de cada barra. */}
      <figure className="mt-4 rounded-xl border border-line p-3" aria-label={`Projeção de ${def.rotulo.toLowerCase()} mês a mês`}>
        <div className="flex">
          <div className="flex h-44 w-12 shrink-0 flex-col-reverse justify-between pr-2 text-right text-[10.5px] tabular-nums text-foreground/45">
            {marcas.map((m) => (
              <span key={m} className="leading-none">{compacto(m)}</span>
            ))}
          </div>
          <div className="relative flex h-44 min-w-0 flex-1 items-end gap-1.5 border-b border-l border-line pl-1.5 sm:gap-2.5">
            {marcas.slice(1).map((m) => (
              <span key={m} className="pointer-events-none absolute inset-x-0 border-t border-foreground/[0.07]" style={{ bottom: `${(m / teto) * 100}%` }} />
            ))}
            {p.linhas.map((l, i) => {
              const v = valores[i]
              return (
                <div key={l.k} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`Mês ${l.k} (${rotuloDoMes(l.mes)}): ${formatarMetrica(l[metrica], def.unidade)}`}>
                  <div className="w-full rounded-t-md bg-gradient-to-t from-accent/70 to-accent/40 transition-colors group-hover:from-accent group-hover:to-accent/70" style={{ height: `${Math.max(1, (v / teto) * 100)}%` }} />
                </div>
              )
            })}
          </div>
        </div>
        <div className="ml-12 flex gap-1.5 pl-1.5 pt-1 text-[10.5px] text-foreground/45 sm:gap-2.5">
          {p.linhas.map((l) => (
            <span key={l.k} className="min-w-0 flex-1 truncate text-center">{l.k}</span>
          ))}
        </div>
      </figure>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-foreground/50">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Projeção ESTIMADA a partir das metas — não é garantia. Cresce em linha reta do ponto A até a meta de 6 meses e dela até a de
          12; depois da última meta definida, o valor se mantém.
          {p.partiuDeZero && ' Onde o ponto A não tem o número, a conta parte de zero (cliente que ainda não faz tráfego).'}
          {p.linhas.some((l) => l.leadsEstimados) && ' Leads com "~" são estimados: vendas ÷ a conversão do ponto A.'}
          {p.total.leads === null && ' Leads em branco: defina a meta de leads (ou a conversão no ponto A) para projetá-los.'}
        </span>
      </p>
    </div>
  )
}
