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

  const raio = 56
  const traco = 13
  const circ = 2 * Math.PI * raio
  // Respiro de 3px entre fatias — sem ele, duas cores vizinhas viram uma mancha só.
  const respiro = comValor.length > 1 ? 6 : 0
  let acumulado = 0

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 sm:flex-nowrap sm:justify-start sm:gap-5">
      <svg viewBox="0 0 140 140" className="aspect-square w-[124px] shrink-0 sm:w-[136px]" role="img">
        <circle cx="70" cy="70" r={raio} fill="none" stroke="currentColor" strokeWidth={traco} className="text-elevate/[0.05]" />
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
              strokeWidth={traco}
              strokeLinecap="butt"
              strokeDasharray={`${tamanho} ${circ - tamanho}`}
              strokeDashoffset={offset}
              transform="rotate(-90 70 70)"
              className="transition-[stroke-dasharray] duration-500"
            >
              <title>{`${f.nome}: ${f.rotulo ?? f.valor} (${Math.round(fracao * 100)}%)`}</title>
            </circle>
          )
        })}
        <text x="70" y="68" textAnchor="middle" className="fill-foreground text-[19px] font-bold tracking-tight">
          {total ?? String(soma)}
        </text>
        {rotuloTotal && (
          <text x="70" y="84" textAnchor="middle" className="fill-foreground/35 text-[9px] uppercase tracking-[0.12em]">
            {rotuloTotal}
          </text>
        )}
      </svg>

      {/* Cada linha carrega a própria barrinha: a rosca dá a proporção no olho, a barra deixa
          comparar duas fatias parecidas sem medir ângulo. */}
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {fatias.map((f) => {
          const fracao = soma > 0 ? f.valor / soma : 0
          const zerado = f.valor <= 0
          return (
            <li key={f.nome} className={cn('min-w-0', zerado && 'opacity-45')}>
              <div className="flex items-baseline gap-2 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: f.cor }} />
                <span className="truncate text-foreground/70">{f.nome}</span>
                <span className="ml-auto shrink-0 font-semibold tabular-nums text-foreground">
                  {f.rotulo ?? f.valor}
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-foreground/40">
                  {Math.round(fracao * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevate/[0.06]">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${Math.max(fracao * 100, zerado ? 0 : 2)}%`, backgroundColor: f.cor }}
                />
              </div>
            </li>
          )
        })}
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
  const porcento = meta > 0 ? Math.round((realizado / meta) * 100) : 0
  const valor = String(rotuloRealizado ?? realizado)

  // Arco de 270° (o vão embaixo é onde a leitura começa e termina). Traço fino e raio grande
  // deixam o miolo livre pro número — era ele encostando no arco quando o valor crescia.
  const raio = 52
  const traco = 8
  const comprimento = (2 * Math.PI * raio * 270) / 360
  // O número ocupa o quadrado inscrito no círculo interno; passando de ~8 caracteres ele precisa
  // encolher pra não bater na curva. Medida por caractere mesmo — é previsível e não depende de
  // medir o DOM depois de desenhar.
  const tamanhoDoValor =
    valor.length <= 4 ? 'text-[22px]'
    : valor.length <= 7 ? 'text-[19px]'
    : valor.length <= 10 ? 'text-[16px]'
    : 'text-[14px]'

  return (
    <div className="group rounded-2xl bg-elevate/[0.03] p-3 text-center ring-1 ring-line/60 transition-colors hover:bg-elevate/[0.05]">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground/45">{titulo}</p>

      <div className="relative mx-auto mt-2 aspect-square w-full max-w-[124px]">
        <svg viewBox="0 0 128 128" className="h-full w-full overflow-visible" role="img">
          <g transform="rotate(135 64 64)">
            <circle
              cx="64" cy="64" r={raio} fill="none" stroke="currentColor" strokeWidth={traco} strokeLinecap="round"
              strokeDasharray={`${comprimento} 999`} className="text-elevate/[0.07]"
            />
            {/* Com 0% o traço arredondado deixava um pingo de cor solto no começo do arco —
                parecia sujeira na tela. Sem progresso, nenhum traço. */}
            {fracao > 0 && (
              <circle
                cx="64" cy="64" r={raio} fill="none" stroke={cor} strokeWidth={traco} strokeLinecap="round"
                strokeDasharray={`${comprimento * fracao} 999`}
                className="transition-[stroke-dasharray] duration-700 ease-out"
              />
            )}
          </g>
        </svg>

        {/* O número vai em HTML, não em <text>: assim ele encolhe sozinho quando o valor é grande
            e nunca encosta na curva. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2">
          <span className={cn('font-bold leading-none tracking-tight text-foreground', tamanhoDoValor)}>
            {valor}
          </span>
          <span className={cn(
            'text-[11px] font-semibold tabular-nums',
            meta <= 0 ? 'text-foreground/25' : bateu ? 'text-success' : 'text-foreground/45',
          )}>
            {meta <= 0 ? '—' : `${porcento}%`}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[12px] font-medium text-foreground/55">
        {meta > 0 ? `meta ${rotuloMeta ?? meta}` : 'sem meta definida'}
      </p>
      <p className={cn('text-[11px]', bateu ? 'font-medium text-success' : 'text-foreground/40')}>
        {meta <= 0
          ? 'defina no mês'
          : bateu
            ? 'meta batida'
            : `faltam ${rotuloMeta ? faltamEmTexto(meta - realizado, rotuloMeta) : meta - realizado}`}
      </p>
    </div>
  )
}

/** Formata o que falta no mesmo "sabor" do rótulo da meta (dinheiro ou contagem). */
function faltamEmTexto(resto: number, rotuloMeta: string): string {
  if (!rotuloMeta.includes('R$')) return String(Math.max(resto, 0))
  // Mesma forma curta do rótulo da meta (sem centavos) — "faltam R$ 25.000" lê melhor que
  // "faltam R$ 25.000,00" num espaço desse tamanho.
  return `R$ ${Math.round(Math.max(resto, 0) / 100).toLocaleString('pt-BR')}`
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
