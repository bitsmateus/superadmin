import * as React from 'react'
import { ArrowRight, Info } from 'lucide-react'
import {
  baseDoPontoA, doPrimeiroMes, projecaoTemporal,
  type LinhaTemporal, type Planejamento, type SituacaoDaLinha, type ValoresDoMes,
} from '@/lib/gcPlanejamento'
import { formatarMetrica, mesAtual } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloDoMes = (mes: string) => `${NOMES_MES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`

type Metrica = 'investimento' | 'leads' | 'vendas' | 'receita'
type Unidade = 'reais' | 'inteiro' | 'decimal'
const COLUNAS: { chave: Metrica | 'roas'; rotulo: string; unidade: Unidade }[] = [
  { chave: 'investimento', rotulo: 'Investimento', unidade: 'reais' },
  { chave: 'leads', rotulo: 'Leads', unidade: 'inteiro' },
  { chave: 'vendas', rotulo: 'Vendas', unidade: 'inteiro' },
  { chave: 'receita', rotulo: 'Faturamento', unidade: 'reais' },
  { chave: 'roas', rotulo: 'ROAS', unidade: 'decimal' },
]

const SITUACAO: Record<SituacaoDaLinha, { texto: string; classe: string }> = {
  no_caminho: { texto: 'No caminho', classe: 'bg-success/12 text-success' },
  acima: { texto: 'Acima', classe: 'bg-accent/12 text-accent' },
  abaixo: { texto: 'Abaixo', classe: 'bg-warning/15 text-warning' },
  a_vir: { texto: 'A vir', classe: 'bg-elevate/[0.06] text-foreground/45' },
  sem_lancamento: { texto: 'Sem lançamento', classe: 'bg-elevate/[0.06] text-foreground/45' },
  sem_comparacao: { texto: 'Lançado', classe: 'bg-elevate/[0.06] text-foreground/55' },
}

function tetoDoEixo(maximo: number): number {
  if (maximo <= 0) return 1
  const potencia = Math.pow(10, Math.floor(Math.log10(maximo)))
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * potencia >= maximo) return f * potencia
  return maximo
}
const compacto = (v: number) =>
  v >= 1_000_000
    ? `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
    : v >= 1000
      ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`
      : v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })

const formatar = (v: number | null, unidade: Unidade) =>
  unidade === 'decimal'
    ? v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}x`
    : formatarMetrica(v, unidade)

// ---------------------------------------------------------------------------------------------------
// O cenário em passos: Hoje → Mês 1 → 6 meses → 12 meses
// ---------------------------------------------------------------------------------------------------

interface Passo {
  rotulo: string
  titulo: string
  itens: { rotulo: string; valor: string }[]
  nota?: string
}

function passosDoCenario(plano: Planejamento): Passo[] {
  const base = baseDoPontoA(plano.atual)
  const nums = (v: Partial<Record<Metrica, number>>): Passo['itens'] => {
    const saida: Passo['itens'] = []
    if (v.investimento !== undefined) saida.push({ rotulo: 'Investir', valor: formatarMetrica(v.investimento, 'reais') })
    if (v.leads !== undefined) saida.push({ rotulo: 'Leads', valor: formatarMetrica(v.leads, 'inteiro') })
    if (v.vendas !== undefined) saida.push({ rotulo: 'Vendas', valor: formatarMetrica(v.vendas, 'inteiro') })
    if (v.receita !== undefined) saida.push({ rotulo: 'Faturamento', valor: formatarMetrica(v.receita, 'reais') })
    return saida
  }
  const zerado =
    base.investimento === 0 && (base.leads ?? 0) === 0 && (base.vendas ?? 0) === 0 && (base.receita ?? 0) === 0
  const hoje = nums({ investimento: base.investimento, leads: base.leads, vendas: base.vendas, receita: base.receita })
  const mes1 = {
    investimento: doPrimeiroMes(plano, 'investimento'),
    leads: doPrimeiroMes(plano, 'leads'),
    vendas: doPrimeiroMes(plano, 'vendas'),
    receita: doPrimeiroMes(plano, 'receita'),
  }
  const m6 = plano.metas['6_meses']
  const m12 = plano.metas['12_meses']
  const pegar = (m: typeof m6) => nums({ investimento: m.investimento, leads: m.leads, vendas: m.vendas, receita: m.receita })
  const itensMes1 = nums(mes1)
  return [
    {
      rotulo: 'Hoje',
      titulo: zerado ? 'Não investe ainda' : 'Ponto A',
      itens: zerado ? [] : hoje,
      nota: zerado ? 'Tudo zerado: o plano parte do zero.' : hoje.length === 0 ? 'a definir' : undefined,
    },
    {
      rotulo: 'Mês 1',
      titulo: 'Começar a investir',
      itens: itensMes1,
      nota:
        plano.cplMedio !== undefined && mes1.leads !== undefined
          ? `Leads = investimento ÷ CPL médio de ${formatarMetrica(plano.cplMedio, 'reais')}`
          : itensMes1.length === 0 ? 'a definir' : undefined,
    },
    { rotulo: 'Em 6 meses', titulo: 'Meta 6 meses', itens: pegar(m6), nota: pegar(m6).length ? undefined : 'a definir' },
    { rotulo: 'Em 12 meses', titulo: 'Meta 12 meses', itens: pegar(m12), nota: pegar(m12).length ? undefined : 'a definir' },
  ]
}

function CenarioEmPassos({ plano }: { plano: Planejamento }) {
  const passos = passosDoCenario(plano)
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {passos.map((p, i) => (
        <li key={p.rotulo} className="rounded-xl border border-line bg-gradient-to-br from-elevate/[0.04] to-transparent p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">{p.rotulo}</span>
            {i < passos.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 text-foreground/25 xl:block" />}
          </div>
          <p className="text-sm font-semibold text-foreground">{p.titulo}</p>
          {p.itens.length > 0 && (
            <dl className="mt-1.5 space-y-0.5 text-sm">
              {p.itens.map((it) => (
                <div key={it.rotulo} className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-foreground/50">{it.rotulo}</dt>
                  <dd className="font-medium tabular-nums text-foreground">{it.valor}</dd>
                </div>
              ))}
            </dl>
          )}
          {p.nota && <p className="mt-1.5 text-[11px] leading-snug text-foreground/45">{p.nota}</p>}
        </li>
      ))}
    </ol>
  )
}

// ---------------------------------------------------------------------------------------------------
// A tabela PROJETADO × REAL e o gráfico
// ---------------------------------------------------------------------------------------------------

/** Uma célula com os dois lados: projetado (apagado, em cima) e real (em destaque, embaixo), com o desvio. */
function CelulaPar({
  projetado, real, unidade, estimado, rotuloProjetado = 'proj.',
}: {
  projetado: number | null
  real: number | null
  unidade: Unidade
  estimado?: boolean
  rotuloProjetado?: string
}) {
  const desvio = projetado !== null && projetado !== 0 && real !== null ? ((real - projetado) / Math.abs(projetado)) * 100 : null
  return (
    <div className="text-right leading-tight tabular-nums">
      <div className="text-[11px] text-foreground/45" title={estimado ? 'Estimado a partir do CPL médio (ou das vendas ÷ conversão)' : undefined}>
        <span className="mr-1 text-foreground/30">{rotuloProjetado}</span>
        {estimado && projetado !== null ? '~' : ''}
        {formatar(projetado, unidade)}
      </div>
      <div className={cn('text-sm', real === null ? 'text-foreground/25' : 'font-semibold text-foreground')}>
        <span className="mr-1 text-[11px] font-normal text-foreground/30">real</span>
        {formatar(real, unidade)}
        {desvio !== null && Math.abs(desvio) >= 0.5 && (
          <span className={cn('ml-1.5 text-[10px] font-semibold', desvio > 0 ? 'text-success' : 'text-warning')}>
            {desvio > 0 ? '▲' : '▼'}
            {Math.abs(desvio).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * PROJEÇÃO × REAL — o cenário em passos (hoje → mês 1 → 6 → 12 meses) e, mês a mês, o que se projeta
 * LADO A LADO com o que foi lançado, com o total do plano, o real acumulado e um gráfico.
 */
export function ProjecaoXReal({
  plano,
  realizado,
}: {
  plano: Planejamento
  /** Métricas lançadas por mês ('YYYY-MM' → chave → valor), já com as derivadas. */
  realizado: Record<string, Record<string, number>>
}) {
  const [meses, setMeses] = React.useState<6 | 12>(6)
  const [metrica, setMetrica] = React.useState<Metrica>('receita')
  const p = React.useMemo(() => projecaoTemporal(plano, meses, { realizado, mesCorrente: mesAtual() }), [plano, meses, realizado])
  const temAlgo = p.linhas.some((l) => Object.values(l.projetado).some((v) => v !== null))

  if (!temAlgo) {
    return (
      <div>
        <CenarioEmPassos plano={plano} />
        <p className="py-6 text-center text-sm text-foreground/45">
          Defina o primeiro mês e as metas de 6 e 12 meses (investimento, vendas e faturamento) para ver a projeção.
        </p>
      </div>
    )
  }

  const def = COLUNAS.find((c) => c.chave === metrica)!
  const projetados = p.linhas.map((l) => l.projetado[metrica] ?? 0)
  const reais = p.linhas.map((l) => l.real[metrica])
  const teto = tetoDoEixo(Math.max(...projetados, ...reais.map((v) => v ?? 0)))
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * teto)
  const algumReal = reais.some((v) => v !== null)

  const linhaDaTabela = (l: LinhaTemporal, destaque?: string) => {
    const s = SITUACAO[l.situacao]
    return (
      <tr key={l.k} className="border-t border-line align-top">
        <td className="whitespace-nowrap px-3 py-2">
          <div className="font-medium text-foreground/85">
            {destaque ?? `Mês ${l.k}`}
            <span className="ml-1.5 text-[11px] font-normal text-foreground/35">{rotuloDoMes(l.mes)}</span>
          </div>
          {l.k > 0 && (
            <span className={cn('mt-0.5 inline-block rounded-full px-2 py-px text-[10px] font-semibold', s.classe)}>{s.texto}</span>
          )}
        </td>
        {COLUNAS.map((c) => (
          <td key={c.chave} className="px-3 py-2">
            <CelulaPar
              projetado={(l.projetado as ValoresDoMes)[c.chave]}
              real={(l.real as ValoresDoMes)[c.chave]}
              unidade={c.unidade}
              estimado={c.chave === 'leads' && l.leadsEstimados}
              rotuloProjetado={l.k === 0 ? 'A' : 'proj.'}
            />
          </td>
        ))}
      </tr>
    )
  }

  return (
    <div>
      <CenarioEmPassos plano={plano} />

      <div className="mb-3 mt-5 flex flex-wrap items-center justify-between gap-2">
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
        <p className="text-xs text-foreground/45">
          Em cada célula: <span className="text-foreground/60">projetado</span> em cima, <strong className="text-foreground/80">real</strong> embaixo.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-elevate/[0.03] text-xs text-foreground/50">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Mês</th>
              {COLUNAS.map((c) => (
                <th key={c.chave} className="px-3 py-2.5 text-right font-medium">{c.rotulo}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhaDaTabela(p.inicio, 'Hoje')}
            {p.linhas.map((l) => linhaDaTabela(l))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-accent/[0.06] align-top">
              <td className="px-3 py-2.5 font-semibold text-accent">Plano de {meses} meses</td>
              {COLUNAS.map((c) => (
                <td key={c.chave} className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">
                  {formatar((p.total as ValoresDoMes)[c.chave], c.unidade)}
                </td>
              ))}
            </tr>
            {p.acumulado.meses > 0 && (
              <tr className="border-t border-line/60 bg-success/[0.05] align-top">
                <td className="px-3 py-2.5 text-xs font-semibold text-success">
                  Real até agora
                  <span className="block font-normal text-foreground/45">{p.acumulado.meses} mês(es) lançado(s)</span>
                </td>
                {COLUNAS.map((c) => (
                  <td key={c.chave} className="px-3 py-2.5">
                    <CelulaPar
                      projetado={(p.acumulado.projetado as ValoresDoMes)[c.chave]}
                      real={(p.acumulado.real as ValoresDoMes)[c.chave]}
                      unidade={c.unidade}
                      rotuloProjetado="plano"
                    />
                  </td>
                ))}
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {/* Gráfico: a mesma métrica, projetado (barra clara) e real (barra cheia), mês a mês. */}
      <figure className="mt-4 rounded-xl border border-line p-3" aria-label={`Projetado e real de ${def.rotulo.toLowerCase()} mês a mês`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4 text-xs text-foreground/60">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm border border-accent/60 bg-accent/25" /> Projetado</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-success" /> Real</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground/55">
            Gráfico de
            <select
              value={metrica}
              onChange={(e) => setMetrica(e.target.value as Metrica)}
              className="h-8 rounded-lg border border-line bg-transparent px-2 text-sm text-foreground outline-none focus:border-accent/60"
            >
              {COLUNAS.filter((c) => c.chave !== 'roas').map((c) => (
                <option key={c.chave} value={c.chave} className="bg-surface">{c.rotulo}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex">
          <div className="flex h-44 w-12 shrink-0 flex-col-reverse justify-between pr-2 text-right text-[10.5px] tabular-nums text-foreground/45">
            {marcas.map((m) => (
              <span key={m} className="leading-none">{compacto(m)}</span>
            ))}
          </div>
          <div className="relative flex h-44 min-w-0 flex-1 items-end gap-1 border-b border-l border-line pl-1 sm:gap-2">
            {marcas.slice(1).map((m) => (
              <span key={m} className="pointer-events-none absolute inset-x-0 border-t border-foreground/[0.07]" style={{ bottom: `${(m / teto) * 100}%` }} />
            ))}
            {p.linhas.map((l, i) => (
              <div
                key={l.k}
                className="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
                title={`Mês ${l.k} (${rotuloDoMes(l.mes)}) — projetado ${formatar(l.projetado[metrica], def.unidade)}${
                  l.real[metrica] !== null ? ` · real ${formatar(l.real[metrica], def.unidade)}` : ' · sem lançamento'
                }`}
              >
                <div
                  className="w-1/2 max-w-[22px] rounded-t border border-b-0 border-accent/60 bg-accent/25"
                  style={{ height: `${Math.max(1, (projetados[i] / teto) * 100)}%` }}
                />
                <div
                  className={cn('w-1/2 max-w-[22px] rounded-t', reais[i] === null ? 'bg-transparent' : 'bg-success')}
                  style={{ height: `${reais[i] === null ? 0 : Math.max(1, ((reais[i] ?? 0) / teto) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="ml-12 flex gap-1 pl-1 pt-1 text-[10.5px] text-foreground/45 sm:gap-2">
          {p.linhas.map((l) => (
            <span key={l.k} className="min-w-0 flex-1 truncate text-center">{l.k}</span>
          ))}
        </div>
        {!algumReal && (
          <p className="mt-2 text-center text-xs text-foreground/40">
            Sem lançamento nesses meses ainda — as barras de real aparecem conforme você lança em Métricas.
          </p>
        )}
      </figure>

      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-foreground/50">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Projeção ESTIMADA a partir do primeiro mês e das metas — não é garantia. Vai em linha reta de um ponto ao seguinte (hoje, mês 1, 6 e 12 meses);
          depois da última meta o valor se mantém. O real vem do que você lança em Métricas. &quot;No caminho&quot; é ficar a menos de 10% do projetado
          (faturamento; na falta dele, vendas ou leads).
          {p.partiuDeZero && ' Onde o ponto A não tem o número, a conta parte de zero.'}
          {p.linhas.some((l) => l.leadsEstimados) && ' Leads com "~" são estimados: investimento ÷ CPL médio (ou vendas ÷ conversão do ponto A).'}
        </span>
      </p>
    </div>
  )
}
