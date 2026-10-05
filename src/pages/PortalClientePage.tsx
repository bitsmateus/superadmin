import * as React from 'react'
import { useParams } from 'react-router-dom'
import { FileDown, Loader2 } from 'lucide-react'
import { gestaoClientes, type GcSnapshot } from '@/services/gestaoClientes'
import { formatarMetrica } from '@/lib/gcMetricas'

type Portal = Awaited<ReturnType<typeof gestaoClientes.portal>>

/** Variação contra o período anterior — só quando existe base de comparação. */
function Variacao({ atual, anterior }: { atual: number | null; anterior?: number | null }) {
  if (atual === null || anterior === null || anterior === undefined || anterior === 0) return null
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100
  const subiu = pct >= 0
  return (
    <span className={subiu ? 'text-[11px] text-success' : 'text-[11px] text-danger'}>
      {subiu ? '+' : ''}
      {pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior
    </span>
  )
}

function Relatorio({ snapshot, baixar }: { snapshot: GcSnapshot; baixar: () => Promise<void> }) {
  const [baixando, setBaixando] = React.useState(false)
  return (
    <article className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(snapshot.numeros ?? [])
          .filter((n) => n.valor !== null)
          .map((n) => (
            <div key={n.chave} className="rounded-xl border border-line px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-foreground/45">{n.label}</p>
              <p className="text-xl font-semibold tabular-nums text-foreground">
                {formatarMetrica(n.valor, n.unidade)}
              </p>
              <Variacao atual={n.valor} anterior={n.anterior} />
            </div>
          ))}
      </div>

      {(snapshot.metas ?? []).length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-foreground/45">Metas</h3>
          <ul className="space-y-2">
            {snapshot.metas!.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{m.label}</span>
                  <span className="block text-xs text-foreground/50">
                    de {formatarMetrica(m.base, m.unidade)} para {formatarMetrica(m.meta, m.unidade)}
                  </span>
                </span>
                <span className="text-sm tabular-nums text-foreground/80">
                  {formatarMetrica(m.atual, m.unidade)}
                </span>
                {m.progresso !== null && (
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-elevate/[0.08]">
                      <span
                        className={
                          m.progresso >= 100
                            ? 'block h-full rounded-full bg-success'
                            : 'block h-full rounded-full bg-accent'
                        }
                        style={{ width: `${m.progresso}%` }}
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
        </section>
      )}

      {snapshot.comentario_gestor && (
        <section className="mt-5">
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-foreground/45">
            Comentário do gestor
          </h3>
          <p className="whitespace-pre-wrap text-sm text-foreground/85">{snapshot.comentario_gestor}</p>
        </section>
      )}

      {snapshot.proximos_passos && (
        <section className="mt-5">
          <h3 className="mb-1.5 text-xs uppercase tracking-wide text-foreground/45">Próximos passos</h3>
          <p className="whitespace-pre-wrap text-sm text-foreground/85">{snapshot.proximos_passos}</p>
        </section>
      )}

      {(snapshot.estrategias ?? []).length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-xs uppercase tracking-wide text-foreground/45">Em curso</h3>
          <ul className="space-y-1">
            {snapshot.estrategias!.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-foreground/85">{e.nome}</span>
                <span className="text-xs text-foreground/50">
                  {e.feitos} de {e.total} passos
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

/**
 * PORTAL DO CLIENTE — /cliente/:token, sem login.
 *
 * Mostra só os relatórios PUBLICADOS, lidos da foto que foi congelada na publicação. O cliente não
 * vê jornada interna, custo, margem nem o histórico do time: o que chega aqui é o que a NX
 * escolheu publicar.
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
            <p className="text-xs text-foreground/50">
              Relatórios de performance · Grupo NX Digital
            </p>
          </div>
        </header>

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
