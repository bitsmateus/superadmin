import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, CircleDollarSign, Clock, FileDown, FileText, Flag, History, Info, Loader2,
  ShoppingBag, TrendingUp, Wallet,
} from 'lucide-react'
import { gestaoClientes, HORIZONTES, type GcSnapshot } from '@/services/gestaoClientes'
import { formatarMetrica, mesAtual } from '@/lib/gcMetricas'
import { JornadaPortal } from '@/components/gestaoClientes/JornadaPortal'
import logoNx from '@/assets/logo-nx.jpg'
import { cn } from '@/lib/utils'

type Portal = Awaited<ReturnType<typeof gestaoClientes.portal>>

/** Data e hora em Brasília: "07/10/2026 às 14:30". */
function dataEHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  return `${data} às ${hora}`
}

/** Pega do resumo ou cai pra procurar entre os números (relatório publicado antes do resumo existir). */
function doResumo(s: GcSnapshot, campo: 'investimento' | 'vendas' | 'receita' | 'retorno'): number | null {
  const direto = s.resumo?.[campo]
  if (direto !== undefined) return direto
  const chave = campo === 'retorno' ? 'roas' : campo
  return s.numeros?.find((n) => n.chave === chave)?.valor ?? null
}

/**
 * Variação contra o período anterior. A cor segue o que é BOM pra métrica, não o que é maior: CPL
 * caindo é verde.
 */
function Variacao({
  atual,
  anterior,
  subirEhBom = true,
}: {
  atual: number | null
  anterior?: number | null
  subirEhBom?: boolean
}) {
  if (atual === null || anterior === null || anterior === undefined || anterior === 0) return null
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100
  if (Math.abs(pct) < 0.5) {
    return <span className="mt-1.5 inline-block rounded-full bg-elevate/[0.06] px-2 py-0.5 text-[11px] text-foreground/50">estável</span>
  }
  const bom = pct > 0 === subirEhBom
  return (
    <span
      className={cn(
        'mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        bom ? 'bg-success/12 text-success' : 'bg-warning/15 text-warning',
      )}
    >
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%
      <span className="font-normal opacity-70">vs. mês anterior</span>
    </span>
  )
}

/** Título de seção, no mesmo estilo do PDF: caixa-alta pequena com uma linha por baixo. */
function Secao({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('mt-7', className)}>
      <h3 className="mb-3 border-b border-line pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/50">
        {titulo}
      </h3>
      {children}
    </section>
  )
}

/** Os três números grandes: o que entrou de verba, o que saiu de venda e a receita. */
function Destaques({ snapshot }: { snapshot: GcSnapshot }) {
  const investimento = doResumo(snapshot, 'investimento')
  const vendas = doResumo(snapshot, 'vendas')
  const receita = doResumo(snapshot, 'receita')
  const retorno = doResumo(snapshot, 'retorno')
  const achar = (chave: string) => snapshot.numeros?.find((n) => n.chave === chave)

  const blocos = [
    {
      rotulo: 'Investimento', icone: Wallet, chip: 'bg-accent/12 text-accent',
      valor: formatarMetrica(investimento, 'reais'), ajuda: 'verba aplicada em anúncios',
      anterior: achar('investimento')?.anterior, atual: investimento,
    },
    {
      rotulo: 'Vendas', icone: ShoppingBag, chip: 'bg-success/12 text-success',
      valor: formatarMetrica(vendas, 'inteiro'), ajuda: 'negócios fechados no período',
      obs: 'Conforme informações recebidas e analisadas pela NX.',
      anterior: achar('vendas')?.anterior, atual: vendas,
    },
    {
      rotulo: 'Receita', icone: CircleDollarSign, chip: 'bg-warning/15 text-warning',
      valor: formatarMetrica(receita, 'reais'), ajuda: 'faturamento vindo das campanhas',
      anterior: achar('receita')?.anterior, atual: receita,
    },
  ]

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {blocos.map((b) => (
          <div
            key={b.rotulo}
            className="rounded-2xl border border-line bg-gradient-to-br from-elevate/[0.04] to-transparent p-4 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-foreground/50">{b.rotulo}</p>
              <span className={cn('grid h-8 w-8 place-items-center rounded-xl', b.chip)}>
                <b.icone className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2 text-[28px] font-bold leading-tight tracking-tight tabular-nums text-foreground">{b.valor}</p>
            <p className="text-xs text-foreground/50">{b.ajuda}</p>
            {'obs' in b && b.obs && <p className="mt-1 text-[11px] italic leading-snug text-foreground/45">{b.obs}</p>}
            <Variacao atual={b.atual} anterior={b.anterior} />
          </div>
        ))}
      </div>

      {retorno !== null && retorno > 0 && (
        <p className="mt-3 flex items-center gap-3 rounded-2xl border border-success/25 bg-gradient-to-r from-success/[0.10] to-transparent px-4 py-3 text-sm text-foreground/85">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-success/15 text-success">
            <TrendingUp className="h-4 w-4" />
          </span>
          <span>
            Cada R$ 1,00 investido voltou como{' '}
            <strong className="text-foreground">{formatarMetrica(retorno, 'reais')}</strong> de receita.
          </span>
        </p>
      )}
      {retorno === null && investimento !== null && investimento > 0 && (
        <p className="mt-3 rounded-2xl border border-line bg-elevate/[0.02] px-4 py-3 text-sm text-foreground/60">
          A receita deste período ainda não foi informada — com ela, este relatório mostra o retorno
          por real investido.
        </p>
      )}
    </>
  )
}

function BlocoMetas({ snapshot }: { snapshot: GcSnapshot }) {
  const metas = snapshot.metas ?? []
  if (metas.length === 0) return null
  return (
    <Secao titulo="Metas combinadas">
      <div className="space-y-4">
        {HORIZONTES.map((h) => {
          const doGrupo = metas.filter((m) => (m.horizonte ?? 'mes') === h.valor)
          if (doGrupo.length === 0) return null
          return (
            <div key={h.valor}>
              <p className="mb-1.5 text-xs font-semibold text-foreground/70">{h.label}</p>
              <ul className="space-y-2">
                {doGrupo.map((m, i) => {
                  const pct = m.progresso ?? 0
                  const cor = pct >= 100 ? 'bg-success' : pct >= 50 ? 'bg-accent' : 'bg-warning'
                  return (
                    <li key={i} className="rounded-2xl border border-line p-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{m.label}</span>
                        <span className="text-base font-bold tabular-nums text-foreground">
                          {formatarMetrica(m.atual, m.unidade)}
                          <span className="ml-1 text-xs font-medium text-foreground/50">
                            de {formatarMetrica(m.meta, m.unidade)}
                          </span>
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevate/[0.08]">
                        <div className={cn('h-full rounded-full transition-[width]', cor)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-foreground/50">
                        <span>
                          partida {formatarMetrica(m.base, m.unidade)}
                          {m.prazo ? ` · prazo ${String(m.prazo).slice(0, 10).split('-').reverse().join('/')}` : ''}
                        </span>
                        <span className="font-semibold text-foreground/70">
                          {m.progresso === null || m.progresso === undefined ? '—' : `${m.progresso}% do caminho`}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </Secao>
  )
}

function Relatorio({
  snapshot,
  baixar,
  publicadoEm,
}: {
  snapshot: GcSnapshot
  baixar: () => Promise<void>
  publicadoEm: string | null
}) {
  const [baixando, setBaixando] = React.useState(false)
  // Os três do destaque não repetem na grade de baixo — lá fica o detalhamento.
  const detalhados = (snapshot.numeros ?? []).filter(
    (n) => !['investimento', 'vendas', 'receita', 'roas'].includes(n.chave) && n.valor !== null,
  )

  return (
    <article className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Relatório de</p>
          <h2 className="text-xl font-bold tracking-tight text-foreground">{snapshot.periodo?.rotulo}</h2>
          {publicadoEm && <p className="mt-0.5 text-xs text-foreground/45">publicado em {dataEHora(publicadoEm)}</p>}
        </div>
        <button
          type="button"
          onClick={async () => {
            setBaixando(true)
            try {
              await baixar()
            } finally {
              setBaixando(false)
            }
          }}
          className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium text-foreground/80 shadow-sm transition-colors hover:border-accent/40 hover:text-foreground"
        >
          {baixando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          Baixar PDF
        </button>
      </header>
      <div className="mb-5 mt-4 h-[3px] rounded-full bg-gradient-to-r from-accent via-success to-warning" />

      <Destaques snapshot={snapshot} />

      {detalhados.length > 0 && (
        <Secao titulo="Detalhamento do período">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {detalhados.map((n) => (
              <div key={n.chave} className="rounded-2xl border border-line px-3.5 py-3">
                <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/50">{n.label}</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{formatarMetrica(n.valor, n.unidade)}</p>
                <Variacao atual={n.valor} anterior={n.anterior} subirEhBom={n.subirEhBom} />
              </div>
            ))}
          </div>
        </Secao>
      )}

      <BlocoMetas snapshot={snapshot} />

      {(snapshot.infos ?? []).length > 0 && (
        <Secao titulo="Informações do período">
          <ul className="grid gap-2 sm:grid-cols-2">
            {snapshot.infos!.map((i, k) => (
              <li key={k} className="rounded-2xl border border-line px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{i.titulo}</p>
                {i.valor && <p className="text-lg font-bold tabular-nums text-foreground">{i.valor}</p>}
                {i.observacao && <p className="mt-0.5 text-xs text-foreground/55">{i.observacao}</p>}
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {snapshot.comentario_gestor && (
        <Secao titulo="Leitura do gestor">
          <p className="whitespace-pre-wrap rounded-2xl border border-line border-l-[3px] border-l-accent bg-accent/[0.03] px-4 py-3.5 text-sm leading-relaxed text-foreground/85">
            {snapshot.comentario_gestor}
          </p>
        </Secao>
      )}

      {snapshot.proximos_passos && (
        <Secao titulo="Próximos passos">
          <p className="whitespace-pre-wrap rounded-2xl border border-line border-l-[3px] border-l-foreground/20 bg-elevate/[0.02] px-4 py-3.5 text-sm leading-relaxed text-foreground/85">
            {snapshot.proximos_passos}
          </p>
        </Secao>
      )}

      {(snapshot.estrategias ?? []).length > 0 && (
        <Secao titulo="O que está rodando">
          <ul className="space-y-2">
            {snapshot.estrategias!.map((e, i) => {
              const pct = e.total ? Math.round((e.feitos / e.total) * 100) : 0
              return (
                <li key={i} className="flex items-center gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-foreground/85">{e.nome}</span>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-elevate/[0.08]">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="w-12 text-right text-xs text-foreground/50">
                    {e.feitos}/{e.total}
                  </span>
                </li>
              )
            })}
          </ul>
        </Secao>
      )}
    </article>
  )
}

/**
 * A observação que acompanha o painel (e o PDF): o que está aqui é o que a equipe da NX atualizou por
 * último — a execução do dia a dia pode estar à frente disso.
 */
function AvisoDeAtualizacao({ quando }: { quando: string | null }) {
  return (
    <aside className="flex items-start gap-3 rounded-2xl border border-line bg-surface shadow-sm px-4 py-3.5 text-sm text-foreground/80">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
        <Info className="h-4 w-4" />
      </span>
      <p className="leading-relaxed">
        <strong className="text-foreground">Sobre as informações deste painel.</strong> Elas refletem a última
        atualização feita pela equipe da NX{quando ? ` (${quando})` : ''}. A NX pode estar executando ações que
        ainda não foram registradas aqui — em caso de dúvida, confirme com os seus gestores.
      </p>
    </aside>
  )
}

/**
 * PORTAL DO CLIENTE — /cliente/:token, sem login.
 *
 * Mostra só os relatórios PUBLICADOS, lidos da foto que foi congelada na publicação. A primeira
 * coisa que aparece é o que o cliente quer saber: quanto investiu, quantas vendas saíram e quanto
 * voltou de receita. O desenho segue o do PDF do relatório (mesma ordem, mesmas seções).
 *
 * O cliente não vê jornada interna, custo, margem, semáforo nem o histórico do time: o que chega
 * aqui é o que a NX escolheu publicar. Em todo o painel fica claro QUANDO foi a última atualização e
 * que a equipe pode estar fazendo coisas que ainda não entraram aqui.
 */
type Vista = { tipo: 'inicio' } | { tipo: 'plano' } | { tipo: 'mes'; id: string }
type RelPortal = Portal['relatorios'][number]

function mesAnterior(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(a, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function CartaoDeAcesso({
  titulo, subtitulo, icone: Icone, onClick, desabilitado,
}: {
  titulo: string
  subtitulo: string
  icone: React.ComponentType<{ className?: string }>
  onClick?: () => void
  desabilitado?: boolean
}) {
  return (
    <button
      type="button"
      disabled={desabilitado}
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-3xl border border-line bg-surface p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
    >
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
        <Icone className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-foreground">{titulo}</span>
        <span className="block text-sm text-foreground/55">{subtitulo}</span>
      </span>
      {!desabilitado && <ChevronRight className="h-5 w-5 shrink-0 text-foreground/35" />}
    </button>
  )
}

/** A primeira tela do portal: mês atual, mês anterior (se houver) e o planejamento. */
function TelaInicial({
  atual, anterior, outros, temPlano, onAbrir,
}: {
  atual: RelPortal | null
  anterior: RelPortal | null
  outros: RelPortal[]
  temPlano: boolean
  onAbrir: (v: Vista) => void
}) {
  const rotulo = (r: RelPortal) => r.snapshot?.periodo?.rotulo ?? String(r.periodo_inicio).slice(0, 7)
  return (
    <div className="space-y-3">
      <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">O que você quer ver?</h2>
      <CartaoDeAcesso
        titulo="Relatório do mês atual"
        subtitulo={atual ? rotulo(atual) : 'Ainda não publicado — sai assim que o mês fechar.'}
        icone={FileText}
        desabilitado={!atual}
        onClick={atual ? () => onAbrir({ tipo: 'mes', id: atual.id }) : undefined}
      />
      {anterior && (
        <CartaoDeAcesso
          titulo="Relatório do mês anterior"
          subtitulo={rotulo(anterior)}
          icone={History}
          onClick={() => onAbrir({ tipo: 'mes', id: anterior.id })}
        />
      )}
      {temPlano && (
        <CartaoDeAcesso
          titulo="Planejamento"
          subtitulo="De onde partimos, onde queremos chegar e como estamos indo."
          icone={Flag}
          onClick={() => onAbrir({ tipo: 'plano' })}
        />
      )}
      {outros.length > 0 && (
        <details className="group rounded-3xl border border-line bg-surface shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-foreground">
            Outros meses
            <span className="text-xs font-normal text-foreground/45">{outros.length}</span>
          </summary>
          <ul className="border-t border-line">
            {outros.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onAbrir({ tipo: 'mes', id: r.id })}
                  className="flex w-full items-center justify-between px-5 py-3 text-left text-sm text-foreground/80 hover:text-accent"
                >
                  {rotulo(r)} <ChevronRight className="h-4 w-4 text-foreground/35" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function PortalClientePage() {
  const { token = '' } = useParams<{ token: string }>()
  const [dados, setDados] = React.useState<Portal | null>(null)
  const [erro, setErro] = React.useState('')
  const [carregando, setCarregando] = React.useState(true)
  // Tela inicial: o cliente escolhe o que quer ver. 'mes' = id do relatório aberto.
  const [vista, setVista] = React.useState<{ tipo: 'inicio' } | { tipo: 'plano' } | { tipo: 'mes'; id: string }>({ tipo: 'inicio' })

  React.useEffect(() => {
    gestaoClientes
      .portal(token)
      .then(setDados)
      .catch((err: Error) => setErro(err.message))
      .finally(() => setCarregando(false))
  }, [token])

  const baixarPdf = async (id: string, rotulo: string) => {
    // Mesma base das outras chamadas (ver src/services/api.ts): em produção o front e a API
    // ficam em domínios diferentes, e o caminho relativo bateria no lugar errado.
    const base = import.meta.env.VITE_API_URL ?? ''
    const resposta = await fetch(
      `${base}/api/public/cliente/${encodeURIComponent(token)}/relatorio/${id}/pdf`,
    )
    if (!resposta.ok) return
    const blob = await resposta.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio-${rotulo}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">Link indisponível</h1>
        <p className="max-w-sm text-sm text-foreground/60">
          {erro || 'Esse endereço não está mais válido. Fale com quem te enviou pra receber um novo.'}
        </p>
      </div>
    )
  }

  // A última atualização é a publicação mais recente: é o que a equipe fechou e liberou pra cá.
  const publicacoes = dados.relatorios
    .map((r) => r.publicado_em ?? r.snapshot?.publicado_em ?? null)
    .filter((x): x is string => !!x)
    .sort()
  const ultima = publicacoes.length ? publicacoes[publicacoes.length - 1] : null
  const ultimaTexto = ultima ? dataEHora(ultima) : null
  // Do mais novo pro mais velho: o último é o que abre inteiro, os outros ficam recolhidos.
  const ordenados = [...dados.relatorios].sort((a, b) => String(b.periodo_inicio).localeCompare(String(a.periodo_inicio)))
  const mesDe = (r: { periodo_inicio: string }) => String(r.periodo_inicio).slice(0, 7)
  const mesCorrente = mesAtual()
  const atual = ordenados.find((r) => mesDe(r) === mesCorrente) ?? null
  const anterior = ordenados.find((r) => mesDe(r) === mesAnterior(mesCorrente)) ?? null
  const outros = ordenados.filter((r) => r !== atual && r !== anterior)
  const infoDoCliente = dados.relatorios[0]?.snapshot?.cliente

  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-10"
      style={{ background: 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)' }}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {dados.cliente.logo_url ? (
              <img src={dados.cliente.logo_url} alt="" className="h-14 w-14 rounded-2xl border border-line object-cover shadow-sm" />
            ) : (
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-surface text-base font-bold text-foreground/70 shadow-sm">
                {dados.cliente.nome_empresa.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">
                <img src={logoNx} alt="" className="h-4 w-4 rounded" /> Grupo NX Digital
              </p>
              <h1 className="text-2xl font-bold tracking-tight text-white">{dados.cliente.nome_empresa}</h1>
              <p className="text-xs text-white/60">
                {[dados.cliente.segmento, infoDoCliente?.cidade].filter(Boolean).join(' · ') || 'Relatórios de performance'}
              </p>
            </div>
          </div>
          {ultimaTexto && (
            <div className="rounded-2xl border border-line bg-surface px-4 py-2.5 text-right shadow-sm">
              <p className="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-[0.1em] text-foreground/50">
                <Clock className="h-3 w-3" /> Última atualização
              </p>
              <p className="text-sm font-semibold text-foreground">{ultimaTexto}</p>
            </div>
          )}
        </header>

        <AvisoDeAtualizacao quando={ultimaTexto} />

        {vista.tipo === 'inicio' ? (
          <TelaInicial
            atual={atual}
            anterior={anterior}
            outros={outros}
            temPlano={!!dados.jornada}
            onAbrir={setVista}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setVista({ tipo: 'inicio' })}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-2 text-sm font-medium text-foreground/80 shadow-sm transition-colors hover:border-accent/40"
            >
              <ArrowLeft className="h-4 w-4" /> Voltar ao início
            </button>

            {vista.tipo === 'plano' && dados.jornada && <JornadaPortal jornada={dados.jornada} />}

            {vista.tipo === 'mes' && (() => {
              const r = dados.relatorios.find((x) => x.id === vista.id)
              if (!r) return null
              return (
                <Relatorio
                  snapshot={r.snapshot}
                  publicadoEm={r.publicado_em ?? r.snapshot?.publicado_em ?? null}
                  baixar={() => baixarPdf(r.id, r.snapshot?.periodo?.rotulo ?? String(r.periodo_inicio).slice(0, 7))}
                />
              )
            })()}
          </>
        )}

        <footer className="space-y-1 pb-6 pt-2 text-center text-xs text-white/60">
          <p>Grupo NX Digital · este link é pessoal, não compartilhe.</p>
          {ultimaTexto && <p>Última atualização: {ultimaTexto}</p>}
        </footer>
      </div>
    </div>
  )
}
