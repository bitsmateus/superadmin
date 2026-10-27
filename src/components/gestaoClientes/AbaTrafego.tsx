import * as React from 'react'
import {
  AlertTriangle, ExternalLink, Link2, Loader2, Lightbulb, RefreshCw, Siren, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { brl, num, useCarregar, Estado, Painel, Vazio, diaCurto } from '@/components/trafego/format'
import { PainelIaTrafego } from '@/components/gestaoClientes/IaDoCliente'
import {
  gcTrafego, type GcAlertaTrafego, type GcBenchmark, type GcContaTrafego, type GcNivelAlerta, type GcTotaisTrafego,
} from '@/services/gcTrafego'

/** Data local (YYYY-MM-DD) de n dias atrás. */
function dia(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Periodo = '7' | '14' | '30' | 'mes' | 'mes_passado'
const PERIODOS: { valor: Periodo; label: string }[] = [
  { valor: '7', label: '7 dias' },
  { valor: '14', label: '14 dias' },
  { valor: '30', label: '30 dias' },
  { valor: 'mes', label: 'Este mês' },
  { valor: 'mes_passado', label: 'Mês passado' },
]

function intervalo(p: Periodo): { de: string; ate: string } {
  const hoje = dia(0)
  if (p === 'mes') return { de: `${hoje.slice(0, 8)}01`, ate: hoje }
  if (p === 'mes_passado') {
    const d = new Date()
    const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    const fim = new Date(d.getFullYear(), d.getMonth(), 0)
    const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return { de: f(ini), ate: f(fim) }
  }
  // "7 dias" = os 7 fechados até ontem + hoje parcial ficaria injusto na comparação; usa até ontem.
  return { de: dia(Number(p)), ate: dia(1) }
}

const pct = (v: number | null | undefined, casas = 2) =>
  v == null ? '—' : `${v.toFixed(casas).replace('.', ',')}%`

export function quandoFoi(iso: string | null): string {
  if (!iso) return 'nunca'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.round(h / 24)} dias`
}

export const NIVEL_ALERTA: Record<GcNivelAlerta, { label: string; classe: string; icone: typeof Siren }> = {
  critico: { label: 'Crítico', classe: 'border-danger/30 bg-danger/10 text-danger', icone: Siren },
  atencao: { label: 'Atenção', classe: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400', icone: AlertTriangle },
  oportunidade: { label: 'Oportunidade', classe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', icone: Lightbulb },
}

export function ListaAlertas({ alertas, onVisto, mostrarCliente }: {
  alertas: GcAlertaTrafego[]; onVisto: (id: string) => void; mostrarCliente?: (a: GcAlertaTrafego) => React.ReactNode
}) {
  if (alertas.length === 0) return <Vazio>Nenhum alerta aberto. Tudo dentro do esperado.</Vazio>
  return (
    <ul className="space-y-2">
      {alertas.map((a) => {
        const n = NIVEL_ALERTA[a.nivel]
        return (
          <li key={a.id} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm', n.classe)}>
            <n.icone className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              {mostrarCliente?.(a)}
              <p className="text-foreground/85">{a.mensagem}</p>
              <p className="mt-0.5 text-[11px] text-foreground/45">{n.label} · aberto {quandoFoi(a.created_at)}</p>
            </div>
            <button
              type="button"
              title="Marcar como visto (não reabre por 7 dias)"
              onClick={() => onVisto(a.id)}
              className="rounded p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Variação % entre dois números; `menorMelhor` inverte a cor (custo caindo é bom). */
export function Variacao({ atual, anterior, menorMelhor }: { atual: number | null; anterior: number | null; menorMelhor?: boolean }) {
  if (atual == null || anterior == null || anterior === 0) return null
  const v = (atual - anterior) / anterior
  if (Math.abs(v) < 0.005) return <span className="text-[11px] text-foreground/40">=</span>
  const bom = menorMelhor ? v < 0 : v > 0
  return (
    <span className={cn('text-[11px] font-medium tabular-nums', bom ? 'text-emerald-600 dark:text-emerald-400' : 'text-danger')}>
      {v > 0 ? '▲' : '▼'} {Math.abs(Math.round(v * 100))}%
    </span>
  )
}

function Kpi({ titulo, valor, detalhe, atual, anterior, menorMelhor }: {
  titulo: string; valor: string; detalhe?: string; atual: number | null; anterior: number | null; menorMelhor?: boolean
}) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground">{valor}</span>
        <Variacao atual={atual} anterior={anterior} menorMelhor={menorMelhor} />
      </div>
      {detalhe && <p className="mt-0.5 truncate text-xs text-foreground/50">{detalhe}</p>}
    </div>
  )
}

function Kpis({ atual, anterior, benchmark }: { atual: GcTotaisTrafego; anterior: GcTotaisTrafego; benchmark: GcBenchmark | null }) {
  const bench = benchmark && benchmark.custoResultado != null
    ? ` · segmento: ${brl(benchmark.custoResultado)}`
    : ''
  const partes = [
    atual.leads > 0 && `${num(atual.leads)} leads`,
    atual.conversas > 0 && `${num(atual.conversas)} conversas`,
    atual.compras > 0 && `${num(atual.compras)} compras`,
  ].filter(Boolean).join(' · ')
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi titulo="Investimento" valor={brl(atual.gasto)} atual={atual.gasto} anterior={anterior.gasto} detalhe={`antes: ${brl(anterior.gasto)}`} />
      <Kpi titulo="Resultados" valor={num(atual.resultados)} atual={atual.resultados} anterior={anterior.resultados} detalhe={partes || 'leads + conversas + compras'} />
      <Kpi titulo="Custo por resultado" valor={brl(atual.custoResultado)} atual={atual.custoResultado} anterior={anterior.custoResultado} menorMelhor detalhe={`antes: ${brl(anterior.custoResultado)}${bench}`} />
      <Kpi titulo="CTR (link)" valor={pct(atual.ctr)} atual={atual.ctr} anterior={anterior.ctr} detalhe={`${num(atual.cliques)} cliques`} />
      <Kpi titulo="CPM" valor={brl(atual.cpm)} atual={atual.cpm} anterior={anterior.cpm} menorMelhor detalhe={`${num(atual.impressoes)} impressões`} />
      {atual.roas != null || anterior.roas != null ? (
        <Kpi titulo="ROAS" valor={atual.roas == null ? '—' : `${atual.roas.toFixed(1).replace('.', ',')}x`} atual={atual.roas} anterior={anterior.roas} detalhe={`${brl(atual.valorCompras)} em vendas`} />
      ) : (
        <Kpi titulo="Alcance" valor={num(atual.alcance)} atual={atual.alcance} anterior={anterior.alcance} detalhe="pessoas únicas" />
      )}
    </div>
  )
}

/** Barras de gasto por dia, com os resultados do dia em cima de cada barra. */
function GraficoDiario({ serie }: { serie: { dia: string; gasto: number; resultados: number }[] }) {
  const max = Math.max(1, ...serie.map((s) => s.gasto))
  if (serie.every((s) => s.gasto === 0)) return <Vazio>Sem gasto no período.</Vazio>
  return (
    <div className="flex h-40 items-end gap-[3px] overflow-x-auto">
      {serie.map((s) => (
        <div key={s.dia} className="flex min-w-[14px] flex-1 flex-col items-center gap-1" title={`${diaCurto(s.dia)}: ${brl(s.gasto)} · ${s.resultados} resultado(s)`}>
          <span className="text-[10px] tabular-nums text-foreground/50">{s.resultados || ''}</span>
          <div className="w-full rounded-t bg-accent/70 transition-colors hover:bg-accent" style={{ height: `${Math.max(2, (s.gasto / max) * 110)}px` }} />
          <span className="text-[9px] tabular-nums text-foreground/40">{diaCurto(s.dia).slice(0, 2)}</span>
        </div>
      ))}
    </div>
  )
}

const STATUS_META: Record<string, string> = {
  ACTIVE: 'Ativa', PAUSED: 'Pausada', CAMPAIGN_PAUSED: 'Campanha pausada', ADSET_PAUSED: 'Conjunto pausado',
  ARCHIVED: 'Arquivada', DELETED: 'Excluída', WITH_ISSUES: 'Com problema', DISAPPROVED: 'Reprovado', IN_PROCESS: 'Em análise',
}

function StatusMeta({ status }: { status: string }) {
  const ativo = status === 'ACTIVE'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
      ativo ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-elevate/[0.06] text-foreground/55')}>
      {STATUS_META[status] ?? (status ? status.toLowerCase() : '—')}
    </span>
  )
}

function ModalContas({ aberto, onFechar, clienteId, contas, onMudou }: {
  aberto: boolean; onFechar: () => void; clienteId: string; contas: GcContaTrafego[]; onMudou: () => void
}) {
  const [contaId, setContaId] = React.useState('')
  const [token, setToken] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const vincular = async () => {
    setSalvando(true)
    try {
      const c = await gcTrafego.vincularConta(clienteId, contaId, token)
      toast.success(`Conta "${c.nome || c.ad_account_id}" vinculada. Puxando os últimos 90 dias…`)
      setContaId('')
      setToken('')
      onMudou()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const desvincular = async (c: GcContaTrafego) => {
    if (!window.confirm(`Desvincular a conta ${c.nome || c.ad_account_id}? Os números já coletados continuam.`)) return
    try {
      await gcTrafego.desvincularConta(c.id)
      toast.success('Conta desvinculada')
      onMudou()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Modal open={aberto} onClose={onFechar} title="Contas de anúncio (Meta)" description="De onde vêm os números da aba Tráfego deste cliente.">
      <div className="space-y-4">
        {contas.length > 0 && (
          <ul className="space-y-2">
            {contas.map((c) => (
              <li key={c.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{c.nome || c.ad_account_id}</p>
                  <p className="text-xs text-foreground/50">
                    {c.ad_account_id} · {c.moeda || '—'} · atualizado {quandoFoi(c.ultimo_sync_em)}
                    {c.tem_token ? ' · token próprio' : ''}
                  </p>
                  {c.ultimo_erro && <p className="mt-1 text-xs text-danger">{c.ultimo_erro}</p>}
                </div>
                <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => void desvincular(c)}>
                  Desvincular
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-3 rounded-lg border border-dashed border-line p-3">
          <Input
            label="ID da conta de anúncio"
            placeholder="ex.: 1234567890 (Gerenciador de Anúncios → Configurações da conta)"
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
          />
          <Input
            label="Token de acesso (opcional)"
            hint="Deixe em branco pra usar o token da NX no servidor (o BM da agência precisa ter acesso à conta)."
            type="password"
            autoComplete="new-password"
            name="token-meta"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="flex justify-end">
            <Button loading={salvando} disabled={!contaId.trim()} leftIcon={<Link2 className="h-4 w-4" />} onClick={() => void vincular()}>
              Vincular conta
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** "3.500,00", "3500", "R$ 3.500", "2.000" → número. Vazio → null; texto que não é número → undefined. */
function lerReais(texto: string): number | null | undefined {
  let t = texto.replace(/R\$|\s/g, '')
  if (!t) return null
  // Jeito brasileiro: vírgula é centavo e ponto é milhar ("2.000" = dois mil, não dois reais).
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

const paraEditar = (v: number | null) =>
  v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Verba prevista do mês (fica no serviço Tráfego Meta do cliente) e quanto já foi gasto. É com ela
 * que os alertas de ritmo do painel de Tráfego medem se o mês vai estourar ou sobrar.
 */
function VerbaDoMes({ clienteId, ritmo, onSalvou }: {
  clienteId: string; ritmo: { gastoMes: number; previstoMes: number | null }; onSalvou: () => void
}) {
  const [texto, setTexto] = React.useState(paraEditar(ritmo.previstoMes))
  const [salvando, setSalvando] = React.useState(false)
  React.useEffect(() => setTexto(paraEditar(ritmo.previstoMes)), [ritmo.previstoMes])

  const salvar = async () => {
    const valor = lerReais(texto)
    if (valor === undefined) {
      toast.error('Valor inválido. Use só números, ex.: 3.500,00')
      setTexto(paraEditar(ritmo.previstoMes))
      return
    }
    if (valor === ritmo.previstoMes) return
    setSalvando(true)
    try {
      await gcTrafego.salvarPrevisto(clienteId, valor)
      toast.success(valor == null ? 'Verba prevista removida' : 'Verba prevista salva')
      onSalvou()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const previsto = ritmo.previstoMes
  const hoje = new Date()
  const diasNoMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate()
  const esperado = previsto ? (previsto * hoje.getDate()) / diasNoMes : 0
  const desvio = esperado > 0 ? ritmo.gastoMes / esperado : 1
  const projecao = (ritmo.gastoMes / hoje.getDate()) * diasNoMes

  return (
    <Painel>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full sm:w-56">
          <Input
            label="Verba prevista do mês (R$)"
            inputMode="decimal"
            placeholder="ex.: 3.000,00"
            value={texto}
            disabled={salvando}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => void salvar()}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        </div>
        <div className="min-w-[220px] flex-1">
          {previsto ? (
            <>
              <div className="flex items-baseline justify-between text-xs text-foreground/55">
                <span>Gasto no mês: <strong className="tabular-nums text-foreground">{brl(ritmo.gastoMes)}</strong> de {brl(previsto)}</span>
                <span className="tabular-nums">fecha em ~{brl(projecao)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-elevate/[0.08]">
                <div
                  className={cn('h-full rounded-full', desvio > 1.15 ? 'bg-danger' : desvio < 0.7 ? 'bg-amber-500' : 'bg-emerald-500')}
                  style={{ width: `${Math.min(100, (ritmo.gastoMes / previsto) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-foreground/45">Esperado até hoje: {brl(esperado)}</p>
            </>
          ) : (
            <p className="text-xs text-foreground/50">
              Informe quanto o cliente vai investir por mês no Meta pra receber alerta quando o ritmo de gasto sair do previsto.
            </p>
          )}
        </div>
      </div>
    </Painel>
  )
}

/**
 * Aba Tráfego do cliente NX: números do Meta (gasto, resultados, custo, CTR...), comparação com o
 * período anterior, alertas abertos, campanhas e os criativos que mais receberam verba.
 */
export function AbaTrafego({ clienteId }: { clienteId: string }) {
  const [periodo, setPeriodo] = React.useState<Periodo>('30')
  const { de, ate } = intervalo(periodo)
  const { dados, erro, carregando, recarregar } = useCarregar(() => gcTrafego.doCliente(clienteId, de, ate), [clienteId, de, ate])
  const [contasAbertas, setContasAbertas] = React.useState(false)
  const [sincronizando, setSincronizando] = React.useState(false)

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await gcTrafego.sincronizar(clienteId)
      const falhas = r.resultados.filter((x) => !x.ok)
      if (falhas.length) toast.error(falhas.map((f) => `${f.conta}: ${f.erro}`).join('\n'))
      else toast.success('Números atualizados com a Meta')
      recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSincronizando(false)
    }
  }
  const marcarVisto = async (id: string) => {
    try {
      await gcTrafego.marcarVisto(id)
      recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const contas = dados?.contas ?? []
  const ultimoSync = contas.map((c) => c.ultimo_sync_em).filter(Boolean).sort().pop() ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-elevate/[0.04] p-1">
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              type="button"
              onClick={() => setPeriodo(p.valor)}
              className={cn('rounded-md px-3 py-1 text-xs transition-colors',
                periodo === p.valor ? 'bg-card font-medium text-foreground shadow-sm' : 'text-foreground/55 hover:text-foreground')}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-foreground/45">
          {diaCurto(de)} a {diaCurto(ate)}
          {dados && ` · comparando com ${diaCurto(dados.anterior.de)} a ${diaCurto(dados.anterior.ate)}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {contas.length > 0 && (
            <span className="hidden text-xs text-foreground/45 sm:inline">Meta atualizada {quandoFoi(ultimoSync)}</span>
          )}
          {contas.length > 0 && (
            <Button variant="secondary" size="sm" loading={sincronizando} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void sincronizar()}>
              Atualizar agora
            </Button>
          )}
          <Button variant="ghost" size="sm" leftIcon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setContasAbertas(true)}>
            {contas.length ? `Contas (${contas.length})` : 'Vincular conta'}
          </Button>
        </div>
      </div>

      <Estado carregando={carregando && !dados} erro={erro}>
        {dados && contas.length === 0 ? (
          <Painel>
            <div className="mx-auto max-w-md py-6 text-center">
              <Link2 className="mx-auto h-8 w-8 text-foreground/30" />
              <p className="mt-3 text-sm font-medium text-foreground">Nenhuma conta de anúncio vinculada</p>
              <p className="mt-1 text-sm text-foreground/55">
                Vincule a conta do Meta Ads deste cliente pra ver gasto, resultados, custo e criativos aqui, e
                receber alertas no painel de Tráfego quando algo sair do normal.
              </p>
              <Button className="mt-4" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => setContasAbertas(true)}>
                Vincular conta
              </Button>
            </div>
          </Painel>
        ) : dados ? (
          <>
            {contas.some((c) => c.ultimo_erro) && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
                Erro ao ler a Meta: {contas.find((c) => c.ultimo_erro)?.ultimo_erro}
              </p>
            )}
            {!ultimoSync && !contas.some((c) => c.ultimo_erro) && (
              <p className="flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-foreground/75">
                <Loader2 className="h-4 w-4 animate-spin" /> Puxando o histórico da Meta pela primeira vez. Isso leva alguns minutos; clique em “Atualizar agora” depois.
              </p>
            )}

            <Kpis atual={dados.totais.atual} anterior={dados.totais.anterior} benchmark={dados.benchmark} />
            <VerbaDoMes clienteId={clienteId} ritmo={dados.ritmo} onSalvou={recarregar} />
            {dados.benchmark && dados.benchmark.custoResultado != null && dados.totais.atual.custoResultado != null && (
              <p className="text-xs text-foreground/50">
                Comparando com {dados.benchmark.clientes} outros clientes de <strong>{dados.benchmark.segmento}</strong>: custo por resultado{' '}
                {dados.totais.atual.custoResultado <= dados.benchmark.custoResultado
                  ? <span className="font-medium text-emerald-600 dark:text-emerald-400">{Math.round((1 - dados.totais.atual.custoResultado / dados.benchmark.custoResultado) * 100)}% abaixo da média</span>
                  : <span className="font-medium text-danger">{Math.round((dados.totais.atual.custoResultado / dados.benchmark.custoResultado - 1) * 100)}% acima da média</span>}
                .
              </p>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              <Painel title="Investimento por dia" className="lg:col-span-2">
                <GraficoDiario serie={dados.serie} />
                <p className="mt-2 text-[11px] text-foreground/40">Número em cima da barra = resultados do dia.</p>
              </Painel>
              <Painel title={`Alertas${dados.alertas.length ? ` (${dados.alertas.length})` : ''}`}>
                <ListaAlertas alertas={dados.alertas} onVisto={(id) => void marcarVisto(id)} />
              </Painel>
            </div>

            <PainelIaTrafego clienteId={clienteId} />

            <Painel title="Campanhas no período">
              {dados.campanhas.length === 0 ? (
                <Vazio>Nenhuma campanha gastou no período.</Vazio>
              ) : (
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-foreground/45">
                        <th className="px-4 py-2 font-medium">Campanha</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 text-right font-medium">Investimento</th>
                        <th className="px-2 py-2 text-right font-medium">Resultados</th>
                        <th className="px-2 py-2 text-right font-medium">Custo/result.</th>
                        <th className="px-2 py-2 text-right font-medium">CTR</th>
                        <th className="px-4 py-2 text-right font-medium">Orç./dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.campanhas.map((c) => (
                        <tr key={c.id} className="border-b border-line/60 last:border-0">
                          <td className="max-w-[320px] truncate px-4 py-2 text-foreground" title={c.nome}>{c.nome}</td>
                          <td className="px-2 py-2"><StatusMeta status={c.status} /></td>
                          <td className="px-2 py-2 text-right tabular-nums">{brl(c.gasto)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{num(c.resultados)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{brl(c.custoResultado)}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{pct(c.ctr)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground/60">{brl(c.orcamentoDia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Painel>

            <Painel title="Criativos que mais receberam verba">
              {dados.anuncios.length === 0 ? (
                <Vazio>Nenhum anúncio gastou no período.</Vazio>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {dados.anuncios.map((a) => (
                    <article key={a.id} className="overflow-hidden rounded-lg border border-line">
                      <div className="relative aspect-square bg-elevate/[0.04]">
                        {a.thumbnail ? (
                          <img src={a.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-foreground/35">sem miniatura</div>
                        )}
                        {a.formato && (
                          <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">{a.formato.replace(/_/g, ' ')}</span>
                        )}
                        {a.frequencia != null && a.frequencia >= 3.5 && (
                          <span className="absolute right-2 top-2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium text-white">saturando</span>
                        )}
                      </div>
                      <div className="space-y-1.5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-sm font-medium text-foreground" title={a.nome}>{a.nome}</p>
                          {a.previewUrl && (
                            <a href={a.previewUrl} target="_blank" rel="noreferrer" title="Ver anúncio" className="text-foreground/40 hover:text-foreground">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-foreground/45" title={a.campanha}>{a.campanha}</p>
                        <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs">
                          <dt className="text-foreground/50">Investido</dt><dd className="text-right tabular-nums">{brl(a.gasto)}</dd>
                          <dt className="text-foreground/50">Resultados</dt><dd className="text-right tabular-nums">{num(a.resultados)}</dd>
                          <dt className="text-foreground/50">Custo/result.</dt><dd className="text-right tabular-nums">{brl(a.custoResultado)}</dd>
                          <dt className="text-foreground/50">CTR</dt><dd className="text-right tabular-nums">{pct(a.ctr)}</dd>
                          <dt className="text-foreground/50">Frequência</dt><dd className="text-right tabular-nums">{a.frequencia == null ? '—' : a.frequencia.toFixed(1).replace('.', ',')}</dd>
                        </dl>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Painel>
          </>
        ) : null}
      </Estado>

      <ModalContas
        aberto={contasAbertas}
        onFechar={() => setContasAbertas(false)}
        clienteId={clienteId}
        contas={contas}
        onMudou={recarregar}
      />
    </div>
  )
}
