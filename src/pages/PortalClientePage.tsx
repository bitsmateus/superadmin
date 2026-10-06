import * as React from 'react'
import { useParams } from 'react-router-dom'
import { FileDown, Loader2, TrendingUp } from 'lucide-react'
import { gestaoClientes, HORIZONTES, type GcSnapshot } from '@/services/gestaoClientes'
import { formatarMetrica } from '@/lib/gcMetricas'
import { JornadaPortal } from '@/components/gestaoClientes/JornadaPortal'
import { cn } from '@/lib/utils'

type Portal = Awaited<ReturnType<typeof gestaoClientes.portal>>

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
  if (Math.abs(pct) < 0.5) return <span className="text-[11px] text-foreground/40">estável</span>
  const bom = pct > 0 === subirEhBom
  return (
    <span className={cn('text-[11px] font-medium', bom ? 'text-success' : 'text-danger')}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% vs.
      mês anterior
    </span>
  )
}

/** Os três números grandes: o que entrou de verba, o que saiu de venda. */
function Destaques({ snapshot }: { snapshot: GcSnapshot }) {
  const investimento = doResumo(snapshot, 'investimento')
  const vendas = doResumo(snapshot, 'vendas')
  const receita = doResumo(snapshot, 'receita')
  const retorno = doResumo(snapshot, 'retorno')
  const achar = (chave: string) => snapshot.numeros?.find((n) => n.chave === chave)

  const blocos = [
    {
      rotulo: 'Investimento',
      valor: formatarMetrica(investimento, 'reais'),
      ajuda: 'verba aplicada em anúncios',
      anterior: achar('investimento')?.anterior,
      atual: investimento,
      subirEhBom: true,
    },
    {
      rotulo: 'Vendas',
      valor: formatarMetrica(vendas, 'inteiro'),
      ajuda: 'negócios fechados no período',
      anterior: achar('vendas')?.anterior,
      atual: vendas,
      subirEhBom: true,
    },
    {
      rotulo: 'Receita',
      valor: formatarMetrica(receita, 'reais'),
      ajuda: 'faturamento vindo das campanhas',
      anterior: achar('receita')?.anterior,
      atual: receita,
      subirEhBom: true,
    },
  ]

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {blocos.map((b) => (
          <div key={b.rotulo} className="rounded-xl border border-line bg-elevate/[0.02] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-foreground/45">{b.rotulo}</p>
            <p className="mt-0.5 text-[26px] font-semibold leading-tight tabular-nums text-foreground">
              {b.valor}
            </p>
            <p className="text-[11px] text-foreground/45">{b.ajuda}</p>
            <Variacao atual={b.atual} anterior={b.anterior} subirEhBom={b.subirEhBom} />
          </div>
        ))}
      </div>

      {retorno !== null && retorno > 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl border-l-2 border-success bg-success/[0.05] px-4 py-3 text-sm text-foreground/85">
          <TrendingUp className="h-4 w-4 shrink-0 text-success" />
          Cada R$ 1,00 investido voltou como{' '}
          <strong className="text-foreground">{formatarMetrica(retorno, 'reais')}</strong> de receita.
        </p>
      )}
      {retorno === null && investimento !== null && investimento > 0 && (
        <p className="mt-3 rounded-xl border-l-2 border-line bg-elevate/[0.02] px-4 py-3 text-sm text-foreground/60">
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
    <section className="mt-5">
      <h3 className="mb-2 text-xs uppercase tracking-wide text-foreground/45">Metas combinadas</h3>
      <div className="space-y-3">
        {HORIZONTES.map((h) => {
          const doGrupo = metas.filter((m) => (m.horizonte ?? 'mes') === h.valor)
          if (doGrupo.length === 0) return null
          return (
            <div key={h.valor}>
              <p className="mb-1 text-xs font-medium text-foreground/60">{h.label}</p>
              <ul className="space-y-2">
                {doGrupo.map((m, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{m.label}</span>
                      <span className="block text-xs text-foreground/50">
                        de {formatarMetrica(m.base, m.unidade)} para{' '}
                        {formatarMetrica(m.meta, m.unidade)}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatarMetrica(m.atual, m.unidade)}
                    </span>
                    {m.progresso !== null && m.progresso !== undefined && (
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-elevate/[0.08]">
                          <span
                            className={cn(
                              'block h-full rounded-full',
                              m.progresso >= 100 ? 'bg-success' : 'bg-accent',
                            )}
                            style={{ width: `${Math.max(0, Math.min(100, m.progresso))}%` }}
                          />
                        </span>
                        <span className="w-10 text-right text-xs tabular-nums text-foreground/60">
                          {m.progresso}%
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Relatorio({ snapshot, baixar }: { snapshot: GcSnapshot; baixar: () => Promise<void> }) {
  const [baixando, setBaixando] = React.useState(false)
  // Os três do destaque não repetem na grade de baixo — lá fica o detalhamento.
  const detalhados = (snapshot.numeros ?? []).filter(
    (n) => !['investimento', 'vendas', 'receita', 'roas'].includes(n.chave) && n.valor !== null,
  )

  return (
    <article className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{snapshot.periodo?.rotulo}</h2>
          {snapshot.publicado_em && (
            <p className="text-xs text-foreground/45">
              publicado em {new Date(snapshot.publicado_em).toLocaleDateString('pt-BR')}
            </p>
          )}
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
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-foreground/75 transition-colors hover:border-accent/40 hover:text-foreground"
        >
          {baixando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileDown className="h-3.5 w-3.5" />
          )}
          Baixar PDF
        </button>
      </header>

      <Destaques snapshot={snapshot} />

      {detalhados.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-foreground/45">
            Detalhamento do período
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            {detalhados.map((n) => (
              <div key={n.chave} className="rounded-xl border border-line px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-foreground/45">{n.label}</p>
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {formatarMetrica(n.valor, n.unidade)}
                </p>
                <Variacao atual={n.valor} anterior={n.anterior} subirEhBom={n.subirEhBom} />
              </div>
            ))}
          </div>
        </section>
      )}

      <BlocoMetas snapshot={snapshot} />

      {snapshot.comentario_gestor && (
        <section className="mt-5">
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-foreground/45">
            Leitura do gestor
          </h3>
          <p className="whitespace-pre-wrap rounded-xl border-l-2 border-accent bg-accent/[0.03] px-4 py-3 text-sm text-foreground/85">
            {snapshot.comentario_gestor}
          </p>
        </section>
      )}

      {snapshot.proximos_passos && (
        <section className="mt-4">
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-foreground/45">Próximos passos</h3>
          <p className="whitespace-pre-wrap rounded-xl border-l-2 border-line bg-elevate/[0.02] px-4 py-3 text-sm text-foreground/85">
            {snapshot.proximos_passos}
          </p>
        </section>
      )}

      {(snapshot.estrategias ?? []).length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-foreground/45">
            O que está rodando
          </h3>
          <ul className="space-y-1.5">
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
        </section>
      )}
    </article>
  )
}

/**
 * PORTAL DO CLIENTE — /cliente/:token, sem login.
 *
 * Mostra só os relatórios PUBLICADOS, lidos da foto que foi congelada na publicação. A primeira
 * coisa que aparece é o que o cliente quer saber: quanto investiu, quantas vendas saíram e quanto
 * voltou de receita.
 *
 * O cliente não vê jornada interna, custo, margem, semáforo nem o histórico do time: o que chega
 * aqui é o que a NX escolheu publicar.
 */
export function PortalClientePage() {
  const { token = '' } = useParams<{ token: string }>()
  const [dados, setDados] = React.useState<Portal | null>(null)
  const [erro, setErro] = React.useState('')
  const [carregando, setCarregando] = React.useState(true)

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

  return (
    <div className="min-h-screen bg-elevate/[0.02] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center gap-3">
          {dados.cliente.logo_url ? (
            <img
              src={dados.cliente.logo_url}
              alt=""
              className="h-11 w-11 rounded-xl border border-line object-cover"
            />
          ) : (
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface text-sm font-semibold text-foreground/70">
              {dados.cliente.nome_empresa.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div>
            <h1 className="text-xl font-semibold text-foreground">{dados.cliente.nome_empresa}</h1>
            <p className="text-xs text-foreground/50">Relatórios de performance · Grupo NX Digital</p>
          </div>
        </header>

        {/* "Nossa jornada": só existe se a equipe ligou pra esse cliente. O servidor já tirou
            estratégia e premissas — o que chega aqui é o que pode ser mostrado. */}
        {dados.jornada && <JornadaPortal jornada={dados.jornada} />}

        {dados.relatorios.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-8 text-center">
            <p className="text-sm text-foreground/60">
              Nenhum relatório publicado ainda. Assim que o primeiro mês fechar, ele aparece aqui.
            </p>
          </div>
        ) : (
          dados.relatorios.map((r) => (
            <Relatorio
              key={r.id}
              snapshot={r.snapshot}
              baixar={() =>
                baixarPdf(r.id, r.snapshot?.periodo?.rotulo ?? String(r.periodo_inicio).slice(0, 7))
              }
            />
          ))
        )}

        <footer className="pb-6 text-center text-xs text-foreground/40">
          Grupo NX Digital · este link é pessoal, não compartilhe.
        </footer>
      </div>
    </div>
  )
}
