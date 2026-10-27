import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { AvatarCliente } from '@/components/gestaoClientes/AvatarCliente'
import { ListaAlertas, Variacao, quandoFoi } from '@/components/gestaoClientes/AbaTrafego'
import { brl, num, useCarregar, Estado, Painel, Vazio } from '@/components/trafego/format'
import { gcTrafego, type GcLinhaPainel, type GcStatusTrafego } from '@/services/gcTrafego'
import { TIPOS_HISTORICO } from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const STATUS: Record<GcStatusTrafego, { label: string; ponto: string; ordem: number }> = {
  critico: { label: 'Crítico', ponto: 'bg-danger', ordem: 0 },
  atencao: { label: 'Atenção', ponto: 'bg-amber-500', ordem: 1 },
  ok: { label: 'Saudável', ponto: 'bg-emerald-500', ordem: 2 },
  sem_conta: { label: 'Sem conta', ponto: 'bg-foreground/25', ordem: 3 },
}

type Filtro = 'todos' | GcStatusTrafego

const PRIORIDADE_ORDEM: Record<string, number> = { alta: 0, media: 1, baixa: 2 }

/** Ritmo do mês: gasto até hoje contra o previsto proporcional aos dias corridos. */
function RitmoDoMes({ linha }: { linha: GcLinhaPainel }) {
  if (!linha.previstoMes) return <span className="text-xs text-foreground/35">sem previsto</span>
  const gasto = linha.mes?.gasto ?? 0
  const hoje = new Date()
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  const esperado = (linha.previstoMes * hoje.getDate()) / diasNoMes
  const p = Math.min(100, (gasto / linha.previstoMes) * 100)
  const desvio = esperado > 0 ? gasto / esperado : 1
  return (
    <div className="w-28" title={`${brl(gasto)} de ${brl(linha.previstoMes)} previstos (esperado até hoje: ${brl(esperado)})`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevate/[0.08]">
        <div
          className={cn('h-full rounded-full', desvio > 1.15 ? 'bg-danger' : desvio < 0.7 ? 'bg-amber-500' : 'bg-emerald-500')}
          style={{ width: `${p}%` }}
        />
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-foreground/50">{brl(gasto)} / {brl(linha.previstoMes)}</p>
    </div>
  )
}

/**
 * Painel de tráfego da carteira NX Digital: quem está ruim primeiro, com os números da semana
 * contra a anterior, os alertas abertos e o que a equipe registrou nas fichas por último.
 */
export function TrafegoNxPage() {
  const navegar = useNavigate()
  const { dados, erro, carregando, recarregar } = useCarregar(() => gcTrafego.painel(), [])
  const [filtro, setFiltro] = React.useState<Filtro>('todos')
  const [busca, setBusca] = React.useState('')

  const marcarVisto = async (id: string) => {
    try {
      await gcTrafego.marcarVisto(id)
      recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const clientes = dados?.clientes ?? []
  const contagem = (s: GcStatusTrafego) => clientes.filter((c) => c.status === s).length
  const comConta = clientes.filter((c) => c.contas > 0)
  const soma = (k: 'gasto' | 'resultados', campo: 'semana' | 'semanaAnterior') =>
    comConta.reduce((t, c) => t + (c[campo]?.[k] ?? 0), 0)
  const gasto7 = soma('gasto', 'semana')
  const gastoAnt = soma('gasto', 'semanaAnterior')
  const res7 = soma('resultados', 'semana')
  const resAnt = soma('resultados', 'semanaAnterior')

  const visiveis = clientes
    .filter((c) => filtro === 'todos' || c.status === filtro)
    .filter((c) => c.nome.toLowerCase().includes(busca.trim().toLowerCase()))
    .sort((a, b) =>
      STATUS[a.status].ordem - STATUS[b.status].ordem
      || (PRIORIDADE_ORDEM[a.prioridade] ?? 1) - (PRIORIDADE_ORDEM[b.prioridade] ?? 1)
      || (b.semana?.gasto ?? 0) - (a.semana?.gasto ?? 0))

  const rotuloTipo = (t: string) => TIPOS_HISTORICO.find((x) => x.valor === t)?.label ?? t

  return (
    <>
      <TopBar
        compacto
        title="Tráfego"
        subtitle="Clientes NX Digital"
        breadcrumbs={[
          { label: 'Grupo NX Digital', to: '/' },
          { label: 'Clientes NX Digital', to: '/clientesnxdigital/clientes' },
          { label: 'Tráfego' },
        ]}
      />
      <div className="space-y-4 px-4 pb-10 lg:px-6">
        <Estado carregando={carregando && !dados} erro={erro}>
          {dados && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <div className="rounded-xl border border-line bg-card px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Investido na semana</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xl font-semibold tabular-nums">{brl(gasto7)}</span>
                    <Variacao atual={gasto7} anterior={gastoAnt} />
                  </div>
                  <p className="text-xs text-foreground/50">{comConta.length} cliente(s) com conta</p>
                </div>
                <div className="rounded-xl border border-line bg-card px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">Resultados na semana</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xl font-semibold tabular-nums">{num(res7)}</span>
                    <Variacao atual={res7} anterior={resAnt} />
                  </div>
                  <p className="text-xs text-foreground/50">custo médio {brl(res7 > 0 ? gasto7 / res7 : null)}</p>
                </div>
                {(['critico', 'atencao', 'sem_conta'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFiltro(filtro === s ? 'todos' : s)}
                    className={cn('rounded-xl border bg-card px-4 py-3 text-left transition-colors',
                      filtro === s ? 'border-accent' : 'border-line hover:border-foreground/20')}
                  >
                    <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground/50">
                      <span className={cn('h-2 w-2 rounded-full', STATUS[s].ponto)} /> {STATUS[s].label}
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{contagem(s)}</p>
                    <p className="text-xs text-foreground/50">
                      {s === 'sem_conta' ? 'vincular conta na ficha' : 'clique pra filtrar'}
                    </p>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <Painel
                  className="xl:col-span-2"
                  title={`Clientes (${visiveis.length})`}
                  action={
                    <div className="flex items-center gap-2">
                      <select
                        value={filtro}
                        onChange={(e) => setFiltro(e.target.value as Filtro)}
                        className="h-8 rounded-md border border-line bg-surface px-2 text-xs"
                      >
                        <option value="todos">Todos</option>
                        {(Object.keys(STATUS) as GcStatusTrafego[]).map((s) => (
                          <option key={s} value={s}>{STATUS[s].label}</option>
                        ))}
                      </select>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
                        <input
                          value={busca}
                          onChange={(e) => setBusca(e.target.value)}
                          placeholder="Buscar"
                          className="h-8 w-36 rounded-md border border-line bg-surface pl-7 pr-2 text-xs"
                        />
                      </div>
                    </div>
                  }
                >
                  {visiveis.length === 0 ? (
                    <Vazio>Nenhum cliente nesse filtro.</Vazio>
                  ) : (
                    <div className="-mx-4 -my-4 overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead>
                          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-foreground/45">
                            <th className="px-4 py-2 font-medium">Cliente</th>
                            <th className="px-2 py-2 text-right font-medium">Investido 7d</th>
                            <th className="px-2 py-2 text-right font-medium">Resultados 7d</th>
                            <th className="px-2 py-2 text-right font-medium">Custo/result.</th>
                            <th className="px-2 py-2 font-medium">Mês x previsto</th>
                            <th className="px-2 py-2 text-center font-medium" title="Nota da última análise da IA">IA</th>
                            <th className="px-4 py-2 text-right font-medium">Atualizado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visiveis.map((c) => (
                            <tr
                              key={c.id}
                              onClick={() => navegar(`/clientesnxdigital/clientes/${c.id}?aba=trafego`)}
                              className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-elevate/[0.03]"
                            >
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2.5">
                                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS[c.status].ponto)} title={STATUS[c.status].label} />
                                  <AvatarCliente nome={c.nome} logoUrl={c.logoUrl} className="h-8 w-8 rounded-lg text-[11px]" />
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">{c.nome}</p>
                                    <p className="truncate text-xs text-foreground/45">
                                      {c.responsavel ?? 'sem responsável'}
                                      {c.alertas > 0 && ` · ${c.alertas} alerta(s)`}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              {c.contas === 0 ? (
                                <td colSpan={4} className="px-2 py-2.5 text-xs text-foreground/40">
                                  Sem conta de anúncio vinculada — abra o cliente → aba Tráfego → Vincular conta.
                                </td>
                              ) : (
                                <>
                                  <td className="px-2 py-2.5 text-right tabular-nums">
                                    <div>{brl(c.semana?.gasto ?? 0)}</div>
                                    <Variacao atual={c.semana?.gasto ?? 0} anterior={c.semanaAnterior?.gasto ?? null} />
                                  </td>
                                  <td className="px-2 py-2.5 text-right tabular-nums">
                                    <div>{num(c.semana?.resultados ?? 0)}</div>
                                    <Variacao atual={c.semana?.resultados ?? 0} anterior={c.semanaAnterior?.resultados ?? null} />
                                  </td>
                                  <td className="px-2 py-2.5 text-right tabular-nums">
                                    <div>{brl(c.semana?.custoResultado)}</div>
                                    <Variacao atual={c.semana?.custoResultado ?? null} anterior={c.semanaAnterior?.custoResultado ?? null} menorMelhor />
                                  </td>
                                  <td className="px-2 py-2.5"><RitmoDoMes linha={c} /></td>
                                </>
                              )}
                              <td className="px-2 py-2.5 text-center">
                                {c.notaIa == null ? <span className="text-xs text-foreground/30">—</span> : (
                                  <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white',
                                    c.notaIa >= 7 ? 'bg-emerald-500' : c.notaIa >= 5 ? 'bg-amber-500' : 'bg-danger')}>{Math.round(c.notaIa)}</span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right text-xs text-foreground/45">
                                {c.contas ? quandoFoi(c.ultimoSync) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Painel>

                <div className="space-y-4">
                  <Painel title={`Alertas abertos (${dados.alertas.length})`}>
                    <ListaAlertas
                      alertas={dados.alertas}
                      onVisto={(id) => void marcarVisto(id)}
                      mostrarCliente={(a) => (
                        <Link
                          to={`/clientesnxdigital/clientes/${a.gc_cliente_id}?aba=trafego`}
                          className="text-xs font-semibold text-foreground hover:underline"
                        >
                          {a.nome_empresa}
                        </Link>
                      )}
                    />
                  </Painel>
                  <Painel title="Atualizações dos clientes">
                    {dados.atualizacoes.length === 0 ? (
                      <Vazio>Nada registrado ainda.</Vazio>
                    ) : (
                      <ul className="space-y-3">
                        {dados.atualizacoes.map((h) => (
                          <li key={h.id} className="text-sm">
                            <div className="flex items-center gap-1.5 text-xs">
                              <Link to={`/clientesnxdigital/clientes/${h.gc_cliente_id}`} className="font-semibold text-foreground hover:underline">
                                {h.nome_empresa}
                              </Link>
                              <span className="text-foreground/35">·</span>
                              <span className="text-foreground/50">{rotuloTipo(h.tipo)}</span>
                              <span className="ml-auto text-foreground/40">{quandoFoi(h.created_at)}</span>
                            </div>
                            {h.titulo && <p className="mt-0.5 text-foreground/85">{h.titulo}</p>}
                            {h.descricao && <p className="line-clamp-2 text-xs text-foreground/55">{h.descricao}</p>}
                            {h.autor_nome && <p className="text-[11px] text-foreground/40">por {h.autor_nome}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Painel>
                </div>
              </div>
            </>
          )}
        </Estado>
      </div>
    </>
  )
}
