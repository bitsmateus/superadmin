import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarCheck, Coins, Handshake, Loader2, Lock, Megaphone, Percent, Receipt, Repeat, Rocket, Target,
  TrendingUp, UserCheck, Users, UserX, Wrench,
} from 'lucide-react'
import { GraficoBarras, GraficoFunil, GraficoMeta, GraficoRosca } from '@/components/comercial/charts'
import { api } from '@/services/api'
import { formatBRLCents } from '@/lib/currency'
import logoNx from '@/assets/logo-nx.jpg'
import { cn } from '@/lib/utils'

interface Relatorio {
  mes: string
  rotuloMes: string
  geradoEm: string
  meses: string[]
  investimentoCents: number
  custosExtrasCents: number
  custoTotalCents: number
  leads: number
  leadsNoCrm: number
  agendamentos: number
  reunioesRealizadas: number
  noShows: number
  vendas: number
  vendasDoFunil: number
  vendasDoCloser?: number
  mrrCents: number
  implCents: number
  receitaCents: number
  receitaProjetadaCents: number
  permanencia: number
  cplCents: number
  cacCents: number
  ticketCents: number
  roas: number
  roi: number
  taxaLeadAgendamento: number
  taxaComparecimento: number
  taxaNoShow: number
  taxaReuniaoVenda: number
  metas: { receitaCents: number; mrrCents: number; implCents: number; vendas: number; leads: number; agendamentos: number }
  porSdr: { nome: string; cor: string; vendas: number; mrrCents: number }[]
  fonteInvestimento?: 'meta' | 'digitado'
  fonteLeads?: 'meta' | 'digitado' | 'crm'
  serie?: { dia: string; gastoCents: number; leadsMeta: number; leadsCrm: number }[]
}

const money = (c: number) => formatBRLCents(Math.round(c))
const soNumero = (c: number) => Math.round(c / 100).toLocaleString('pt-BR')
const compacto = (c: number) => `R$ ${Math.round(c / 100).toLocaleString('pt-BR')}`
const pct = (r: number) => `${(r * 100).toFixed(1).replace('.', ',')}%`

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
/** '2026-09' -> 'Setembro/2026' — no seletor, o id cru não diz nada pra quem recebe o link. */
const rotuloMes = (id: string) => {
  const [y, m] = id.split('-').map(Number)
  return `${MESES[m - 1] ?? id}/${y}`
}

/**
 * Relatório comercial em link público — o mesmo painel do mês que a equipe vê, só pra ler.
 *
 * Quem abre não faz login: o endereço carrega um token, e o servidor só responde se ele bater com
 * o que está guardado. Nada aqui edita nada, e a resposta traz apenas números agregados — nenhum
 * nome de lead, telefone ou valor por cliente sai nesse link.
 *
 * Layout (12/11): faixa de destaque com a receita do mês e o quanto falta pra meta; depois os números em três blocos
 * (Marketing, Comercial, Financeiro), os leads dia a dia, as metas, o funil, as vendas por SDR e pra onde foi o
 * dinheiro. Os números saem do servidor com as mesmas regras do Dashboard Comercial (leads e gasto do Meta,
 * reuniões do CRM do Luis).
 */
export function RelatorioPublicoPage() {
  const { token } = useParams<{ token: string }>()
  const [params, setParams] = useSearchParams()
  const mesPedido = params.get('mes') ?? ''

  const [dados, setDados] = React.useState<Relatorio | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(true)

  React.useEffect(() => {
    let cancelado = false
    setCarregando(true)
    api.get<Relatorio>(`/api/public/relatorio-comercial/${token}${mesPedido ? `?mes=${mesPedido}` : ''}`)
      .then((r) => { if (!cancelado) { setDados(r); setErro(null) } })
      .catch((e) => { if (!cancelado) setErro((e as Error).message) })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [token, mesPedido])

  if (carregando && !dados) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-sm text-foreground/50">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando relatório…
        </span>
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-4">
        <div className="max-w-sm rounded-2xl bg-card p-6 text-center shadow-sm">
          <Lock className="mx-auto h-6 w-6 text-foreground/30" />
          <p className="mt-3 text-sm font-medium text-foreground">Relatório indisponível</p>
          <p className="mt-1 text-xs text-foreground/50">
            {erro ?? 'Esse link não existe mais. Peça um link novo para quem compartilhou.'}
          </p>
        </div>
      </div>
    )
  }

  const d = dados
  const metaReceita = d.metas.receitaCents
  const progresso = metaReceita > 0 ? Math.min(d.receitaCents / metaReceita, 1) : 0
  const bateu = metaReceita > 0 && d.receitaCents >= metaReceita
  const vendasDoCloser = d.vendasDoCloser ?? d.vendasDoFunil
  const fonteLeads = d.fonteLeads === 'meta' ? 'do Meta' : d.fonteLeads === 'digitado' ? 'informados no mês' : 'no CRM'

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg">
      {/* ─────────────── faixa de destaque ─────────────── */}
      <header className="relative overflow-hidden bg-[linear-gradient(135deg,#0b1f4d_0%,#123a8c_55%,#1d5fd6_100%)] text-white">
        {/* brilho decorativo */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl" />

        <div className="relative mx-auto max-w-6xl px-4 pb-8 pt-5 sm:px-6 sm:pb-10 lg:px-10">
          <div className="flex flex-wrap items-center gap-3">
            <img src={logoNx} alt="Grupo NX Digital" className="h-10 w-10 shrink-0 rounded-xl object-cover ring-2 ring-white/20" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">Grupo NX Digital</p>
              <h1 className="truncate text-lg font-semibold sm:text-xl">Relatório comercial</h1>
            </div>
            {d.meses.length > 1 ? (
              <select
                value={d.mes}
                onChange={(e) => setParams(e.target.value ? { mes: e.target.value } : {})}
                aria-label="Mês do relatório"
                className="ml-auto rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white outline-none backdrop-blur hover:bg-white/15 [&>option]:text-black"
              >
                {d.meses.map((m) => <option key={m} value={m}>{rotuloMes(m)}</option>)}
              </select>
            ) : (
              <span className="ml-auto rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium">{d.rotuloMes}</span>
            )}
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/60">Receita de {d.rotuloMes}</p>
              <p className="mt-1 break-words text-4xl font-bold tracking-tight tabular-nums sm:text-5xl lg:text-6xl">{money(d.receitaCents)}</p>
              <p className="mt-1 text-sm text-white/70">
                {money(d.mrrCents)} de MRR novo + {money(d.implCents)} de implementação
              </p>
              {metaReceita > 0 && (
                <div className="mt-5 max-w-xl">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                    <span className="font-medium text-white/80">
                      {bateu ? 'Meta batida' : `${Math.round(progresso * 100)}% da meta de ${money(metaReceita)}`}
                    </span>
                    {!bateu && <span className="text-white/60">faltam {money(metaReceita - d.receitaCents)}</span>}
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
                    <div
                      className={cn('h-full rounded-full transition-[width] duration-700', bateu ? 'bg-emerald-300' : 'bg-white')}
                      style={{ width: `${Math.max(progresso * 100, 2)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2">
              <Destaque rotulo="Vendas" valor={String(d.vendas)} nota={`ticket ${money(d.ticketCents)}`} />
              <Destaque rotulo="MRR novo" valor={money(d.mrrCents)} nota="recorrente" />
              <Destaque rotulo="ROI" valor={pct(d.roi)} nota={`ROAS ${d.roas.toFixed(1).replace('.', ',')}x`} />
              <Destaque rotulo="Investido" valor={money(d.custoTotalCents)} nota={d.fonteInvestimento === 'meta' ? 'Meta Ads' : 'no mês'} />
            </div>
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-4 max-w-6xl space-y-5 px-3 pb-10 sm:px-6 lg:px-10">
        {/* ─────────────── números por área ─────────────── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Bloco titulo="Marketing" icone={<Megaphone className="h-4 w-4" />} tom="azul">
            <Kpi icone={<Coins />} titulo="Investimento" valor={money(d.custoTotalCents)}
              nota={d.custosExtrasCents > 0 ? `${money(d.investimentoCents)} tráfego + ${money(d.custosExtrasCents)} outros` : d.fonteInvestimento === 'meta' ? 'gasto no Meta Ads' : 'tráfego'} />
            <Kpi icone={<Users />} titulo="Leads" valor={d.leads.toLocaleString('pt-BR')} nota={`${fonteLeads} · ${d.leadsNoCrm} no CRM`} />
            <Kpi icone={<Receipt />} titulo="CPL" valor={money(d.cplCents)} nota="custo por lead" />
            <Kpi icone={<Target />} titulo="CAC" valor={money(d.cacCents)} nota="custo por venda do funil" />
          </Bloco>

          <Bloco titulo="Comercial" icone={<Handshake className="h-4 w-4" />} tom="verde">
            <Kpi icone={<CalendarCheck />} titulo="Agendamentos" valor={String(d.agendamentos)} nota={`${pct(d.taxaLeadAgendamento)} dos leads`} />
            <Kpi icone={<UserCheck />} titulo="Realizadas" valor={String(d.reunioesRealizadas)} nota={`${pct(d.taxaComparecimento)} comparecimento`} />
            <Kpi icone={<UserX />} titulo="No-shows" valor={String(d.noShows)} nota={`${pct(d.taxaNoShow)} das reuniões`} tom={d.noShows ? 'ruim' : undefined} />
            <Kpi icone={<Percent />} titulo="Reunião → venda" valor={pct(d.taxaReuniaoVenda)} nota={`${vendasDoCloser} venda(s) de ${d.reunioesRealizadas}`} />
          </Bloco>

          <Bloco titulo="Financeiro" icone={<TrendingUp className="h-4 w-4" />} tom="laranja">
            <Kpi icone={<Repeat />} titulo="MRR novo" valor={money(d.mrrCents)} nota="recorrente conquistado" />
            <Kpi icone={<Wrench />} titulo="Implementação" valor={money(d.implCents)} nota="cobrança única" />
            <Kpi icone={<Coins />} titulo="Ticket médio" valor={money(d.ticketCents)} nota="por venda" />
            <Kpi icone={<Rocket />} titulo="Receita projetada" valor={money(d.receitaProjetadaCents)}
              nota={d.permanencia > 0 ? `${d.permanencia} meses de permanência` : 'defina a permanência'} />
          </Bloco>
        </div>

        {/* ─────────────── leads dia a dia ─────────────── */}
        {d.serie && d.serie.length > 0 && (
          <Secao titulo="Leads por dia" extra={<span>passe o mouse nas barras pra ver o gasto e o CPL do dia</span>}>
            <LeadsPorDia serie={d.serie} usarMeta={d.fonteLeads === 'meta'} />
          </Secao>
        )}

        {/* ─────────────── metas ─────────────── */}
        <Secao
          titulo={`Metas de ${d.rotuloMes}`}
          extra={metaReceita > 0 ? (
            <span>
              {money(d.receitaCents)} de {money(metaReceita)}
              {bateu ? ' — meta batida' : ` — faltam ${money(metaReceita - d.receitaCents)}`}
            </span>
          ) : undefined}
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <GraficoMeta titulo="Receita total" realizado={d.receitaCents} meta={d.metas.receitaCents}
              rotuloRealizado={soNumero(d.receitaCents)} rotuloMeta={compacto(d.metas.receitaCents)} cor="var(--viz-2)" />
            <GraficoMeta titulo="MRR novo" realizado={d.mrrCents} meta={d.metas.mrrCents}
              rotuloRealizado={soNumero(d.mrrCents)} rotuloMeta={compacto(d.metas.mrrCents)} cor="var(--viz-1)" />
            <GraficoMeta titulo="Implementação" realizado={d.implCents} meta={d.metas.implCents}
              rotuloRealizado={soNumero(d.implCents)} rotuloMeta={compacto(d.metas.implCents)} cor="var(--viz-3)" />
            <GraficoMeta titulo="Vendas" realizado={d.vendas} meta={d.metas.vendas} cor="var(--viz-2)" />
            <GraficoMeta titulo="Leads" realizado={d.leads} meta={d.metas.leads} cor="var(--viz-1)" />
            <GraficoMeta titulo="Agendamentos" realizado={d.agendamentos} meta={d.metas.agendamentos} cor="var(--viz-3)" />
          </div>
        </Secao>

        {/* ─────────────── funil + por SDR ─────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <Secao titulo="Funil de vendas">
            <GraficoFunil
              cor="var(--viz-1)"
              etapas={[
                { nome: 'Leads', valor: d.leads },
                { nome: 'Reuniões agendadas', valor: d.agendamentos, conversao: pct(d.taxaLeadAgendamento) },
                { nome: 'Reuniões realizadas', valor: d.reunioesRealizadas, conversao: pct(d.taxaComparecimento) },
                { nome: 'Vendas', valor: vendasDoCloser, conversao: pct(d.taxaReuniaoVenda) },
              ]}
            />
            <p className="mt-3 border-t border-line pt-2 text-[11px] leading-relaxed text-foreground/45">
              Reuniões realizadas, no-shows e vendas são as do CRM do closer no mês. Os {d.noShows} no-shows ficam fora das
              reuniões realizadas.
            </p>
          </Secao>

          <Secao titulo="Vendas por SDR">
            <GraficoRosca
              total={String(d.vendas)}
              rotuloTotal="vendas"
              vazio="Nenhuma venda registrada neste mês"
              fatias={d.porSdr.map((s) => ({ nome: s.nome, valor: s.vendas, cor: s.cor, rotulo: String(s.vendas) }))}
            />
          </Secao>
        </div>

        {/* ─────────────── dinheiro ─────────────── */}
        <Secao titulo="Pra onde foi o dinheiro">
          <GraficoBarras
            itens={[
              { nome: 'MRR novo (recorrente)', valor: d.mrrCents, cor: 'var(--viz-1)', rotulo: money(d.mrrCents) },
              { nome: 'Implementação (uma vez)', valor: d.implCents, cor: 'var(--viz-2)', rotulo: money(d.implCents) },
              { nome: 'Investimento + custos', valor: d.custoTotalCents, cor: 'var(--viz-3)', rotulo: money(d.custoTotalCents) },
            ]}
          />
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            <Mini titulo="Entrou" valor={money(d.receitaCents)} />
            <Mini titulo="Projetado" valor={money(d.receitaProjetadaCents)} />
            <Mini titulo="ROI" valor={pct(d.roi)} tom={d.roi >= 0 ? 'bom' : 'ruim'} />
          </div>
        </Secao>

        <p className="pt-2 text-center text-[11px] text-foreground/35">
          Gerado em {new Date(d.geradoEm).toLocaleString('pt-BR')} · somente leitura · Grupo NX Digital
        </p>
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────── peças ─────────────────────────────────────────── */

function Destaque({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
      <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/60">{rotulo}</p>
      <p className="mt-1 truncate text-xl font-bold tabular-nums">{valor}</p>
      <p className="truncate text-[11px] text-white/55">{nota}</p>
    </div>
  )
}

const TONS = {
  azul: 'bg-[var(--viz-1)]',
  verde: 'bg-[var(--viz-2)]',
  laranja: 'bg-[var(--viz-3)]',
} as const

function Bloco({ titulo, icone, tom, children }: { titulo: string; icone: React.ReactNode; tom: keyof typeof TONS; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-line">
      <div className={cn('h-1', TONS[tom])} />
      <div className="p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-elevate/[0.06] text-foreground/70">{icone}</span>
          {titulo}
        </h2>
        <div className="grid grid-cols-2 gap-2.5">{children}</div>
      </div>
    </section>
  )
}

function Kpi({ icone, titulo, valor, nota, tom }: { icone: React.ReactElement; titulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="min-w-0 rounded-xl bg-elevate/[0.035] p-3">
      <div className="flex items-center gap-1.5 text-foreground/45">
        {React.cloneElement(icone, { className: 'h-3.5 w-3.5 shrink-0' })}
        <p className="truncate text-[10px] font-medium uppercase tracking-wider">{titulo}</p>
      </div>
      <p className={cn(
        'mt-1.5 truncate text-xl font-bold tabular-nums tracking-tight',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
      {nota && <p className="truncate text-[10px] text-foreground/45" title={nota}>{nota}</p>}
    </div>
  )
}

function Secao({ titulo, extra, children }: { titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line sm:p-5">
      <h2 className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-foreground">
        {titulo}
        {extra && <span className="ml-auto text-xs font-normal text-foreground/45">{extra}</span>}
      </h2>
      {children}
    </section>
  )
}

function Mini({ titulo, valor, tom }: { titulo: string; valor: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-foreground/40">{titulo}</p>
      <p className={cn(
        'break-words text-base font-bold tabular-nums',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
    </div>
  )
}

/**
 * Leads por dia: uma série só (os leads do Meta; sem integração, os que entraram no CRM), barras finas com topo
 * arredondado e 2px de respiro, grade recessiva e um só eixo. O gasto do dia NÃO vira segundo eixo — aparece no
 * tooltip, junto com o CPL do dia.
 */
function LeadsPorDia({ serie, usarMeta }: { serie: NonNullable<Relatorio['serie']>; usarMeta: boolean }) {
  const [foco, setFoco] = React.useState<number | null>(null)
  const valores = serie.map((p) => (usarMeta ? p.leadsMeta : p.leadsCrm))
  const max = Math.max(1, ...valores)
  // Topo da escala num número redondo, pra grade cair em valores legíveis.
  const passo = max <= 5 ? 1 : max <= 20 ? 5 : max <= 50 ? 10 : Math.ceil(max / 50) * 10
  const topo = Math.ceil(max / passo) * passo
  const linhas = Array.from({ length: Math.floor(topo / passo) + 1 }, (_, i) => i * passo)
  const total = valores.reduce((s, v) => s + v, 0)
  const melhor = valores.indexOf(Math.max(...valores))
  const p = foco !== null ? serie[foco] : null
  const valorFoco = foco !== null ? valores[foco] : 0

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs text-foreground/55">
        <span><b className="text-base font-bold tabular-nums text-foreground">{total.toLocaleString('pt-BR')}</b> leads no mês</span>
        <span>média de <b className="font-semibold tabular-nums text-foreground/80">{(total / Math.max(1, serie.length)).toFixed(1).replace('.', ',')}</b> por dia</span>
        {valores[melhor] > 0 && (
          <span>melhor dia: <b className="font-semibold text-foreground/80">{serie[melhor].dia.slice(8, 10)}/{serie[melhor].dia.slice(5, 7)}</b> ({valores[melhor]})</span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--viz-1)]" /> {usarMeta ? 'leads do Meta' : 'leads no CRM'}
        </span>
      </div>

      <div className="relative">
        {/* tooltip */}
        {p && (
          <div
            className="pointer-events-none absolute -top-2 z-10 rounded-lg border border-line bg-card px-3 py-2 text-xs shadow-lg"
            // Perto das bordas o balão encosta do lado de dentro, pra não sair do gráfico.
            style={{
              left: `${((foco! + 0.5) / serie.length) * 100}%`,
              transform: `translate(${foco! < serie.length * 0.15 ? '-10%' : foco! > serie.length * 0.85 ? '-90%' : '-50%'}, -100%)`,
            }}
          >
            <p className="font-semibold text-foreground">{p.dia.slice(8, 10)}/{p.dia.slice(5, 7)}</p>
            <p className="whitespace-nowrap text-foreground/70"><b className="tabular-nums text-foreground">{valorFoco}</b> lead(s)</p>
            {p.gastoCents > 0 && (
              <>
                <p className="whitespace-nowrap text-foreground/70">gasto <b className="tabular-nums text-foreground">{money(p.gastoCents)}</b></p>
                <p className="whitespace-nowrap text-foreground/70">CPL <b className="tabular-nums text-foreground">{valorFoco > 0 ? money(p.gastoCents / valorFoco) : '—'}</b></p>
              </>
            )}
            {usarMeta && <p className="whitespace-nowrap text-foreground/45">{p.leadsCrm} no CRM</p>}
          </div>
        )}

        <div className="flex h-48 gap-[2px] sm:h-56">
          {/* eixo */}
          <div className="relative -mr-1 w-7 shrink-0 text-[10px] tabular-nums text-foreground/35">
            {linhas.map((v) => (
              <span key={v} className="absolute right-1 -translate-y-1/2" style={{ bottom: `${(v / topo) * 100}%`, transform: 'translateY(50%)' }}>{v}</span>
            ))}
          </div>
          <div className="relative flex min-w-0 flex-1 items-end gap-[2px]" onMouseLeave={() => setFoco(null)}>
            {/* grade recessiva */}
            {linhas.map((v) => (
              <div key={v} className="pointer-events-none absolute inset-x-0 border-t" style={{ bottom: `${(v / topo) * 100}%`, borderColor: 'var(--line)' }} />
            ))}
            {serie.map((ponto, i) => {
              const v = valores[i]
              return (
                <button
                  key={ponto.dia}
                  type="button"
                  aria-label={`${ponto.dia.slice(8, 10)}/${ponto.dia.slice(5, 7)}: ${v} lead(s)`}
                  onMouseEnter={() => setFoco(i)}
                  onFocus={() => setFoco(i)}
                  onBlur={() => setFoco(null)}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                >
                  <span
                    className={cn(
                      'block w-full max-w-[22px] rounded-t-[4px] bg-[var(--viz-1)] transition-opacity',
                      foco !== null && foco !== i && 'opacity-40',
                    )}
                    style={{ height: v > 0 ? `max(${(v / topo) * 100}%, 3px)` : '0px' }}
                  />
                </button>
              )
            })}
          </div>
        </div>
        {/* dias */}
        <div className="ml-7 mt-1.5 flex gap-[2px] text-[10px] tabular-nums text-foreground/35">
          {serie.map((ponto, i) => (
            <span key={ponto.dia} className="min-w-0 flex-1 text-center">
              {i === 0 || (i + 1) % 5 === 0 ? ponto.dia.slice(8, 10) : ''}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
