import * as React from 'react'
import { formatarMetrica, metricaUnidade, type GcUnidade } from '@/lib/gcMetricas'
import type { LinhaDaProjecao, SituacaoDoMes } from '@/lib/gcPlanejamento'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { cn } from '@/lib/utils'

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** 'YYYY-MM' → "set/26". */
function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number)
  return `${NOMES_MES[m - 1]}/${String(ano).slice(2)}`
}

/** Um valor "redondo" pro eixo: 4 marcas de 0 até um teto que sobra um pouco. */
function escalaDo(max: number): { teto: number; marcas: number[] } {
  if (!(max > 0)) return { teto: 1, marcas: [0, 1] }
  const bruto = max * 1.1
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)))
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p * 4 >= bruto) ?? potencia * 10
  const marcas: number[] = []
  // Até a primeira marca que COBRE o dado: parar na última marca abaixo dele cortava a linha no topo.
  for (let v = 0; ; v += passo) {
    marcas.push(v)
    if (v >= bruto) break
  }
  return { teto: marcas[marcas.length - 1], marcas }
}

/**
 * Projetado × realizado × desvio de uma métrica, mês a mês.
 *
 * SÃO DUAS FAIXAS, NÃO UM EIXO DUPLO. O valor (projetado e realizado) fica em cima e o desvio — em
 * % do projetado — numa faixa própria embaixo, com o zero marcado, alinhada no mesmo eixo de meses.
 * Pôr o desvio no mesmo gráfico com uma segunda escala faria duas linhas parecerem se cruzar onde
 * não significa nada, e é o erro mais comum em gráfico: a gente lê o cruzamento, não os números.
 *
 * Nada depende só de cor: projetado é tracejado, realizado é cheio com marcadores, desvio é barra
 * com sinal, e a legenda traz os três nomes. As cores vêm de --viz-1/2/3, o conjunto já validado
 * pros dois temas. Quem prefere números tem a tabela logo abaixo (TabelaProjecao).
 */
export function GraficoProjecao({
  linhas,
  chave,
  mostrarDesvio = true,
}: {
  linhas: LinhaDaProjecao[]
  /** A métrica (decide a unidade dos eixos e dos rótulos). */
  chave: string
  /** O portal mostra só projetado × realizado, sem a faixa de desvio. */
  mostrarDesvio?: boolean
}) {
  const unidade: GcUnidade = metricaUnidade(chave)
  const largura = 720
  const margemE = 62
  // Folga à direita pro último rótulo de mês (centralizado no ponto) não ser cortado.
  const margemD = 28
  const alturaValor = 190
  const alturaDesvio = mostrarDesvio ? 88 : 0
  const espaco = mostrarDesvio ? 26 : 0
  const margemT = 12
  const margemB = 26
  const altura = margemT + alturaValor + espaco + alturaDesvio + margemB
  const [sobre, setSobre] = React.useState<number | null>(null)

  if (linhas.length < 2) {
    return <p className="py-8 text-center text-sm text-foreground/45">Sem rota pra desenhar: faltam a data do diagnóstico e pelo menos uma meta.</p>
  }

  const n = linhas.length
  const x = (i: number) => margemE + (n === 1 ? 0 : (i / (n - 1)) * (largura - margemE - margemD))
  const maxValor = Math.max(...linhas.flatMap((l) => [l.projetado, l.realizado ?? 0]))
  const { teto, marcas } = escalaDo(maxValor)
  const yValor = (v: number) => margemT + alturaValor - (v / teto) * alturaValor

  // O desvio é simétrico em torno do zero, com teto de pelo menos 25% pra o eixo não ficar achatado.
  const desvios = linhas.map((l) => l.desvioPct).filter((d): d is number => d !== null)
  const tetoDesvio = Math.max(25, Math.ceil(Math.max(0, ...desvios.map(Math.abs)) / 25) * 25)
  const topoDesvio = margemT + alturaValor + espaco
  const yDesvio = (d: number) => topoDesvio + alturaDesvio / 2 - (Math.max(-tetoDesvio, Math.min(tetoDesvio, d)) / tetoDesvio) * (alturaDesvio / 2)

  const caminho = (pontos: { i: number; v: number }[]) =>
    pontos.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${yValor(p.v).toFixed(1)}`).join(' ')

  const projetado = caminho(linhas.map((l, i) => ({ i, v: l.projetado })))
  // O realizado é interrompido onde não há número: ligar março a maio por cima de abril sem
  // lançamento inventaria um abril que ninguém lançou.
  const trechosRealizado: { i: number; v: number }[][] = []
  let atual: { i: number; v: number }[] = []
  linhas.forEach((l, i) => {
    if (l.realizado === null) {
      if (atual.length) trechosRealizado.push(atual)
      atual = []
    } else atual.push({ i, v: l.realizado })
  })
  if (atual.length) trechosRealizado.push(atual)

  const passoRotulo = n > 9 ? 2 : 1
  const barra = Math.max(6, Math.min(22, ((largura - margemE - margemD) / n) * 0.5))

  return (
    <figure className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-foreground/65">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden><line x1="1" y1="4" x2="25" y2="4" stroke="var(--viz-1)" strokeWidth="2" strokeDasharray="5 3" /></svg>
          Projetado
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden>
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--viz-2)" strokeWidth="2" />
            <circle cx="13" cy="5" r="3.5" fill="var(--viz-2)" stroke="rgb(var(--surface-rgb))" strokeWidth="1.5" />
          </svg>
          Realizado
        </span>
        {mostrarDesvio && (
          <span className="flex items-center gap-1.5">
            <svg width="14" height="10" aria-hidden><rect x="2" y="1" width="10" height="8" rx="1.5" fill="var(--viz-3)" /></svg>
            Desvio (% do projetado)
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${largura} ${altura}`} className="h-auto w-full" role="img" aria-label={`Projetado, realizado e desvio de ${chave}`}>
        {/* grade e eixo do valor */}
        {marcas.map((v) => (
          <g key={v}>
            <line x1={margemE} x2={largura - margemD} y1={yValor(v)} y2={yValor(v)} stroke="currentColor" strokeOpacity="0.08" />
            <text x={margemE - 8} y={yValor(v) + 3.5} textAnchor="end" fontSize="10.5" fill="currentColor" fillOpacity="0.5">
              {formatarMetrica(v, unidade === 'reais' ? 'inteiro' : unidade)}
            </text>
          </g>
        ))}

        <path d={projetado} fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
        {trechosRealizado.map((t, k) => (
          <path key={k} d={caminho(t)} fill="none" stroke="var(--viz-2)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {linhas.map((l, i) =>
          l.realizado === null ? null : (
            <circle key={l.mes} cx={x(i)} cy={yValor(l.realizado)} r={sobre === i ? 5.5 : 4} fill="var(--viz-2)" stroke="rgb(var(--surface-rgb))" strokeWidth="1.5" />
          ),
        )}

        {/* faixa do desvio */}
        {mostrarDesvio && (
          <g>
            {[tetoDesvio, 0, -tetoDesvio].map((d) => (
              <g key={d}>
                <line x1={margemE} x2={largura - margemD} y1={yDesvio(d)} y2={yDesvio(d)} stroke="currentColor" strokeOpacity={d === 0 ? 0.35 : 0.08} />
                <text x={margemE - 8} y={yDesvio(d) + 3.5} textAnchor="end" fontSize="10.5" fill="currentColor" fillOpacity="0.5">
                  {d > 0 ? '+' : ''}{d}%
                </text>
              </g>
            ))}
            {linhas.map((l, i) => {
              if (l.desvioPct === null) return null
              const y0 = yDesvio(0)
              const y1 = yDesvio(l.desvioPct)
              return (
                <rect
                  key={l.mes}
                  x={x(i) - barra / 2}
                  y={Math.min(y0, y1)}
                  width={barra}
                  height={Math.max(2, Math.abs(y1 - y0))}
                  rx="2"
                  fill="var(--viz-3)"
                  fillOpacity={l.desvioPct >= 0 ? 0.95 : 0.55}
                />
              )
            })}
          </g>
        )}

        {/* eixo dos meses + áreas de toque */}
        {linhas.map((l, i) => (
          <g key={l.mes}>
            {i % passoRotulo === 0 && (
              <text x={x(i)} y={altura - 8} textAnchor="middle" fontSize="10.5" fill="currentColor" fillOpacity="0.55">
                {rotuloDoMes(l.mes)}
              </text>
            )}
            <rect
              x={x(i) - (largura - margemE - margemD) / n / 2}
              y={margemT}
              width={(largura - margemE - margemD) / n}
              height={altura - margemT - margemB}
              fill="transparent"
              onMouseEnter={() => setSobre(i)}
              onMouseLeave={() => setSobre(null)}
            >
              <title>
                {`${rotuloDoMes(l.mes)} — projetado ${formatarMetrica(l.projetado, unidade)}` +
                  (l.realizado !== null
                    ? `, realizado ${formatarMetrica(l.realizado, unidade)}` +
                      (l.desvioPct !== null ? ` (${l.desvioPct > 0 ? '+' : ''}${l.desvioPct.toFixed(0)}%)` : '')
                    : ', sem lançamento')}
              </title>
            </rect>
          </g>
        ))}
      </svg>
    </figure>
  )
}

const ROTULO_SITUACAO: Record<SituacaoDoMes, string> = {
  no_caminho: 'No caminho',
  acima: 'Acima',
  abaixo: 'Abaixo',
  sem_lancamento: 'Sem lançamento',
  a_vir: 'A vir',
}

/**
 * A mesma projeção em tabela — o que o gráfico mostra, com os números exatos. "Acima" e "abaixo"
 * levam a cor do que é BOM pra métrica: CPL acima é vermelho, leads acima é verde.
 */
export function TabelaProjecao({ linhas, chave }: { linhas: LinhaDaProjecao[]; chave: string }) {
  const unidade = metricaUnidade(chave)
  if (linhas.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-elevate/[0.02] text-left text-xs uppercase tracking-wide text-foreground/50">
          <tr>
            <th className="px-3 py-2 font-medium">Mês</th>
            <th className="px-3 py-2 text-right font-medium">Projetado</th>
            <th className="px-3 py-2 text-right font-medium">Realizado</th>
            <th className="px-3 py-2 text-right font-medium">Desvio</th>
            <th className="px-3 py-2 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.mes} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2 text-foreground/85">
                {rotuloDoMes(l.mes)}
                {l.k === 0 && <span className="ml-1.5 text-[10px] uppercase text-foreground/40">ponto A</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground/70">
                {formatarMetrica(l.projetado, unidade)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-foreground">
                {l.realizado === null ? '—' : formatarMetrica(l.realizado, unidade)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-right tabular-nums',
                  l.boa === true ? 'text-success' : l.boa === false ? 'text-danger' : 'text-foreground/60',
                )}
              >
                {l.desvio === null
                  ? '—'
                  : `${l.desvio > 0 ? '+' : ''}${formatarMetrica(l.desvio, unidade)}${
                      l.desvioPct !== null ? ` (${l.desvioPct > 0 ? '+' : ''}${l.desvioPct.toFixed(0)}%)` : ''
                    }`}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <PastilhaSaude
                  estado={
                    l.situacao === 'no_caminho'
                      ? 'otimo'
                      : l.situacao === 'sem_lancamento' || l.situacao === 'a_vir'
                        ? 'neutro'
                        : l.boa === false
                          ? 'atencao'
                          : l.boa === true
                            ? 'bom'
                            : 'neutro'
                  }
                  texto={ROTULO_SITUACAO[l.situacao]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
