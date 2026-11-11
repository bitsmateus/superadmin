import * as React from 'react'
import { ChevronDown, Clapperboard, FileDown, Image as ImageIcon, Lightbulb, Minus, Plus, Send, Sparkles } from 'lucide-react'
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
  const gerar = async (pedido?: string, quantidade?: { videos: number; artes: number }) => {
    setGerando(true)
    try {
      const r = await gcIa.gerar<T>(clienteId, tipo, pedido, quantidade)
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
      <Input placeholder={placeholder} autoComplete="off" name="pedido-ia" value={pedido} onChange={(e) => setPedido(e.target.value)} containerClassName="flex-1" />
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
  const [completa, setCompleta] = React.useState(false)
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
            <div className="flex items-center gap-3">
              {a.nota != null && (
                <div className={cn('flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-white',
                  a.nota >= 7 ? 'bg-emerald-500' : a.nota >= 5 ? 'bg-amber-500' : 'bg-danger')}>
                  <span className="text-lg font-bold leading-none">{a.nota.toFixed(0)}</span>
                  <span className="text-[9px] opacity-80">de 10</span>
                </div>
              )}
              <p className="line-clamp-2 text-sm font-medium text-foreground/85">{primeiraFrase(a.resumo)}</p>
            </div>
            {a.sugestoes.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">O que fazer</p>
                <ol className="divide-y divide-line rounded-lg border border-line">
                  {a.sugestoes.slice(0, 3).map((s, i) => (
                    <li key={i} className="flex items-start gap-2 px-3 py-2" title={s.detalhe}>
                      <span className={cn('mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase', PRIORIDADE_CLASSE[s.prioridade])}>{s.prioridade}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{s.titulo}</p>
                        {s.dado && <p className="truncate text-xs text-foreground/45">{s.dado}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCompleta((c) => !c)}
              className="flex items-center gap-1 text-xs font-medium text-foreground/55 hover:text-foreground"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !completa && '-rotate-90')} />
              {completa ? 'Esconder detalhes' : 'Ver análise completa e mensagem pro cliente'}
            </button>
            {completa && (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-foreground/75">{a.resumo}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {a.pontos_fortes.length > 0 && (
                    <div className="rounded-lg bg-emerald-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Indo bem</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/80">{a.pontos_fortes.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  )}
                  {a.problemas.length > 0 && (
                    <div className="rounded-lg bg-danger/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-danger">Atenção</p>
                      <ul className="list-disc space-y-0.5 pl-4 text-sm text-foreground/80">{a.problemas.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  )}
                </div>
                {a.mensagem_cliente && (
                  <div className="rounded-lg border border-dashed border-accent/40 bg-accent/5 p-3">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-semibold text-foreground/70">Mensagem pronta pro cliente (WhatsApp)</p>
                      <BotaoCopiar texto={a.mensagem_cliente} />
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-foreground/85">{a.mensagem_cliente}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Painel>
  )
}

/** Só a primeira frase do resumo — o resto fica em "ver análise completa". */
function primeiraFrase(texto: string): string {
  const m = texto.match(/^.*?[.!?](\s|$)/)
  return (m ? m[0] : texto).trim()
}

/**
 * As ideias de criativo que a análise do TRÁFEGO sugere (a partir dos anúncios que mais converteram).
 * Moram na aba Conteúdo, junto dos roteiros e artes, e não na análise do tráfego.
 */
export function IdeiasCriativoDoTrafego({ clienteId }: { clienteId: string }) {
  const { analise, carregando } = useAnalise<GcAnaliseTrafegoIa>(clienteId, 'trafego')
  const ideias = analise?.conteudo?.ideias_criativos ?? []
  if (carregando || ideias.length === 0) return null
  return (
    <Painel
      title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Ideias de criativo (do tráfego)</span>}
      action={<span className="text-xs text-foreground/45">análise de {dataHora(analise!.created_at)}</span>}
    >
      <div className="grid gap-2 md:grid-cols-2">
        {ideias.map((c, i) => (
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

/** Campo de quantidade com − e +, de 0 a 10. */
function Quantidade({ rotulo, icone, valor, onChange }: { rotulo: string; icone: React.ReactNode; valor: number; onChange: (n: number) => void }) {
  const botao = 'flex h-8 w-7 items-center justify-center text-foreground/55 hover:text-foreground disabled:opacity-30'
  return (
    <div className="flex h-10 items-center gap-1.5 rounded-lg border border-line bg-surface pl-2.5 text-sm">
      <span className="flex items-center gap-1.5 text-foreground/65">{icone}{rotulo}</span>
      <div className="flex items-center">
        <button type="button" className={botao} disabled={valor <= 0} onClick={() => onChange(valor - 1)} aria-label={`Menos ${rotulo}`}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-5 text-center font-semibold tabular-nums">{valor}</span>
        <button type="button" className={botao} disabled={valor >= 10} onClick={() => onChange(valor + 1)} aria-label={`Mais ${rotulo}`}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

/** Uma ideia numa linha; clicar abre o resto (cenas/slides, CTA, legenda). */
function ItemIdeia({ numero, titulo, chips, linha, aberto, onAlternar, onEnviar, textoCopiar, children }: {
  numero: number; titulo: string; chips: string[]; linha: string; aberto: boolean; onAlternar: () => void
  onEnviar: () => void; textoCopiar: string; children: React.ReactNode
}) {
  return (
    <li className={cn('rounded-lg border transition-colors', aberto ? 'border-accent/40 bg-accent/[0.02]' : 'border-line')}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onAlternar} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elevate/[0.06] text-xs font-semibold tabular-nums text-foreground/60">{numero}</span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{titulo}</span>
              {chips.filter(Boolean).map((c) => (
                <span key={c} className="rounded bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] uppercase text-foreground/55">{c}</span>
              ))}
            </span>
            {!aberto && linha && <span className="block truncate text-xs text-foreground/50">{linha}</span>}
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-foreground/35 transition-transform', aberto && 'rotate-180')} />
        </button>
        <button type="button" onClick={onEnviar} title="Enviar pra Social media → Para produzir" className="shrink-0 rounded-md p-1.5 text-accent hover:bg-accent/10" aria-label="Enviar pra produção">
          <Send className="h-3.5 w-3.5" />
        </button>
        <BotaoCopiar texto={textoCopiar} />
      </div>
      {aberto && <div className="space-y-2.5 border-t border-line px-3 py-3 text-sm">{children}</div>}
    </li>
  )
}

function Bloco({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">{rotulo}</p>
      {children}
    </div>
  )
}

type AbaIdeias = 'videos' | 'artes' | 'padroes'

/**
 * Ideias de conteúdo da IA, separadas por assunto: Vídeos, Artes e O que funciona. Cada ideia é uma
 * linha (título, formato e gancho); o roteiro inteiro só abre no clique. A equipe escolhe quantos
 * vídeos e quantas artes quer antes de gerar.
 */
export function PainelIaConteudo({ clienteId, clienteNome }: { clienteId: string; clienteNome?: string }) {
  const { analise, carregando, gerando, configurada, gerar } = useAnalise<GcIdeiasConteudoIa>(clienteId, 'conteudo')
  const a = analise?.conteudo
  const [pedido, setPedido] = React.useState('')
  const [videos, setVideos] = React.useState(3)
  const [artes, setArtes] = React.useState(3)
  const [aba, setAba] = React.useState<AbaIdeias>('videos')
  const [aberto, setAberto] = React.useState<string | null>(null)
  const [baixando, setBaixando] = React.useState(false)

  const baixarPdf = async () => {
    setBaixando(true)
    try {
      const blob = await gcIa.pdfRoteiros(clienteId)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Roteiros - ${(clienteNome || 'cliente').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setBaixando(false)
    }
  }

  // Nova geração: volta pra primeira aba que tem algo e fecha o que estava aberto.
  React.useEffect(() => {
    if (!a) return
    setAberto(null)
    setAba(a.roteiros_video.length ? 'videos' : a.artes.length ? 'artes' : 'padroes')
  }, [analise?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const abas: { valor: AbaIdeias; rotulo: string; icone: React.ReactNode; total: number }[] = a
    ? [
        { valor: 'videos', rotulo: 'Vídeos', icone: <Clapperboard className="h-3.5 w-3.5" />, total: a.roteiros_video.length },
        { valor: 'artes', rotulo: 'Artes', icone: <ImageIcon className="h-3.5 w-3.5" />, total: a.artes.length },
        { valor: 'padroes', rotulo: 'O que funciona', icone: <Lightbulb className="h-3.5 w-3.5" />, total: a.padroes.length },
      ]
    : []

  return (
    <Painel
      title={<span className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-accent" /> Roteiros e artes com IA</span>}
      action={analise && <span className="text-xs text-foreground/45">por {analise.gerado_por_nome ?? 'alguém'} · {dataHora(analise.created_at)}</span>}
    >
      <div className="space-y-4">
        {!configurada ? (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">A IA não está configurada no servidor (falta ANTHROPIC_API_KEY).</p>
        ) : (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Input
              placeholder="Tema ou data (opcional): Black Friday, lançamento do serviço X…"
              autoComplete="off"
              name="pedido-ia-conteudo"
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              containerClassName="flex-1"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Quantidade rotulo="Vídeos" icone={<Clapperboard className="h-3.5 w-3.5" />} valor={videos} onChange={setVideos} />
              <Quantidade rotulo="Artes" icone={<ImageIcon className="h-3.5 w-3.5" />} valor={artes} onChange={setArtes} />
              <Button
                loading={gerando}
                disabled={videos + artes === 0}
                leftIcon={<Sparkles className="h-4 w-4" />}
                onClick={() => void gerar(pedido, { videos, artes })}
              >
                {gerando ? 'Gerando…' : a ? 'Gerar de novo' : 'Gerar'}
              </Button>
              {!!a?.roteiros_video.length && (
                <Button variant="secondary" loading={baixando} leftIcon={<FileDown className="h-4 w-4" />} onClick={() => void baixarPdf()}>
                  Baixar PDF dos roteiros
                </Button>
              )}
            </div>
          </div>
        )}

        {carregando ? (
          <Vazio>Carregando…</Vazio>
        ) : !a ? (
          <Vazio>Escolha quantos vídeos e artes quer e clique em Gerar. A IA usa os posts com mais alcance e os anúncios que mais converteram.</Vazio>
        ) : (
          <>
            {a.diagnostico && (
              <p className="flex items-start gap-2 rounded-lg bg-elevate/[0.03] px-3 py-2 text-sm text-foreground/75">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {a.diagnostico}
              </p>
            )}

            <div className="flex gap-1 border-b border-line">
              {abas.map((t) => (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => { setAba(t.valor); setAberto(null) }}
                  className={cn(
                    '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                    aba === t.valor ? 'border-accent font-medium text-foreground' : 'border-transparent text-foreground/55 hover:text-foreground',
                  )}
                >
                  {t.icone} {t.rotulo}
                  <span className="text-xs tabular-nums text-foreground/40">{t.total}</span>
                </button>
              ))}
            </div>

            {aba === 'videos' && (
              a.roteiros_video.length === 0 ? <Vazio>Nenhum vídeo nesta geração.</Vazio> : (
                <ul className="space-y-1.5">
                  {a.roteiros_video.map((r, i) => (
                    <ItemIdeia
                      key={i}
                      numero={i + 1}
                      titulo={r.titulo}
                      chips={[r.duracao, r.objetivo]}
                      linha={r.gancho ? `Gancho: ${r.gancho}` : ''}
                      aberto={aberto === `v${i}`}
                      onAlternar={() => setAberto((x) => (x === `v${i}` ? null : `v${i}`))}
                      onEnviar={() => void enviarParaProducao(clienteId, `Reels: ${r.titulo}`, textoRoteiro(r))}
                      textoCopiar={textoRoteiro(r)}
                    >
                      {r.gancho && <p className="rounded bg-accent/10 px-2 py-1.5 text-foreground/85"><span className="text-xs font-semibold">Gancho:</span> {r.gancho}</p>}
                      {r.cenas.length > 0 && (
                        <Bloco rotulo="Cenas">
                          <ol className="space-y-1 text-foreground/80">{r.cenas.map((c, k) => <li key={k}>{c}</li>)}</ol>
                        </Bloco>
                      )}
                      {r.cta && <Bloco rotulo="CTA"><p className="text-foreground/80">{r.cta}</p></Bloco>}
                      {r.legenda && <Bloco rotulo="Legenda"><p className="whitespace-pre-wrap text-foreground/70">{r.legenda}</p></Bloco>}
                    </ItemIdeia>
                  ))}
                </ul>
              )
            )}

            {aba === 'artes' && (
              a.artes.length === 0 ? <Vazio>Nenhuma arte nesta geração.</Vazio> : (
                <ul className="space-y-1.5">
                  {a.artes.map((r, i) => (
                    <ItemIdeia
                      key={i}
                      numero={i + 1}
                      titulo={r.titulo}
                      chips={[r.formato, r.texto_arte.length > 1 ? `${r.texto_arte.length} slides` : '']}
                      linha={r.texto_arte[0] ?? ''}
                      aberto={aberto === `a${i}`}
                      onAlternar={() => setAberto((x) => (x === `a${i}` ? null : `a${i}`))}
                      onEnviar={() => void enviarParaProducao(clienteId, `Arte: ${r.titulo}`, textoArte(r))}
                      textoCopiar={textoArte(r)}
                    >
                      {r.texto_arte.length > 0 && (
                        <Bloco rotulo="Texto da arte">
                          <ul className="space-y-1 text-foreground/80">{r.texto_arte.map((c, k) => <li key={k}>{c}</li>)}</ul>
                        </Bloco>
                      )}
                      {r.briefing_visual && <Bloco rotulo="Visual"><p className="text-foreground/75">{r.briefing_visual}</p></Bloco>}
                      {r.legenda && <Bloco rotulo="Legenda"><p className="whitespace-pre-wrap text-foreground/70">{r.legenda}</p></Bloco>}
                    </ItemIdeia>
                  ))}
                </ul>
              )
            )}

            {aba === 'padroes' && (
              a.padroes.length === 0 ? <Vazio>Sem padrões nesta geração.</Vazio> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {a.padroes.map((p, i) => (
                    <li key={i} className="px-3 py-2">
                      <p className="text-sm font-medium text-foreground">{p.padrao}</p>
                      {p.evidencia && <p className="text-xs text-foreground/50">{p.evidencia}</p>}
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </div>
    </Painel>
  )
}
