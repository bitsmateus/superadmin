import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Gráficos do Dashboard Comercial — SVG puro, sem biblioteca.
 *
 * As cores vêm de --viz-1/2/3 (ver index.css): a mesma tríade validada pros dois temas, com
 * contraste e separação garantidos até pra quem não distingue vermelho/verde. Por isso NENHUM
 * gráfico aqui depende só de cor: todo pedaço tem rótulo visível do lado, e a cor só reforça.
 */

/** Um pedaço de gráfico: nome, valor e a cor que identifica a entidade. */
export interface FatiaGrafico {
  nome: string
  valor: number
  cor: string
  /** Texto pronto do valor (R$, %, etc.) — sem isso, mostra o número puro. */
  rotulo?: string
}

/* ------------------------------------------------------------------ rosca (pizza) */

/**
 * Rosca com legenda do lado. Rosca e não torta: o buraco do meio guarda o total, que é a primeira
 * coisa que se procura. Fatias com 2px de respiro entre elas (o anel de fundo aparece no vão) —
 * sem isso duas fatias de cor parecida viram uma só.
 */
export function GraficoRosca({ fatias, total, rotuloTotal, vazio = 'Sem dados no período' }: {
  fatias: FatiaGrafico[]
  /** O número grande no meio. Sem isso, usa a soma das fatias. */
  total?: string
  rotuloTotal?: string
  vazio?: string
}) {
  const soma = fatias.reduce((s, f) => s + f.valor, 0)
  const comValor = fatias.filter((f) => f.valor > 0)

  if (!comValor.length) {
    return <p className="py-8 text-center text-xs text-foreground/35">{vazio}</p>
  }

  const raio = 52
  const circ = 2 * Math.PI * raio
  // 2px de respiro entre fatias, convertidos pro comprimento do traço.
  const respiro = comValor.length > 1 ? 4 : 0
  let acumulado = 0

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] shrink-0" role="img">
        <circle cx="70" cy="70" r={raio} fill="none" stroke="currentColor" strokeWidth="16" className="text-elevate/[0.06]" />
        {comValor.map((f) => {
          const fracao = f.valor / soma
          const tamanho = Math.max(fracao * circ - respiro, 1)
          const offset = circ - acumulado * circ
          acumulado += fracao
          return (
            <circle
              key={f.nome}
              cx="70" cy="70" r={raio}
              fill="none"
              stroke={f.cor}
              strokeWidth="16"
              strokeLinecap="butt"
              strokeDasharray={`${tamanho} ${circ - tamanho}`}
              strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
            >
              <title>{`${f.nome}: ${f.rotulo ?? f.valor} (${Math.round(fracao * 100)}%)`}</title>
            </circle>
          )
        })}
        <text x="70" y="66" textAnchor="middle" className="fill-foreground text-[18px] font-semibold">
          {total ?? String(soma)}
        </text>
        {rotuloTotal && (
          <text x="70" y="82" textAnchor="middle" className="fill-foreground/45 text-[9px] uppercase tracking-wider">
            {rotuloTotal}
          </text>
        )}
      </svg>

      <ul className="min-w-[150px] flex-1 space-y-1.5">
        {fatias.map((f) => (
          <li key={f.nome} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: f.cor }} />
            <span className="truncate text-foreground/70">{f.nome}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums text-foreground">
              {f.rotulo ?? f.valor}
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-foreground/40">
              {soma > 0 ? `${Math.round((f.valor / soma) * 100)}%` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ meta (arco) */

/**
 * Meta: arco de 3/4 de volta com o realizado por cima do alvo. O número que importa é o
 * realizado — a meta vai embaixo, como referência, e o que sobra pra bater fica dito em texto.
 */
export function GraficoMeta({ titulo, realizado, meta, rotuloRealizado, rotuloMeta, cor }: {
  titulo: string
  realizado: number
  meta: number
  rotuloRealizado?: string
  rotuloMeta?: string
  cor: string
}) {
  const fracao = meta > 0 ? Math.min(realizado / meta, 1) : 0
  const bateu = meta > 0 && realizado >= meta
  const raio = 46
  // Arco de 270° começando embaixo à esquerda.
  const comprimento = (2 * Math.PI * raio * 270) / 360

  return (
    <div className="rounded-xl bg-elevate/[0.03] p-3 text-center">
      <p className="truncate text-[11px] font-medium uppercase tracking-wider text-foreground/45">{titulo}</p>
      <svg viewBox="0 0 120 120" className="mx-auto mt-1 h-[108px] w-[108px]" role="img">
        <g transform="rotate(135 60 60)">
          <circle
            cx="60" cy="60" r={raio} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${comprimento} 999`} className="text-elevate/[0.08]"
          />
          <circle
            cx="60" cy="60" r={raio} fill="none" stroke={cor} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${comprimento * fracao} 999`}
          />
        </g>
        <text x="60" y="58" textAnchor="middle" className="fill-foreground text-[17px] font-semibold">
          {rotuloRealizado ?? realizado}
        </text>
        <text x="60" y="74" textAnchor="middle" className="fill-foreground/40 text-[9px]">
          {meta > 0 ? `meta ${rotuloMeta ?? meta}` : 'sem meta'}
        </text>
      </svg>
      <p className={cn('text-[11px] font-medium', bateu ? 'text-success' : 'text-foreground/50')}>
        {meta <= 0
          ? 'defina a meta no mês'
          : bateu
            ? `meta batida (${Math.round((realizado / meta) * 100)}%)`
            : `${Math.round(fracao * 100)}% da meta`}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ funil */

export interface EtapaFunil {
  nome: string
  valor: number
  /** Texto curto explicando a conversão desde a etapa anterior. */
  conversao?: string
}

/**
 * Funil em barras horizontais, cada etapa proporcional à primeira. Barra e não triângulo: largura
 * de trapézio engana o olho (a área cresce com o quadrado), barra compara direto.
 */
export function GraficoFunil({ etapas, cor }: { etapas: EtapaFunil[]; cor: string }) {
  const topo = etapas[0]?.valor ?? 0
  return (
    <div className="space-y-2.5">
      {etapas.map((e, i) => {
        const fracao = topo > 0 ? e.valor / topo : 0
        return (
          <div key={e.nome}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-foreground/70">{e.nome}</span>
              <span className="flex items-baseline gap-2">
                {e.conversao && <span className="text-[11px] text-foreground/40">{e.conversao}</span>}
                <span className="font-semibold tabular-nums text-foreground">{e.valor}</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded bg-elevate/[0.06]">
              <div
                className="h-full rounded transition-[width] duration-500"
                style={{ width: `${Math.max(fracao * 100, e.valor > 0 ? 2 : 0)}%`, backgroundColor: cor, opacity: 1 - i * 0.15 }}
                title={`${e.nome}: ${e.valor} (${Math.round(fracao * 100)}% do topo do funil)`}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ barras simples */

/** Barras horizontais pra comparar poucos valores em dinheiro (MRR x implementação, por SDR…). */
export function GraficoBarras({ itens }: { itens: FatiaGrafico[] }) {
  const maior = Math.max(...itens.map((i) => i.valor), 1)
  if (!itens.some((i) => i.valor > 0)) {
    return <p className="py-6 text-center text-xs text-foreground/35">Sem valores no período</p>
  }
  return (
    <div className="space-y-2.5">
      {itens.map((i) => (
        <div key={i.nome}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-foreground/70">{i.nome}</span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">{i.rotulo ?? i.valor}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded bg-elevate/[0.06]">
            <div
              className="h-full rounded"
              style={{ width: `${Math.max((i.valor / maior) * 100, i.valor > 0 ? 2 : 0)}%`, backgroundColor: i.cor }}
              title={`${i.nome}: ${i.rotulo ?? i.valor}`}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
