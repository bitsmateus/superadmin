import * as React from 'react'
import { Check, ChevronDown, ClipboardList, Copy, Eye, History, Loader2, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { BarraSalvar } from '@/components/gestaoClientes/BarraSalvar'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import { AnexosDaArea } from '@/components/gestaoClientes/AnexosDaArea'
import { gestaoClientes, type GcBriefing, type GcPlanejamentoApi, type GcPlanoTexto } from '@/services/gestaoClientes'
import { formatarMetrica } from '@/lib/gcMetricas'
import { cn } from '@/lib/utils'

/** O que precisa estar escrito no planejamento. A chave é o que fica gravado como "marcado". */
const ITENS: { chave: string; titulo: string; ajuda: string }[] = [
  { chave: 'situacao', titulo: 'Situação de hoje', ajuda: 'O cliente já investe em tráfego ou não? Quanto, onde e como está indo.' },
  { chave: 'mes1', titulo: 'Investimento do primeiro mês', ajuda: 'Quanto ele vai investir no mês 1.' },
  { chave: 'meta6', titulo: 'Meta de 6 meses', ajuda: 'Os números que queremos em 6 meses.' },
  { chave: 'meta12', titulo: 'Meta de 12 meses', ajuda: 'Os números que queremos em 12 meses.' },
  { chave: 'numeros', titulo: 'Investimento por mês, CPL e taxa de agendamento', ajuda: 'O investimento mensal, o CPL e a taxa de agendamento esperados.' },
  { chave: 'objetivo6', titulo: 'Onde o cliente quer chegar em 6 meses', ajuda: 'O objetivo dele, na linguagem do negócio.' },
  { chave: 'objetivo12', titulo: 'Onde o cliente quer chegar em 12 meses', ajuda: 'O objetivo de um ano.' },
  { chave: 'roteiro', titulo: 'O que vamos trabalhar em cada mês', ajuda: 'Mês 1, mês 2, mês 3… o que entra em cada um.' },
  { chave: 'resultado', titulo: 'Está dando certo?', ajuda: 'O acompanhamento: o que está funcionando, o que não está e o que muda.' },
]

const VAZIO: GcPlanoTexto = { texto: '', marcados: [], no_portal: true, atualizado_em: null, autor: null }

const reais = (n: number | null | undefined) => (n === null || n === undefined ? null : formatarMetrica(n, 'reais'))
const inteiro = (n: number | null | undefined) => (n === null || n === undefined ? null : formatarMetrica(n, 'inteiro'))

/**
 * Transforma o planejamento ANTIGO (ponto A, mês 1, metas, funil, roteiro) em texto, com os mesmos títulos do
 * checklist. Só é usado quando a pessoa pede "trazer pro texto" — nada do que já estava preenchido se perde.
 */
function textoDoPlanoAntigo(p: GcPlanejamentoApi, roteiro: { mes: number; texto: string }[]): string {
  const blocos: string[] = []
  const linhas = (pares: [string, string | null][]) => pares.filter(([, v]) => v).map(([r, v]) => `- ${r}: ${v}`)

  const a = p.atual
  const hoje = [
    a.situacao_atual?.trim() ?? '',
    ...linhas([
      ['Investimento por mês', reais(a.investimento_mes)],
      ['Leads por mês', inteiro(a.leads_mes)],
      ['Vendas por mês', inteiro(a.vendas_mes)],
      ['Faturamento por mês', reais(a.faturamento_mensal)],
    ]),
  ].filter(Boolean)
  if (hoje.length) blocos.push(['SITUAÇÃO DE HOJE', ...hoje].join('\n'))

  const pm = p.primeiro_mes
  const mes1 = linhas([
    ['Investimento', reais(pm?.investimento)],
    ['CPL médio', reais(pm?.cpl_medio)],
    ['Vendas', inteiro(pm?.vendas)],
    ['Faturamento', reais(pm?.faturamento)],
  ])
  if (mes1.length) blocos.push(['INVESTIMENTO DO PRIMEIRO MÊS', ...mes1].join('\n'))

  const horizontes = [
    { h: '6_meses' as const, meta: 'META DE 6 MESES', objetivo: 'ONDE O CLIENTE QUER CHEGAR EM 6 MESES' },
    { h: '12_meses' as const, meta: 'META DE 12 MESES', objetivo: 'ONDE O CLIENTE QUER CHEGAR EM 12 MESES' },
  ]
  for (const { h, meta } of horizontes) {
    const m = p.cenarios[h]?.metas ?? {}
    const f = p.funil?.[h]
    const l = linhas([
      ['Investimento por mês', reais(m.investimento)],
      ['Leads', inteiro(m.leads)],
      ['Vendas', inteiro(m.vendas)],
      ['Faturamento', reais(m.receita)],
      ['CPL', reais(f?.cpl)],
      ['Taxa de agendamento', f?.agendamento != null ? `${f.agendamento}%` : null],
      ['Taxa de conversão', f?.conversao != null ? `${f.conversao}%` : null],
      ['Ticket médio', reais(f?.ticket)],
    ])
    if (l.length) blocos.push([meta, ...l].join('\n'))
  }
  const f1 = p.funil?.mes1
  const numeros = linhas([
    ['Taxa de agendamento (mês 1)', f1?.agendamento != null ? `${f1.agendamento}%` : null],
    ['Taxa de conversão (mês 1)', f1?.conversao != null ? `${f1.conversao}%` : null],
    ['Ticket médio (mês 1)', reais(f1?.ticket)],
  ])
  if (numeros.length) blocos.push(['INVESTIMENTO POR MÊS, CPL E TAXA DE AGENDAMENTO', ...numeros].join('\n'))

  for (const { h, objetivo } of horizontes) {
    const o = p.cenarios[h]?.onde_quer_chegar?.trim()
    if (o) blocos.push(`${objetivo}\n${o}`)
  }
  if (roteiro.length) blocos.push(['O QUE VAMOS TRABALHAR EM CADA MÊS', ...roteiro.map((r) => `- Mês ${r.mes}: ${r.texto}`)].join('\n'))

  const como = [p.estrategia_usada?.trim(), p.cenarios['6_meses']?.estrategia?.trim(), p.cenarios['12_meses']?.estrategia?.trim()].filter(Boolean)
  if (como.length) blocos.push(['COMO VAMOS FAZER', ...como].join('\n\n'))

  return blocos.join('\n\n')
}

/**
 * O prompt pronto pra colar numa IA (ChatGPT, Claude…): pede o planejamento com os mesmos títulos do checklist,
 * manda escrever "Não tem" onde faltar informação e leva junto o briefing do cliente.
 * As SENHAS do briefing nunca entram aqui — só site, redes, CRM, contas e as respostas das perguntas.
 */
function montarPrompt(cliente: { nome_empresa?: string | null; segmento?: string | null } | undefined, b: GcBriefing | null): string {
  const linhas: string[] = [
    'Você é gestor de tráfego pago da agência NX Digital. Monte o PLANEJAMENTO do cliente abaixo.',
    '',
    'Escreva em texto simples (sem tabelas e sem asteriscos), com estes títulos EM MAIÚSCULAS, nesta ordem:',
    ...ITENS.map((i, n) => `${n + 1}. ${i.titulo.toUpperCase()} — ${i.ajuda}`),
    '',
    'Regras:',
    '- Use só as informações que estão abaixo. Não invente números.',
    '- Quando a informação não existir, escreva "Não tem" naquele ponto — não deixe em branco e não chute.',
    '- Em "O que vamos trabalhar em cada mês", liste pelo menos os 6 primeiros meses (Mês 1, Mês 2…).',
    '- Em "Está dando certo?", se ainda não começou, escreva "Ainda não iniciado" e diga o que vai ser acompanhado.',
    '- Seja direto, com frases curtas.',
    '',
    '=== DADOS DO CLIENTE ===',
    `Empresa: ${cliente?.nome_empresa?.trim() || 'Não tem'}`,
    `Segmento: ${cliente?.segmento?.trim() || 'Não tem'}`,
  ]
  if (b) {
    const simNao: Record<string, string> = { sim: 'Sim', nao: 'Não', nao_sei: 'Não sabe' }
    const dado = (rotulo: string, valor: string) => linhas.push(`${rotulo}: ${valor.trim() || 'Não tem'}`)
    dado('Site', b.site)
    dado('WhatsApp que recebe os leads', b.whatsapp_leads)
    dado('Instagram', b.instagram)
    dado('Facebook', b.facebook)
    dado('CRM utilizado', b.crm)
    const conta = (rotulo: string, valor: string, obs: string) =>
      linhas.push(`${rotulo}: ${simNao[valor] ?? 'Não informado'}${obs.trim() ? ` (${obs.trim()})` : ''}`)
    conta('Forma de pagamento válida na conta de anúncios', b.pagamento_anuncios, b.pagamento_obs)
    conta('Google Ads', b.google_ads, b.google_ads_obs)
    conta('Google Meu Negócio', b.meu_negocio, b.meu_negocio_obs)
    for (const e of b.extras) if (e.rotulo.trim() || e.valor.trim()) dado(e.rotulo.trim() || 'Outra informação', e.valor)

    const respondidas = b.perguntas.filter((x) => x.pergunta.trim())
    if (respondidas.length) {
      linhas.push('', '=== BRIEFING (perguntas e respostas do cliente) ===')
      respondidas.forEach((x, n) => linhas.push(`${n + 1}. ${x.pergunta}`, `R: ${x.resposta.trim() || 'Não tem'}`))
    }
  } else {
    linhas.push('', '(O briefing deste cliente ainda não foi preenchido: cole aqui o que você souber sobre ele.)')
  }
  linhas.push('', '=== O QUE EU SEI A MAIS (escreva aqui antes de enviar) ===', '')
  return linhas.join('\n')
}

/** O passo "faça com a IA": o que fazer, o botão que copia o prompt e, se quiser conferir, o prompt inteiro. */
function FacaComIa({ clienteId, cliente }: { clienteId: string; cliente?: { nome_empresa?: string | null; segmento?: string | null } }) {
  const [briefing, setBriefing] = React.useState<GcBriefing | null>(null)
  const [aberto, setAberto] = React.useState(false)

  React.useEffect(() => {
    let vivo = true
    gestaoClientes
      .briefing(clienteId)
      .then((b) => vivo && setBriefing(b))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [clienteId])

  // Só conta como "preenchido" se houver alguma resposta ou dado — senão o prompt avisa que falta o briefing.
  const temBriefing =
    !!briefing && (briefing.perguntas.some((x) => x.resposta.trim()) || [briefing.site, briefing.instagram, briefing.crm, briefing.whatsapp_leads].some((v) => v.trim()))
  const prompt = montarPrompt(cliente, temBriefing ? briefing : null)

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt copiado — cole na IA')
    } catch {
      setAberto(true)
      toast.error('Não consegui copiar sozinho: selecione o texto abaixo e copie.')
    }
  }

  return (
    <section className="rounded-2xl border border-accent/25 bg-accent/[0.04] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-accent" /> Faça com a IA
          </h2>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-foreground/65">
            <li>Clique em <strong className="text-foreground/85">Copiar o prompt</strong>: ele já leva o checklist ao lado e o briefing deste cliente.</li>
            <li>Cole numa IA (ChatGPT, Claude…), acrescente o que você souber a mais e envie.</li>
            <li>Cole a resposta no campo abaixo e confira. O que a IA não tiver como saber, ela escreve <strong className="text-foreground/85">“Não tem”</strong> — complete ou deixe assim.</li>
          </ol>
          {!temBriefing && (
            <p className="mt-1.5 text-xs text-warning">O briefing deste cliente ainda está em branco: o prompt vai só com o nome e o segmento. Preencha o briefing antes, ou escreva os dados à mão no prompt.</p>
          )}
        </div>
        <Button size="sm" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void copiar()}>
          Copiar o prompt
        </Button>
      </div>
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="mt-2 flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !aberto && '-rotate-90')} />
        {aberto ? 'esconder o prompt' : 'ver o prompt'}
      </button>
      {aberto && (
        <textarea
          readOnly
          value={prompt}
          onFocus={(e) => e.target.select()}
          className="mt-2 h-56 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-foreground/75 outline-none"
        />
      )}
    </section>
  )
}

/**
 * Aba "Planejamento": UM lugar pra escrever o planejamento do cliente e, ao lado, o checklist do que precisa
 * estar ali (situação de hoje, mês 1, metas de 6 e 12 meses, números, objetivos, o roteiro mês a mês e o
 * acompanhamento). O checklist é só um guia: marca-se à mão o que já foi escrito.
 */
export function AbaPlanejamento({
  clienteId,
  cliente,
  onMudou,
}: {
  clienteId: string
  /** Nome e segmento, que entram no prompt do "Faça com a IA". */
  cliente?: { nome_empresa?: string | null; segmento?: string | null }
  /** Depois de salvar, o detalhe do cliente recarrega (o histórico ganha o evento novo). */
  onMudou?: () => Promise<void> | void
}) {
  const [gravado, setGravado] = React.useState<GcPlanoTexto | null>(null)
  const [r, setR] = React.useState<GcPlanoTexto>(VAZIO)
  const [salvando, setSalvando] = React.useState(false)
  const [antigo, setAntigo] = React.useState('')
  const area = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    let vivo = true
    setGravado(null)
    gestaoClientes
      .planoTexto(clienteId)
      .then((p) => {
        if (!vivo) return
        setGravado(p)
        setR(p)
      })
      .catch((err: Error) => toast.error('Falha ao carregar o planejamento: ' + err.message))
    // O planejamento antigo (em formulário): se houver algo lá, fica disponível pra trazer pro texto.
    Promise.all([gestaoClientes.planejamento(clienteId), gestaoClientes.roteiro(clienteId).catch(() => ({ meses: [] }))])
      .then(([p, rot]) => vivo && setAntigo(textoDoPlanoAntigo(p, rot.meses)))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [clienteId])

  const sujo =
    !!gravado &&
    (r.texto !== gravado.texto || r.no_portal !== gravado.no_portal || [...r.marcados].sort().join() !== [...gravado.marcados].sort().join())
  useAvisoAoSair(sujo)

  const salvar = async () => {
    setSalvando(true)
    try {
      const salvo = await gestaoClientes.salvarPlanoTexto(clienteId, { texto: r.texto, marcados: r.marcados, no_portal: r.no_portal })
      setGravado(salvo)
      setR(salvo)
      toast.success('Planejamento salvo')
      await onMudou?.()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const alternar = (chave: string) =>
    setR((x) => ({ ...x, marcados: x.marcados.includes(chave) ? x.marcados.filter((k) => k !== chave) : [...x.marcados, chave] }))

  /** Põe o título do item no fim do texto, pronto pra escrever embaixo. */
  const inserirTitulo = (titulo: string) => {
    setR((x) => ({ ...x, texto: `${x.texto.replace(/\s+$/, '')}${x.texto.trim() ? '\n\n' : ''}${titulo.toUpperCase()}\n` }))
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.selectionStart = el.selectionEnd = el.value.length
      el.scrollTop = el.scrollHeight
    })
  }

  if (!gravado) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando planejamento…
      </div>
    )
  }

  const feitos = ITENS.filter((i) => r.marcados.includes(i.chave)).length

  return (
    <div className="space-y-3">
      {!r.texto.trim() && antigo && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2 text-foreground/85">
            <History className="h-4 w-4 shrink-0 text-accent" />
            Este cliente tinha um planejamento no formato antigo (números, metas e roteiro). Quer trazer pro texto?
          </span>
          <Button size="sm" onClick={() => setR((x) => ({ ...x, texto: antigo }))}>
            Trazer pro texto
          </Button>
        </div>
      )}

      <FacaComIa clienteId={clienteId} cliente={cliente} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ------------------------------------------------------------ o texto */}
        <section className="rounded-2xl border border-line p-4 sm:p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Planejamento do cliente</h2>
            {gravado.atualizado_em && (
              <span className="text-xs text-foreground/45">
                atualizado em {new Date(gravado.atualizado_em).toLocaleDateString('pt-BR')}
                {gravado.autor ? ` por ${gravado.autor}` : ''}
              </span>
            )}
          </div>
          <textarea
            ref={area}
            value={r.texto}
            onChange={(e) => setR({ ...r, texto: e.target.value })}
            placeholder={'Cole aqui o planejamento que a IA montou (ou escreva à mão).\n\nUse o checklist ao lado como guia. Onde não houver a informação, escreva “Não tem”.'}
            className="min-h-[60vh] w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-base leading-relaxed text-foreground outline-none placeholder:text-foreground/30 focus:border-accent focus:ring-2 focus:ring-accent/15 sm:text-sm"
          />
          <AnexosDaArea clienteId={clienteId} area="planejamento" titulo="Arquivos do planejamento" />
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl border border-line px-3 py-2.5">
            <input
              type="checkbox"
              checked={r.no_portal}
              onChange={(e) => setR({ ...r, no_portal: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-line"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Eye className="h-3.5 w-3.5 text-accent" /> Mostrar este planejamento no link do cliente
              </span>
              <span className="block text-xs text-foreground/55">
                Ligado, o cliente lê o texto inteiro no link dele, do jeito que está escrito — confira se não há nada interno. Desmarque pra deixar só pra equipe.
              </span>
            </span>
          </label>
        </section>

        {/* ------------------------------------------------------------ o checklist */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <section className="rounded-2xl border border-line p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ClipboardList className="h-4 w-4 text-accent" /> O que precisa estar escrito
              </h2>
              <span className={cn('text-xs font-medium tabular-nums', feitos === ITENS.length ? 'text-success' : 'text-foreground/50')}>
                {feitos} de {ITENS.length}
              </span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-elevate/[0.08]">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(feitos / ITENS.length) * 100}%` }} />
            </div>
            <ul className="space-y-1.5">
              {ITENS.map((i) => {
                const marcado = r.marcados.includes(i.chave)
                return (
                  <li key={i.chave} className={cn('rounded-xl border px-3 py-2 transition-colors', marcado ? 'border-success/30 bg-success/[0.05]' : 'border-line')}>
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={marcado}
                        aria-label={i.titulo}
                        onClick={() => alternar(i.chave)}
                        className={cn(
                          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors',
                          marcado ? 'border-success bg-success text-white' : 'border-line hover:border-accent',
                        )}
                      >
                        {marcado && <Check className="h-3.5 w-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn('text-sm font-medium', marcado ? 'text-foreground/55 line-through' : 'text-foreground')}>{i.titulo}</p>
                        <p className="text-xs text-foreground/50">{i.ajuda}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => inserirTitulo(i.titulo)}
                        className="flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] text-foreground/45 hover:bg-accent/10 hover:text-accent"
                        title="Coloca este título no fim do texto"
                      >
                        <Plus className="h-3 w-3" /> inserir
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[11px] leading-snug text-foreground/40">
              Marque o que já está escrito. É um guia: nada aqui bloqueia o salvar.
            </p>
          </section>
        </aside>
      </div>

      <BarraSalvar
        visivel={sujo}
        salvando={salvando}
        rotulo="Salvar planejamento"
        onSalvar={() => void salvar()}
        onDescartar={() => setR(gravado)}
      />
    </div>
  )
}
