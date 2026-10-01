import * as React from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
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
}

const money = (c: number) => formatBRLCents(Math.round(c))
const soNumero = (c: number) => Math.round(c / 100).toLocaleString('pt-BR')
const compacto = (c: number) => `R$ ${Math.round(c / 100).toLocaleString('pt-BR')}`
const pct = (r: number) => `${(r * 100).toFixed(1)}%`

/**
 * Relatório comercial em link público — o mesmo painel do mês que a equipe vê, só pra ler.
 *
 * Quem abre não faz login: o endereço carrega um token, e o servidor só responde se ele bater com
 * o que está guardado. Nada aqui edita nada, e a resposta traz apenas números agregados — nenhum
 * nome de lead, telefone ou valor por cliente sai nesse link.
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

  return (
    <div className="min-h-screen bg-bg px-4 py-6 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-4">
        {/* cabeçalho */}
        <header className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-sm">
          <img src={logoNx} alt="Grupo NX Digital" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">Relatório comercial</h1>
            <p className="text-xs text-foreground/50">Grupo NX Digital · {d.rotuloMes}</p>
          </div>
          {d.meses.length > 1 && (
            <select
              value={d.mes}
              onChange={(e) => setParams(e.target.value ? { mes: e.target.value } : {})}
              className="ml-auto rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground outline-none"
            >
              {d.meses.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
        </header>

        {/* resultado do mês */}
        <section className="rounded-2xl bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Resultado de {d.rotuloMes}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            <Kpi titulo="Investimento" valor={money(d.custoTotalCents)}
              nota={d.custosExtrasCents > 0 ? `${money(d.investimentoCents)} tráfego + ${money(d.custosExtrasCents)} outros` : 'tráfego'} />
            <Kpi titulo="CPL" valor={money(d.cplCents)} nota="custo por lead" />
            <Kpi titulo="CAC" valor={money(d.cacCents)} nota="custo por venda do funil" />
            <Kpi titulo="ROI / ROAS" valor={pct(d.roi)} nota={`ROAS ${d.roas.toFixed(1)}x`} tom={d.roi >= 0 ? 'bom' : 'ruim'} />
            <Kpi titulo="Total de leads" valor={String(d.leads)} nota={`${d.leadsNoCrm} no CRM`} />
            <Kpi titulo="Agendamentos" valor={String(d.agendamentos)} nota={`${pct(d.taxaLeadAgendamento)} dos leads`} />
            <Kpi titulo="Vendas" valor={String(d.vendas)} nota={`${d.vendasDoFunil} pelo funil`} tom="bom" />
            <Kpi titulo="Reuniões realizadas" valor={String(d.reunioesRealizadas)} nota={`${pct(d.taxaComparecimento)} de comparecimento`} />
            <Kpi titulo="No-shows" valor={String(d.noShows)} nota={pct(d.taxaNoShow)} tom={d.noShows ? 'ruim' : undefined} />
            <Kpi titulo="Reunião → venda" valor={pct(d.taxaReuniaoVenda)} nota="fechamento" />
            <Kpi titulo="Receita do mês" valor={money(d.receitaCents)} nota="MRR + implementação" tom="bom" />
            <Kpi titulo="MRR novo" valor={money(d.mrrCents)} nota="recorrente conquistado" />
            <Kpi titulo="Ticket médio" valor={money(d.ticketCents)} nota="por venda" />
            <Kpi titulo="Receita projetada" valor={money(d.receitaProjetadaCents)}
              nota={d.permanencia > 0 ? `${d.permanencia} meses de permanência` : '—'} />
          </div>
        </section>

        {/* metas */}
        <section className="rounded-2xl bg-card p-4 shadow-sm">
          <h2 className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            Metas de {d.rotuloMes}
            {d.metas.receitaCents > 0 && (
              <span className="ml-auto text-xs font-normal text-foreground/45">
                {money(d.receitaCents)} de {money(d.metas.receitaCents)}
                {d.receitaCents < d.metas.receitaCents
                  ? ` — faltam ${money(d.metas.receitaCents - d.receitaCents)}`
                  : ' — meta batida'}
              </span>
            )}
          </h2>
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
        </section>

        {/* funil + por SDR */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Funil de vendas</h2>
            <GraficoFunil
              cor="var(--viz-1)"
              etapas={[
                { nome: 'Leads', valor: d.leads },
                { nome: 'Reuniões agendadas', valor: d.agendamentos, conversao: pct(d.taxaLeadAgendamento) },
                { nome: 'Reuniões realizadas', valor: d.reunioesRealizadas, conversao: pct(d.taxaComparecimento) },
                { nome: 'Vendas', valor: d.vendasDoFunil, conversao: pct(d.taxaReuniaoVenda) },
              ]}
            />
            <p className="mt-3 border-t border-line/60 pt-2 text-[11px] text-foreground/45">
              De cada 100 leads, {Math.round((d.leads > 0 ? d.vendasDoFunil / d.leads : 0) * 100)} viram venda pelo funil.
              Os {d.noShows} no-shows ficam fora das reuniões realizadas.
            </p>
          </section>

          <section className="rounded-2xl bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Vendas por SDR</h2>
            <GraficoRosca
              total={String(d.vendas)}
              rotuloTotal="vendas"
              vazio="Nenhuma venda registrada neste mês"
              fatias={d.porSdr.map((s) => ({ nome: s.nome, valor: s.vendas, cor: s.cor, rotulo: String(s.vendas) }))}
            />
          </section>
        </div>

        {/* receita */}
        <section className="rounded-2xl bg-card p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Receita do mês</h2>
          <GraficoBarras
            itens={[
              { nome: 'MRR novo (recorrente)', valor: d.mrrCents, cor: 'var(--viz-1)', rotulo: money(d.mrrCents) },
              { nome: 'Implementação (uma vez)', valor: d.implCents, cor: 'var(--viz-2)', rotulo: money(d.implCents) },
              { nome: 'Investimento + custos', valor: d.custoTotalCents, cor: 'var(--viz-3)', rotulo: money(d.custoTotalCents) },
            ]}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line/60 pt-3 text-center">
            <Mini titulo="Entrou" valor={money(d.receitaCents)} />
            <Mini titulo="Projetado" valor={money(d.receitaProjetadaCents)} />
            <Mini titulo="ROI" valor={pct(d.roi)} tom={d.roi >= 0 ? 'bom' : 'ruim'} />
          </div>
        </section>

        <p className="pb-6 text-center text-[11px] text-foreground/35">
          Gerado em {new Date(d.geradoEm).toLocaleString('pt-BR')} · somente leitura
        </p>
      </div>
    </div>
  )
}

function Kpi({ titulo, valor, nota, tom }: { titulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="rounded-xl bg-elevate/[0.03] p-3">
      <p className="truncate text-[10px] font-medium uppercase tracking-wider text-foreground/45">{titulo}</p>
      <p className={cn(
        'mt-1 truncate text-lg font-semibold tabular-nums',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
      {nota && <p className="truncate text-[10px] text-foreground/40">{nota}</p>}
    </div>
  )
}

function Mini({ titulo, valor, tom }: { titulo: string; valor: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-foreground/40">{titulo}</p>
      <p className={cn(
        'text-sm font-semibold tabular-nums',
        tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground',
      )}>
        {valor}
      </p>
    </div>
  )
}
