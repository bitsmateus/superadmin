import * as React from 'react'
import { Clapperboard, Image as ImageIcon, Send, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { Painel, Vazio } from '@/components/trafego/format'
import { BotaoCopiar } from '@/components/gestaoClientes/TextoIa'
import { gestaoClientes } from '@/services/gestaoClientes'
import { gcIa, type GcAnaliseIa, type GcAnaliseTrafegoIa, type GcIdeiasConteudoIa } from '@/services/gcTrafego'

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Carrega a última análise do tipo e gera uma nova sob demanda. */
function useAnalise<T>(clienteId: string, tipo: 'trafego' | 'conteudo') {
  const [analise, setAnalise] = React.useState<GcAnaliseIa<T> | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [gerando, setGerando] = React.useState(false)
  const [configurada, setConfigurada] = React.useState(true)
  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    gcIa.ultima<T>(clienteId, tipo)
      .then((r) => { if (vivo) { setAnalise(r.analise); setGerando(r.gerando); setConfigurada(r.iaConfigurada) } })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [clienteId, tipo])
  const gerar = async (pedido?: string) => {
    setGerando(true)
    try {
      const r = await gcIa.gerar<T>(clienteId, tipo, pedido)
      setAnalise(r.analise)
      toast.success('Pronto! A IA terminou.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGerando(false)
    }
  }
  return { analise, carregando, gerando, configurada, gerar }
}

/** Manda uma ideia da IA pro kanban de Social media do cliente (coluna "Para produzir"). */
export async function enviarParaProducao(clienteId: string, titulo: string, descricao: string) {
  try {
    await gestaoClientes.criarSocialProducao(clienteId, { titulo: titulo.slice(0, 200), descricao })
    toast.success('Enviado pra Social media → Para produzir')
  } catch (e) {
    toast.error((e as Error).message)
  }
}

function BarraGerar({ rotulo, gerando, configurada, temAnalise, onGerar, placeholder }: {
  rotulo: string; gerando: boolean; configurada: boolean; temAnalise: boolean; onGerar: (pedido?: string) => void; placeholder: string
}) {
  const [pedido, setPedido] = React.useState('')
  if (!configurada) {
    return <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">A IA não está configurada no servidor (falta ANTHROPIC_API_KEY).</p>
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input placeholder={placeholder} value={pedido} onChange={(e) => setPedido(e.target.value)} containerClassName="flex-1" />
      <Button loading={gerando} leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => onGerar(pedido)}>
        {gerando ? 'A IA está analisando…' : temAnalise ? `Gerar ${rotulo} de novo` : `Gerar ${rotulo}`}
      </Button>
    </div>
  )
}

const PRIORIDADE_CLASSE: Record<string, string> = {
  alta: 'bg-danger/15 text-danger',
  media: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  baixa: 'bg-elevate/[0.08] text-foreground/60',
}

/** Análise do tráfego feita pela IA: nota, diagnóstico, sugestões, ideias de criativo e mensagem pro cliente. */
export function PainelIaTrafego({ clienteId }: { clienteId: string }) {
  const { analise, carregando, gerando, configurada, gerar } = useAnalise<GcAnaliseTrafegoIa>(clienteId, 'trafego')
  const a = analise?.conteudo
  return (
    <Painel
      title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Análise da IA</span>}
      action={analise && (
        <span className="text-xs text-foreground/45">
          {analise.origem === 'auto' ? 'automática' : `por ${analise.gerado_por_nome ?? 'alguém'}`} · {dataHora(analise.created_at)}
        </span>
      )}
    >
      <div className="space-y-4">
        <BarraGerar
          rotulo="análise"
          gerando={gerando}
          configurada={configurada}
          temAnalise={!!a}
          onGerar={(p) => void gerar(p)}
          placeholder="Opcional: foco da análise (ex.: por que o custo subiu? vale escalar a campanha X?)"
        />
        {carregando ? (
          <Vazio>Carregando…</Vazio>
        ) : !a ? (
          <Vazio>Nenhuma análise ainda. A IA roda sozinha todo dia às 08h pra quem teve gasto na semana, ou clique em Gerar.</Vazio>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              {a.nota != null && (
                <div className={cn('flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl text-white',
                  a.nota >= 7 ? 'bg-emerald-500' : a.nota >= 5 ? 'bg-amber-500' : 'bg-danger')}>
                  <span className="text-2xl font-bold leading-none">{a.nota.toFixed(0)}</span>
                  <span className="text-[10px] opacity-80">de 10</span>
                </div>
              )}
              <p className="text-sm leading-relaxed text-foreground/85">{a.resumo}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {a.pontos_fortes.length > 0 && (
                <div className="rounded-lg bg-emerald-500/5 p-3">
                  <p className="mb-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">O que está indo bem</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/80">{a.pontos_fortes.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
              {a.problemas.length > 0 && (
                <div className="rounded-lg bg-danger/5 p-3">
                  <p className="mb-1 text-xs font-semibold text-danger">O que precisa de atenção</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/80">{a.problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
              )}
            </div>
            {a.sugestoes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">O que fazer agora</p>
                <ol className="space-y-2">
                  {a.sugestoes.map((s, i) => (
                    <li key={i} className="rounded-lg border border-line p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', PRIORIDADE_CLASSE[s.prioridade])}>{s.prioridade}</span>
                        <p className="text-sm font-medium text-foreground">{s.titulo}</p>
                      </div>
                      <p className="mt-1 text-sm text-foreground/75">{s.detalhe}</p>
                      {s.dado && <p className="mt-1 text-xs text-foreground/45">Dado: {s.dado}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {a.ideias_criativos.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">Ideias de criativo</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {a.ideias_criativos.map((c, i) => (
                    <div key={i} className="rounded-lg border border-line p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{c.titulo}</p>
                        <span className="shrink-0 rounded bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-foreground/55">{c.formato}</span>
                      </div>
                      {c.gancho && <p className="mt-1 text-foreground/75"><span className="text-foreground/45">Gancho:</span> {c.gancho}</p>}
                      <p className="mt-1 text-foreground/70">{c.descricao}</p>
                      <button
                        type="button"
                        onClick={() => void enviarParaProducao(clienteId, `Criativo: ${c.titulo}`, `Formato: ${c.formato}\nGancho: ${c.gancho}\n\n${c.descricao}\n\n(ideia gerada pela IA a partir dos números do tráfego)`)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                      >
                        <Send className="h-3 w-3" /> Enviar pra produção
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {a.mensagem_cliente && (
              <div className="rounded-lg border border-dashed border-accent/40 bg-accent/5 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground/70">Mensagem pronta pro cliente (WhatsApp)</p>
                  <BotaoCopiar texto={a.mensagem_cliente} />
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground/85">{a.mensagem_cliente}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Painel>
  )
}

function textoRoteiro(r: GcIdeiasConteudoIa['roteiros_video'][number]): string {
  return [
    `🎬 ${r.titulo} (${r.duracao}${r.objetivo ? ` · ${r.objetivo}` : ''})`,
    `Gancho: ${r.gancho}`,
    '',
    ...r.cenas,
    '',
    `CTA: ${r.cta}`,
    '',
    'Legenda:',
    r.legenda,
  ].join('\n')
}

function textoArte(a: GcIdeiasConteudoIa['artes'][number]): string {
  return [
    `🖼️ ${a.titulo} (${a.formato})`,
    '',
    'Texto da arte:',
    ...a.texto_arte,
    '',
    `Briefing visual: ${a.briefing_visual}`,
    '',
    'Legenda:',
    a.legenda,
  ].join('\n')
}

/** Ideias de conteúdo da IA: padrões do que dá certo, roteiros de Reels e artes prontos pra produzir. */
export function PainelIaConteudo({ clienteId }: { clienteId: string }) {
  const { analise, carregando, gerando, configurada, gerar } = useAnalise<GcIdeiasConteudoIa>(clienteId, 'conteudo')
  const a = analise?.conteudo
  return (
    <Painel
      title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Roteiros e artes com IA</span>}
      action={analise && <span className="text-xs text-foreground/45">por {analise.gerado_por_nome ?? 'alguém'} · {dataHora(analise.created_at)}</span>}
    >
      <div className="space-y-4">
        <BarraGerar
          rotulo="ideias"
          gerando={gerando}
          configurada={configurada}
          temAnalise={!!a}
          onGerar={(p) => void gerar(p)}
          placeholder="Opcional: tema ou data (ex.: Black Friday, lançamento do serviço X, foco em Reels)"
        />
        {carregando ? (
          <Vazio>Carregando…</Vazio>
        ) : !a ? (
          <Vazio>A IA lê os posts com mais alcance e os anúncios que mais converteram, e devolve roteiros de vídeo e artes prontos. Clique em Gerar.</Vazio>
        ) : (
          <>
            {a.diagnostico && <p className="text-sm leading-relaxed text-foreground/85">{a.diagnostico}</p>}
            {a.padroes.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">O que faz o conteúdo dar certo</p>
                <ul className="space-y-1.5">
                  {a.padroes.map((p, i) => (
                    <li key={i} className="rounded-lg bg-elevate/[0.03] px-3 py-2 text-sm">
                      <p className="font-medium text-foreground">{p.padrao}</p>
                      {p.evidencia && <p className="text-xs text-foreground/50">{p.evidencia}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {a.roteiros_video.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/50"><Clapperboard className="h-3.5 w-3.5" /> Roteiros de vídeo</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {a.roteiros_video.map((r, i) => (
                    <article key={i} className="rounded-lg border border-line p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{r.titulo}</p>
                        <span className="shrink-0 text-[11px] text-foreground/45">{r.duracao}{r.objetivo ? ` · ${r.objetivo}` : ''}</span>
                      </div>
                      <p className="mt-1.5 rounded bg-accent/10 px-2 py-1 text-foreground/85"><span className="text-xs font-semibold">Gancho:</span> {r.gancho}</p>
                      <ol className="mt-2 space-y-1 text-foreground/75">{r.cenas.map((c, k) => <li key={k}>{c}</li>)}</ol>
                      {r.cta && <p className="mt-2 text-foreground/75"><span className="text-xs font-semibold">CTA:</span> {r.cta}</p>}
                      {r.legenda && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-foreground/50">Legenda</summary>
                          <p className="mt-1 whitespace-pre-wrap text-foreground/70">{r.legenda}</p>
                        </details>
                      )}
                      <div className="mt-2 flex items-center gap-1">
                        <button type="button" onClick={() => void enviarParaProducao(clienteId, `Reels: ${r.titulo}`, textoRoteiro(r))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">
                          <Send className="h-3 w-3" /> Enviar pra produção
                        </button>
                        <BotaoCopiar texto={textoRoteiro(r)} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {a.artes.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/50"><ImageIcon className="h-3.5 w-3.5" /> Artes</p>
                <div className="grid gap-3 lg:grid-cols-2">
                  {a.artes.map((r, i) => (
                    <article key={i} className="rounded-lg border border-line p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-foreground">{r.titulo}</p>
                        <span className="shrink-0 rounded bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-foreground/55">{r.formato}</span>
                      </div>
                      <ul className="mt-2 space-y-1 text-foreground/80">{r.texto_arte.map((c, k) => <li key={k}>{c}</li>)}</ul>
                      {r.briefing_visual && <p className="mt-2 text-xs text-foreground/55"><span className="font-semibold">Visual:</span> {r.briefing_visual}</p>}
                      {r.legenda && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-foreground/50">Legenda</summary>
                          <p className="mt-1 whitespace-pre-wrap text-foreground/70">{r.legenda}</p>
                        </details>
                      )}
                      <div className="mt-2 flex items-center gap-1">
                        <button type="button" onClick={() => void enviarParaProducao(clienteId, `Arte: ${r.titulo}`, textoArte(r))} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">
                          <Send className="h-3 w-3" /> Enviar pra produção
                        </button>
                        <BotaoCopiar texto={textoArte(r)} />
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Painel>
  )
}
