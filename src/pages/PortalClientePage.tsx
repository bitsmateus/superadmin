import * as React from 'react'
import { useParams } from 'react-router-dom'
import {
  BarChart3, CircleDollarSign, ClipboardList, Clock, FileDown, Flag, Info, Loader2, MessageSquare, Phone,
  ShoppingBag, SlidersHorizontal, StickyNote, TrendingUp, Users, Wallet,
} from 'lucide-react'
import { gestaoClientes, HORIZONTES, type GcSnapshot } from '@/services/gestaoClientes'
import { formatarMetrica, mesAtual, mesPorExtenso } from '@/lib/gcMetricas'
import { BRIEFING_MODELO, comModeloDoBriefing } from '@/lib/gcBriefingModelo'
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

const ROTULO_DA_CONTA: Record<string, string> = {
  pagamento_anuncios: 'Forma de pagamento válida na conta de anúncios',
  google_ads: 'Google Ads',
  meu_negocio: 'Google Meu Negócio',
}
const RESPOSTA_DA_CONTA: Record<string, string> = { sim: 'Sim', nao: 'Não', nao_sei: 'Não sei' }

/** O que aparece numa aba que ainda não tem conteúdo: o cliente entende que é "ainda não", e não um erro. */
function Vazio({ icone: Icone, titulo, texto }: { icone: React.ComponentType<{ className?: string }>; titulo: string; texto: string }) {
  return (
    <section className="rounded-3xl border border-line bg-surface px-5 py-10 text-center shadow-sm sm:px-7">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent/12 text-accent">
        <Icone className="h-6 w-6" />
      </span>
      <h2 className="mt-3 text-base font-semibold text-foreground">{titulo}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-foreground/55">{texto}</p>
    </section>
  )
}

/**
 * O briefing INTEIRO, só leitura: os dados da empresa, as contas e todas as perguntas do modelo — respondidas
 * ou não. Senhas nunca chegam aqui.
 */
function BriefingDoCliente({ briefing }: { briefing: Portal['briefing'] }) {
  const d = briefing?.dados
  const dados = [
    { rotulo: 'Site', valor: d?.site ?? '' },
    { rotulo: 'WhatsApp que recebe os leads', valor: d?.whatsapp_leads ?? '' },
    { rotulo: 'Instagram', valor: d?.instagram ?? '' },
    { rotulo: 'Facebook', valor: d?.facebook ?? '' },
    { rotulo: 'CRM utilizado', valor: d?.crm ?? '' },
  ]
  const contas = Object.keys(ROTULO_DA_CONTA).map((chave) => {
    const c = briefing?.contas.find((x) => x.chave === chave)
    return { chave, valor: c?.valor ?? '', obs: c?.obs ?? '' }
  })
  // As perguntas do modelo aparecem sempre, na ordem dele; o que foi acrescentado depois vai em "Outras perguntas".
  const perguntas = comModeloDoBriefing(briefing?.perguntas ?? [])
  const blocoDe = new Map(BRIEFING_MODELO.map((p) => [p.pergunta, p.bloco.replace(/^Bloco\s+\d+\s+—\s+/, '')]))
  const grupos = new Map<string, { n: number; pergunta: string; resposta: string }[]>()
  perguntas.forEach((p, i) => {
    const bloco = blocoDe.get(p.pergunta) ?? 'Outras perguntas'
    grupos.set(bloco, [...(grupos.get(bloco) ?? []), { n: i + 1, ...p }])
  })
  const respondidas = perguntas.filter((p) => p.resposta.trim()).length
  const semResposta = <span className="italic text-foreground/40">Ainda não respondido</span>

  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-foreground">Briefing</h2>
        <span className="text-xs tabular-nums text-foreground/50">
          {respondidas} de {perguntas.length} perguntas respondidas
        </span>
      </div>
      <p className="mb-4 text-xs text-foreground/50">
        {briefing?.enviado_em ? `Enviado em ${new Date(briefing.enviado_em).toLocaleDateString('pt-BR')}. ` : ''}
        Precisa corrigir ou completar algo? Fale com a equipe da NX.
      </p>

      <Secao titulo="Sua empresa" className="mt-0">
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {dados.map((x) => (
            <div key={x.rotulo}>
              <dt className="text-[11px] uppercase tracking-wide text-foreground/45">{x.rotulo}</dt>
              <dd className="break-words text-sm text-foreground/85">{x.valor || semResposta}</dd>
            </div>
          ))}
        </dl>
      </Secao>

      <Secao titulo="Contas e pagamento">
        <ul className="space-y-1.5">
          {contas.map((c) => (
            <li key={c.chave} className="text-sm text-foreground/85">
              <span className="text-foreground/60">{ROTULO_DA_CONTA[c.chave]}:</span>{' '}
              {c.valor || c.obs ? (
                <>
                  {RESPOSTA_DA_CONTA[c.valor] && <strong className="font-medium">{RESPOSTA_DA_CONTA[c.valor]}</strong>}
                  {c.obs && <span className="text-foreground/60">{RESPOSTA_DA_CONTA[c.valor] ? ' · ' : ''}{c.obs}</span>}
                </>
              ) : (
                semResposta
              )}
            </li>
          ))}
        </ul>
      </Secao>

      {Array.from(grupos.entries()).map(([bloco, doBloco]) => (
        <Secao key={bloco} titulo={bloco}>
          <ol className="space-y-3.5">
            {doBloco.map((p) => (
              <li key={p.n} className="flex gap-2.5">
                <span className="mt-0.5 grid h-5 min-w-5 shrink-0 place-items-center rounded-md bg-elevate/[0.06] px-1 text-[11px] font-semibold tabular-nums text-foreground/55">
                  {p.n}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{p.pergunta}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/75">{p.resposta.trim() || semResposta}</p>
                </div>
              </li>
            ))}
          </ol>
        </Secao>
      ))}
    </section>
  )
}

type RelPortal = Portal['relatorios'][number]
type NotaPortal = NonNullable<Portal['notas']>[number]

const rotuloDoRelatorio = (r: RelPortal) => r.snapshot?.periodo?.rotulo ?? mesPorExtenso(String(r.periodo_inicio).slice(0, 7))

/** MÉTRICAS E RELATÓRIOS: o cliente escolhe o mês e lê o relatório publicado daquele mês. */
function AbaRelatorios({ relatorios, baixar }: { relatorios: RelPortal[]; baixar: (id: string, rotulo: string) => Promise<void> }) {
  const [aberto, setAberto] = React.useState<string | null>(relatorios[0]?.id ?? null)
  const mesCorrente = mesAtual()
  const mesDe = (r: RelPortal) => String(r.periodo_inicio).slice(0, 7)
  const temDoMes = relatorios.some((r) => mesDe(r) === mesCorrente)
  const r = relatorios.find((x) => x.id === aberto) ?? relatorios[0]

  if (!r) {
    return (
      <Vazio
        icone={BarChart3}
        titulo="Ainda não há relatório publicado"
        texto="O primeiro relatório aparece aqui assim que o mês fechar e a equipe da NX publicar os números."
      />
    )
  }
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/50">Escolha o mês</p>
        <div className="flex flex-wrap gap-1.5">
          {relatorios.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setAberto(x.id)}
              aria-pressed={x.id === r.id}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                x.id === r.id
                  ? 'border-accent bg-accent font-semibold text-white'
                  : 'border-line text-foreground/65 hover:border-accent/40 hover:text-foreground',
              )}
            >
              {rotuloDoRelatorio(x)}
              {mesDe(x) === mesCorrente && <span className="ml-1.5 text-xs font-normal opacity-75">· mês atual</span>}
            </button>
          ))}
        </div>
        {!temDoMes && (
          <p className="mt-2 px-1 text-xs text-foreground/50">
            O relatório de {mesPorExtenso(mesCorrente).toLowerCase()} ainda não foi publicado — sai assim que o mês fechar.
          </p>
        )}
      </div>
      <Relatorio
        key={r.id}
        snapshot={r.snapshot}
        publicadoEm={r.publicado_em ?? r.snapshot?.publicado_em ?? null}
        baixar={() => baixar(r.id, rotuloDoRelatorio(r))}
      />
    </div>
  )
}

/** Como cada tipo de registro aparece pro cliente. O subtipo interno da reunião não vem pra cá. */
const TIPO_DA_NOTA: Record<string, { rotulo: string; icone: React.ComponentType<{ className?: string }>; cor: string }> = {
  nota: { rotulo: 'Atualização', icone: StickyNote, cor: 'bg-elevate/[0.06] text-foreground/60' },
  reuniao: { rotulo: 'Reunião', icone: Users, cor: 'bg-accent/12 text-accent' },
  ligacao: { rotulo: 'Ligação', icone: Phone, cor: 'bg-success/12 text-success' },
  reclamacao: { rotulo: 'Solicitação', icone: MessageSquare, cor: 'bg-warning/15 text-warning' },
  ajuste: { rotulo: 'Ajuste', icone: SlidersHorizontal, cor: 'bg-warning/15 text-warning' },
}

/** NOTAS E HISTÓRICO: só o que a equipe marcou pra compartilhar, do mais novo pro mais antigo. */
function NotasDoCliente({ notas, token }: { notas: NotaPortal[]; token: string }) {
  if (notas.length === 0) {
    return (
      <Vazio
        icone={MessageSquare}
        titulo="Nada compartilhado ainda"
        texto="Reuniões, ajustes e atualizações que a equipe da NX compartilhar com você ficam guardados aqui."
      />
    )
  }
  const base = import.meta.env.VITE_API_URL ?? ''
  const urlDoAnexo = (nota: string, anexo: string) =>
    `${base}/api/public/cliente/${encodeURIComponent(token)}/nota/${nota}/anexo/${encodeURIComponent(anexo)}`
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
      <h2 className="text-lg font-semibold text-foreground">Notas e histórico</h2>
      <p className="mb-4 text-xs text-foreground/50">O que a equipe da NX registrou e compartilhou com você, do mais recente pro mais antigo.</p>
      <ol className="space-y-3">
        {notas.map((n) => {
          const tipo = TIPO_DA_NOTA[n.tipo] ?? TIPO_DA_NOTA.nota
          const imagens = n.anexos.filter((a) => a.type?.startsWith('image/') && a.type !== 'image/svg+xml')
          const arquivos = n.anexos.filter((a) => !imagens.includes(a))
          return (
            <li key={n.id} className="flex gap-3 rounded-2xl border border-line p-3.5">
              <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', tipo.cor)}>
                <tipo.icone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-semibold text-foreground">{tipo.rotulo}</span>
                  <span className="text-xs text-foreground/50">
                    {dataEHora(n.created_at)} · {n.autor ?? 'Equipe NX'}
                  </span>
                </div>
                {n.descricao && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{n.descricao}</p>}
                {imagens.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {imagens.map((a) => (
                      <a
                        key={a.id}
                        href={urlDoAnexo(n.id, a.id)}
                        target="_blank"
                        rel="noreferrer"
                        title={a.name}
                        className="overflow-hidden rounded-lg border border-line transition-colors hover:border-accent/50"
                      >
                        <img src={urlDoAnexo(n.id, a.id)} alt={a.name} loading="lazy" className="h-24 w-36 object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                {arquivos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {arquivos.map((a) => (
                      <a
                        key={a.id}
                        href={urlDoAnexo(n.id, a.id)}
                        className="flex max-w-full items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-foreground/70 transition-colors hover:border-accent/50 hover:text-foreground"
                      >
                        <FileDown className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{a.name}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

type AbaPortal = 'plano' | 'briefing' | 'relatorios' | 'notas'

const ABAS_DO_PORTAL: { id: AbaPortal; label: string; icone: React.ComponentType<{ className?: string }> }[] = [
  { id: 'plano', label: 'Planejamento', icone: Flag },
  { id: 'briefing', label: 'Briefing', icone: ClipboardList },
  { id: 'relatorios', label: 'Métricas e relatórios', icone: BarChart3 },
  { id: 'notas', label: 'Notas e histórico', icone: MessageSquare },
]

/**
 * PORTAL DO CLIENTE — /cliente/:token, sem login.
 *
 * Quatro abas, na mesma ordem da ficha interna: Planejamento, Briefing, Métricas e relatórios, Notas e
 * histórico. O cliente só vê o que a NX escolheu mostrar: o texto do planejamento (se marcado pra aparecer),
 * o briefing sem as senhas, os relatórios PUBLICADOS (lidos da foto congelada na publicação) e as notas que a
 * equipe marcou "compartilhar no portal do cliente".
 *
 * Nada de custo, margem, semáforo nem registro interno. Em todo o painel fica claro QUANDO foi a última
 * atualização e que a equipe pode estar fazendo coisas que ainda não entraram aqui.
 */
export function PortalClientePage() {
  const { token = '' } = useParams<{ token: string }>()
  const [dados, setDados] = React.useState<Portal | null>(null)
  const [erro, setErro] = React.useState('')
  const [carregando, setCarregando] = React.useState(true)
  // Null = o cliente ainda não escolheu: abre a primeira aba que já tem conteúdo.
  const [aba, setAba] = React.useState<AbaPortal | null>(null)

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

  const notas = dados.notas ?? []
  // A última atualização é o que a equipe liberou por último pra cá: relatório publicado ou nota compartilhada.
  const momentos = [
    ...dados.relatorios.map((r) => r.publicado_em ?? r.snapshot?.publicado_em ?? null),
    ...notas.map((n) => n.created_at),
  ]
    .filter((x): x is string => !!x)
    .map((x) => new Date(x).getTime())
    .filter((x) => !Number.isNaN(x))
  const ultimaTexto = momentos.length ? dataEHora(new Date(Math.max(...momentos)).toISOString()) : null
  // Do mais novo pro mais velho.
  const ordenados = [...dados.relatorios].sort((a, b) => String(b.periodo_inicio).localeCompare(String(a.periodo_inicio)))
  const infoDoCliente = dados.relatorios[0]?.snapshot?.cliente

  const temBriefing =
    !!dados.briefing &&
    (dados.briefing.perguntas.some((p) => p.resposta.trim()) ||
      dados.briefing.contas.some((c) => c.valor || c.obs) ||
      Object.values(dados.briefing.dados).some(Boolean))
  const temConteudo: Record<AbaPortal, boolean> = {
    plano: !!dados.planejamento_texto,
    briefing: temBriefing,
    relatorios: ordenados.length > 0,
    notas: notas.length > 0,
  }
  const abaAberta: AbaPortal = aba ?? ABAS_DO_PORTAL.find((a) => temConteudo[a.id])?.id ?? 'plano'

  return (
    <div
      className="min-h-screen px-4 py-6 sm:px-6 sm:py-10"
      style={{ background: 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)' }}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            {dados.cliente.logo_url ? (
              <img src={dados.cliente.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-2xl border border-line object-cover shadow-sm" />
            ) : (
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line bg-surface text-base font-bold text-foreground/70 shadow-sm">
                {dados.cliente.nome_empresa.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">
                <img src={logoNx} alt="" className="h-4 w-4 rounded" /> Grupo NX Digital
              </p>
              <h1 className="break-words text-2xl font-bold tracking-tight text-white">{dados.cliente.nome_empresa}</h1>
              <p className="text-xs text-white/60">
                {[dados.cliente.segmento, infoDoCliente?.cidade].filter(Boolean).join(' · ') || 'Portal do cliente'}
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

        <nav
          role="tablist"
          aria-label="O que você quer ver"
          className="grid grid-cols-2 gap-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-sm sm:grid-cols-4"
        >
          {ABAS_DO_PORTAL.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={abaAberta === a.id}
              onClick={() => setAba(a.id)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-center text-[13px] font-medium leading-tight sm:flex-row sm:gap-2 sm:text-sm',
                abaAberta === a.id ? 'bg-accent text-white shadow-sm' : 'text-foreground/60 hover:bg-elevate/[0.05] hover:text-foreground',
              )}
            >
              <a.icone className="h-4 w-4 shrink-0" />
              {a.label}
            </button>
          ))}
        </nav>

        {abaAberta === 'plano' &&
          (dados.planejamento_texto ? (
            <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-7">
              <h2 className="mb-3 text-lg font-semibold text-foreground">Planejamento</h2>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{dados.planejamento_texto}</p>
            </section>
          ) : (
            <Vazio
              icone={Flag}
              titulo="O planejamento ainda não foi publicado"
              texto="Assim que a equipe da NX concluir o seu planejamento, ele aparece aqui."
            />
          ))}

        {abaAberta === 'briefing' && <BriefingDoCliente briefing={dados.briefing} />}

        {abaAberta === 'relatorios' && <AbaRelatorios relatorios={ordenados} baixar={baixarPdf} />}

        {abaAberta === 'notas' && <NotasDoCliente notas={notas} token={token} />}

        <footer className="space-y-1 pb-6 pt-2 text-center text-xs text-white/60">
          <p>Grupo NX Digital · este link é pessoal, não compartilhe.</p>
          {ultimaTexto && <p>Última atualização: {ultimaTexto}</p>}
        </footer>
      </div>
    </div>
  )
}
