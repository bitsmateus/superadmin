import * as React from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Monitor, MousePointerClick, Smartphone, Tablet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dataHora, diaCurto, diaSP, duracao, menosDias, pct } from '@/lib/demoStudio/format'
import type { Contagem, FiltroAnalytics, LinhaFunil, OpcoesDeFiltro, ResumoAnalytics, SessaoResumo } from '@/services/demoStudio'

/**
 * Peças das telas de analytics do Demo Studio. Gráficos com div + Tailwind, como o resto do superadmin
 * (ver components/analytics/ConversionFunnel.tsx) — sem biblioteca de chart.
 */

export type Preset = 'hoje' | '7' | '30' | '90' | 'custom'

export function filtroDoPreset(p: Preset, custom?: { from: string; to: string }): { from: string; to: string } {
  const hoje = diaSP()
  if (p === 'custom' && custom) return custom
  if (p === 'hoje') return { from: hoje, to: hoje }
  return { from: menosDias(hoje, Number(p === 'custom' ? 30 : p) - 1), to: hoje }
}

export function usePeriodo(inicial: Preset = '30') {
  const [preset, setPreset] = React.useState<Preset>(inicial)
  const [custom, setCustom] = React.useState(() => filtroDoPreset('30'))
  const periodo = React.useMemo(() => filtroDoPreset(preset, custom), [preset, custom])
  return { preset, setPreset, custom, setCustom, periodo }
}

const selectCls = 'h-9 rounded-lg border border-line bg-transparent px-2 text-sm'

export function BarraDeFiltros({ periodo, demos, opcoes, filtro, onFiltro, esconderDemo }: {
  periodo: ReturnType<typeof usePeriodo>
  demos?: { id: string; name: string }[]
  opcoes?: OpcoesDeFiltro | null
  filtro: Omit<FiltroAnalytics, 'from' | 'to'>
  onFiltro: (f: Omit<FiltroAnalytics, 'from' | 'to'>) => void
  esconderDemo?: boolean
}) {
  const links = (opcoes?.links ?? []).filter((l) => !filtro.demoId || l.demoId === filtro.demoId)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg border border-line p-0.5">
        {([['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['custom', 'Personalizado']] as [Preset, string][]).map(([p, r]) => (
          <button
            key={p}
            type="button"
            onClick={() => periodo.setPreset(p)}
            className={cn('rounded-md px-2.5 py-1.5 text-xs', periodo.preset === p ? 'bg-elevate/[0.08] text-foreground' : 'text-foreground/55 hover:text-foreground/80')}
          >
            {r}
          </button>
        ))}
      </div>
      {periodo.preset === 'custom' && (
        <div className="flex items-center gap-1 text-xs text-foreground/55">
          <input type="date" className={selectCls} value={periodo.custom.from} max={periodo.custom.to} onChange={(e) => e.target.value && periodo.setCustom({ ...periodo.custom, from: e.target.value })} />
          até
          <input type="date" className={selectCls} value={periodo.custom.to} min={periodo.custom.from} onChange={(e) => e.target.value && periodo.setCustom({ ...periodo.custom, to: e.target.value })} />
        </div>
      )}
      {!esconderDemo && demos && (
        <select className={selectCls} value={filtro.demoId ?? ''} onChange={(e) => onFiltro({ ...filtro, demoId: e.target.value || undefined, linkId: undefined })} aria-label="Demo">
          <option value="">Todas as demos</option>
          {demos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {links.length > 0 && (
        <select className={selectCls} value={filtro.linkId ?? ''} onChange={(e) => onFiltro({ ...filtro, linkId: e.target.value || undefined })} aria-label="Link">
          <option value="">Todos os links</option>
          {links.map((l) => <option key={l.id} value={l.id}>{esconderDemo ? l.label : `${l.demoName} · ${l.label}`}</option>)}
        </select>
      )}
      {(opcoes?.vendedores.length ?? 0) > 1 && (
        <select className={selectCls} value={filtro.sellerId ?? ''} onChange={(e) => onFiltro({ ...filtro, sellerId: e.target.value || undefined })} aria-label="Vendedor">
          <option value="">Todos os vendedores</option>
          {opcoes!.vendedores.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      )}
    </div>
  )
}

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-foreground/55">{rotulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{valor}</p>
      {detalhe && <p className="mt-0.5 text-[11px] text-foreground/40">{detalhe}</p>}
    </div>
  )
}

export function CartoesKpi({ r, leads }: { r: ResumoAnalytics; leads: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Cartao rotulo="Views" valor={String(r.views)} detalhe="sessões" />
      <Cartao rotulo="Visitantes únicos" valor={String(r.unicos)} />
      <Cartao rotulo="Taxa de conclusão" valor={pct(r.taxaConclusao)} detalhe={`engajamento médio ${pct(r.engajamentoMedio)}`} />
      <Cartao rotulo="Tempo médio" valor={duracao(r.tempoMedioMs)} detalhe="com a aba visível" />
      <Cartao rotulo="Leads" valor={String(leads)} detalhe={`conversão ${pct(r.conversaoLead)}`} />
      <Cartao rotulo="Cliques no CTA" valor={String(r.cliquesCta)} />
    </div>
  )
}

export function Painel({ titulo, children, className, acao }: { titulo: string; children: React.ReactNode; className?: string; acao?: React.ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface p-4', className)}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        {acao}
      </header>
      {children}
    </section>
  )
}

/** Views por dia: colunas com a contagem no hover. */
export function GraficoDiario({ serie }: { serie: { dia: string; views: number; unicos: number }[] }) {
  const max = Math.max(1, ...serie.map((d) => d.views))
  const rotular = serie.length <= 14 ? 1 : Math.ceil(serie.length / 10)
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]">
        {serie.map((d) => (
          <div key={d.dia} className="group relative flex h-full flex-1 flex-col justify-end" title={`${diaCurto(d.dia)}: ${d.views} views, ${d.unicos} únicos`}>
            <div className="rounded-t bg-accent/80 transition-colors group-hover:bg-accent" style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views ? 3 : 0 }} />
            {!d.views && <div className="h-px bg-line" />}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[10px] text-foreground/40">
        {serie.map((d, i) => (
          <span key={d.dia} className="flex-1 text-center">{i % rotular === 0 ? diaCurto(d.dia) : ''}</span>
        ))}
      </div>
    </div>
  )
}

/** Lista de barras horizontais (dispositivos, canais, demos). */
export function Barras({ itens, rotulo }: { itens: Contagem[]; rotulo?: (chave: string) => React.ReactNode }) {
  const max = Math.max(1, ...itens.map((i) => i.views))
  if (!itens.length) return <p className="text-xs text-foreground/45">Sem dados no período.</p>
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.chave}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="truncate text-foreground/80">{rotulo ? rotulo(i.chave) : i.chave}</span>
            <span className="tabular-nums text-foreground/55">{i.views} · {pct(i.views ? i.concluidas / i.views : 0)} concluíram</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elevate/[0.05]">
            <div className="h-full rounded-full bg-accent/70" style={{ width: `${(i.views / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export const ROTULO_DISPOSITIVO: Record<string, string> = { mobile: 'Celular', tablet: 'Tablet', desktop: 'Computador' }

/** Funil por etapa (§4.5): barras horizontais com % e queda em relação à etapa anterior. */
export function Funil({ linhas }: { linhas: LinhaFunil[] }) {
  if (!linhas.length || !linhas[0].sessoes) return <p className="text-xs text-foreground/45">Nenhuma sessão no período para montar o funil.</p>
  const maiorQueda = Math.max(...linhas.slice(1).map((l) => l.queda))
  return (
    <ol className="space-y-1.5">
      {linhas.map((l) => (
        <li key={l.order} className="grid grid-cols-[2rem_minmax(0,14rem)_1fr_5.5rem] items-center gap-2 text-xs">
          <span className="text-right tabular-nums text-foreground/45">{l.order}</span>
          <span className="truncate text-foreground/80" title={l.title}>{l.title || '(sem título)'}</span>
          <div className="h-5 overflow-hidden rounded bg-elevate/[0.04]">
            <div className="flex h-full items-center rounded bg-accent/70 px-1.5 text-[10px] font-medium text-white" style={{ width: `${Math.max(l.pct * 100, 2)}%` }}>
              {l.pct >= 0.12 && pct(l.pct)}
            </div>
          </div>
          <span className={cn('text-right tabular-nums', l.queda > 0 && l.queda === maiorQueda ? 'font-semibold text-red-500' : 'text-foreground/50')}>
            {l.sessoes} {l.order > 1 && l.queda > 0 ? `· −${pct(l.queda)}` : ''}
          </span>
        </li>
      ))}
    </ol>
  )
}

function IconeDispositivo({ d }: { d: string | null }) {
  const I = d === 'mobile' ? Smartphone : d === 'tablet' ? Tablet : Monitor
  return <I className="h-3.5 w-3.5" aria-label={ROTULO_DISPOSITIVO[d ?? 'desktop']} />
}

/** Lista de sessões (§4.5): quando, quem, link/canal, dispositivo, duração, etapas, concluiu, CTA. */
export function TabelaSessoes({ sessoes, mostrarDemo = true }: { sessoes: SessaoResumo[]; mostrarDemo?: boolean }) {
  if (!sessoes.length) {
    return <p className="py-6 text-center text-sm text-foreground/50">Nenhuma sessão ainda. Compartilhe o link da demo para começar a medir.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-xs">
        <thead className="text-foreground/45">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-medium">Quando</th>
            <th className="py-2 pr-3 font-medium">Quem</th>
            {mostrarDemo && <th className="py-2 pr-3 font-medium">Demo</th>}
            <th className="py-2 pr-3 font-medium">Canal</th>
            <th className="py-2 pr-3 font-medium">Disp.</th>
            <th className="py-2 pr-3 font-medium">Duração</th>
            <th className="py-2 pr-3 font-medium">Etapas</th>
            <th className="py-2 font-medium">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {sessoes.map((s) => (
            <tr key={s.id} className="border-b border-line/60 hover:bg-elevate/[0.03]">
              <td className="py-2 pr-3 tabular-nums">
                <Link to={`/demo-studio/sessoes/${s.id}`} className="text-accent hover:underline">{dataHora(s.startedAt)}</Link>
              </td>
              <td className="py-2 pr-3">{s.lead ? `${s.lead.name ?? 'Lead'}${s.lead.company ? ` · ${s.lead.company}` : ''}` : <span className="text-foreground/45">Anônimo</span>}</td>
              {mostrarDemo && <td className="max-w-[12rem] truncate py-2 pr-3">{s.demo.name}</td>}
              <td className="max-w-[10rem] truncate py-2 pr-3">{s.channel}</td>
              <td className="py-2 pr-3 text-foreground/60"><IconeDispositivo d={s.device} /></td>
              <td className="py-2 pr-3 tabular-nums">{duracao(s.activeMs)}</td>
              <td className="py-2 pr-3 tabular-nums">{s.stepsViewed}/{s.totalSteps || '?'}</td>
              <td className="py-2">
                <span className="inline-flex items-center gap-2">
                  {s.completed && <span className="inline-flex items-center gap-0.5 text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> concluiu</span>}
                  {s.ctaClicked && <span className="inline-flex items-center gap-0.5 text-accent"><MousePointerClick className="h-3.5 w-3.5" /> CTA</span>}
                  {!s.completed && !s.ctaClicked && <span className="text-foreground/40">parou na {s.maxStepOrder || 1}ª</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
