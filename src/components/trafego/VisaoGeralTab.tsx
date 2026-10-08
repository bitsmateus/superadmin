import { TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trafegoService, type PontoSerie, type TotaisTrafego } from '@/services/trafego'
import { Estado, Painel, brl, diaCurto, horas, meses, num, useCarregar, vezes } from '@/components/trafego/format'

interface CardDef {
  label: string
  valor: (t: TotaisTrafego) => number | null
  fmt: (v: number | null) => string
  /** true = quanto menor, melhor (custos). */
  menorMelhor?: boolean
}

const CARDS: CardDef[] = [
  { label: 'Gasto', valor: (t) => t.gasto, fmt: brl },
  { label: 'Leads', valor: (t) => t.leads, fmt: num },
  { label: 'CPL', valor: (t) => t.cpl, fmt: brl, menorMelhor: true },
  { label: 'Agendamentos', valor: (t) => t.agendadas, fmt: num },
  { label: 'Reuniões', valor: (t) => t.reunioes, fmt: num },
  { label: 'Custo por reunião', valor: (t) => t.custoReuniao, fmt: brl, menorMelhor: true },
  { label: 'Vendas', valor: (t) => t.vendas, fmt: num },
  { label: 'CAC', valor: (t) => t.cac, fmt: brl, menorMelhor: true },
  { label: 'MRR novo', valor: (t) => t.mrr, fmt: brl },
  { label: 'ROAS (1º mês)', valor: (t) => t.roas, fmt: vezes },
  { label: 'Payback', valor: (t) => t.paybackMeses, fmt: meses, menorMelhor: true },
]

function Variacao({ atual, anterior, menorMelhor }: { atual: number | null; anterior: number | null; menorMelhor?: boolean }) {
  if (atual == null || anterior == null || anterior === 0) return <span className="text-[11px] text-foreground/30">sem comparação</span>
  const pct = ((atual - anterior) / anterior) * 100
  if (Math.abs(pct) < 0.5) return <span className="text-[11px] text-foreground/40">= período anterior</span>
  const bom = menorMelhor ? pct < 0 : pct > 0
  const Icone = pct > 0 ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', bom ? 'text-emerald-600 dark:text-emerald-400' : 'text-danger')}>
      <Icone className="h-3 w-3" />
      {pct > 0 ? '+' : ''}{pct.toFixed(0)}% vs. período anterior
    </span>
  )
}

/** Barras de gasto por dia com a linha de leads do CRM por cima — SVG puro. */
export function GraficoSerie({ serie }: { serie: PontoSerie[] }) {
  const W = 800, H = 180, PAD = 24
  if (!serie.length) return null
  const maxGasto = Math.max(1, ...serie.map((p) => p.gasto))
  const maxLeads = Math.max(1, ...serie.map((p) => p.leadsCrm))
  const passo = (W - PAD * 2) / serie.length
  const x = (i: number) => PAD + passo * i + passo / 2
  const yGasto = (v: number) => H - PAD - (v / maxGasto) * (H - PAD * 2)
  const yLeads = (v: number) => H - PAD - (v / maxLeads) * (H - PAD * 2)
  const linha = serie.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${yLeads(p.leadsCrm)}`).join(' ')
  const rotulos = serie.length <= 10 ? serie.map((_, i) => i) : [0, Math.floor(serie.length / 2), serie.length - 1]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Gasto e leads por dia">
        {serie.map((p, i) => (
          <rect key={p.dia} x={x(i) - Math.max(1, passo * 0.35)} width={Math.max(2, passo * 0.7)}
            y={yGasto(p.gasto)} height={H - PAD - yGasto(p.gasto)} rx={2} className="fill-accent/40">
            <title>{`${diaCurto(p.dia)} · gasto ${brl(p.gasto)} · ${p.leadsCrm} leads · ${p.reunioes} reuniões`}</title>
          </rect>
        ))}
        <path d={linha} fill="none" strokeWidth={2} className="stroke-emerald-500" />
        {rotulos.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="fill-foreground/40 text-[11px]">{diaCurto(serie[i].dia)}</text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-foreground/50">
        <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-accent/40" />Gasto por dia (máx. {brl(maxGasto)})</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 bg-emerald-500" />Leads no CRM por dia (máx. {maxLeads})</span>
      </div>
    </div>
  )
}

export function VisaoGeralTab({ de, ate, versao }: { de: string; ate: string; versao: number }) {
  const { dados, erro, carregando } = useCarregar(() => trafegoService.resumo(de, ate), [de, ate, versao])
  return (
    <Estado carregando={carregando} erro={erro}>
      {dados && (
        <div className="space-y-4">
          {!dados.configurado && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              A conta do Meta não está configurada no servidor (META_ADS_TOKEN / META_AD_ACCOUNT_ID) — o gasto vem zerado.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {CARDS.map((c) => (
              <div key={c.label} className="rounded-xl border border-line bg-card p-3">
                <p className="text-xs text-foreground/50">{c.label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{c.fmt(c.valor(dados.atual))}</p>
                <Variacao atual={c.valor(dados.atual)} anterior={c.valor(dados.anterior)} menorMelhor={c.menorMelhor} />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-line bg-card p-3">
            <p className="text-xs text-foreground/50">Tempo até o 1º contato do SDR</p>
            <p className="mt-1 text-xl font-semibold text-foreground">{horas(dados.primeiroContato.horasMedia)}</p>
            <p className="text-[11px] text-foreground/40">
              {dados.primeiroContato.comContato} de {dados.primeiroContato.total} leads do Meta já foram tocados
            </p>
          </div>
          <Painel title="Gasto e leads por dia">
            <GraficoSerie serie={dados.serie} />
          </Painel>
          <p className="text-[11px] text-foreground/35">
            Leads, agendamentos, reuniões e vendas contam só leads vindos do Meta que ENTRARAM no período (por safra).
            MRR e implantação vêm da aba Vendas, só de vendas ligadas ao lead de origem. ROAS = (MRR + implantação) ÷ gasto; payback = meses de MRR para pagar o gasto, descontada a implantação.
            Primeiro contato = primeira mudança de status, dia de contato, SDR ou Atualização no lead.
            {dados.ultimaSincronizacao && ` Gasto atualizado em ${new Date(dados.ultimaSincronizacao).toLocaleString('pt-BR')}.`}
          </p>
        </div>
      )}
    </Estado>
  )
}
