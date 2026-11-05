import * as React from 'react'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Copy, ExternalLink, History, Loader2, MessageSquare, RefreshCw, Send,
  ShieldCheck, Sparkles, UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Input'
import {
  gestaoClientes, type GcRedeSocial, type GcSocialAgendamento, type GcSocialProducao, type GcSocialStatus,
} from '@/services/gestaoClientes'
import { ETAPAS_ARTE, copiar, enderecoDoPortal, imagensFinais, midiasFinais, nomeDoMes, opcoesDeMes } from '@/lib/socialArtes'
import { cn } from '@/lib/utils'
import { AnexosDoCard } from './AnexosDoCard'

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const dataHoraCurta = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

// ------------------------------------------------------------------ revisão da IA

function RevisaoDaIa({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const [revisando, setRevisando] = React.useState(false)
  const r = demanda.revisao_ia
  const temArte = imagensFinais(demanda).length > 0

  const revisar = async () => {
    setRevisando(true)
    try {
      const revisao = await gestaoClientes.iaRevisarArte(demanda.id)
      onMudou({ ...demanda, revisao_ia: revisao })
      toast[revisao.ok ? 'success' : 'warning'](revisao.ok ? 'A IA não achou problema' : 'A IA apontou pontos pra corrigir')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRevisando(false)
    }
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-accent" /> Revisão da IA
        </p>
        <Button
          size="sm"
          variant="secondary"
          loading={revisando}
          disabled={!temArte}
          title={temArte ? undefined : 'Anexe a arte final primeiro'}
          leftIcon={r ? <RefreshCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
          onClick={() => void revisar()}
        >
          {r ? 'Revisar de novo' : 'Revisar com IA'}
        </Button>
      </div>
      {!r && (
        <p className="mt-1 text-xs text-foreground/45">
          Antes de mandar pro cliente: a IA olha a arte e confere português, preço e datas do pedido, logo e tamanho do formato.
        </p>
      )}
      {revisando && <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/55"><Loader2 className="h-3 w-3 animate-spin" /> Olhando a arte…</p>}
      {r && !revisando && (
        <div className="mt-2 space-y-1.5">
          <p className={cn('flex items-center gap-1.5 text-sm font-medium', r.ok ? 'text-success' : 'text-warning')}>
            {r.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {r.resumo || (r.ok ? 'Tudo certo' : 'Pontos pra corrigir')}
          </p>
          {r.problemas.length > 0 && (
            <ul className="space-y-1">
              {r.problemas.map((p, i) => (
                <li key={i} className="flex gap-2 text-xs text-foreground/80">
                  <span className={cn(
                    'mt-0.5 h-fit shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase',
                    p.gravidade === 'alta' ? 'bg-danger/10 text-danger' : p.gravidade === 'media' ? 'bg-warning/15 text-warning' : 'bg-elevate/[0.08] text-foreground/55',
                  )}>
                    {p.gravidade === 'media' ? 'média' : p.gravidade}
                  </span>
                  {p.texto}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-foreground/35">Revisado em {dataHoraCurta(r.feito_em)}. A IA ajuda, mas confira com os seus olhos.</p>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ ajuste pedido pelo cliente

function AjusteDoCliente({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const [gerando, setGerando] = React.useState(false)
  const eventos = demanda.eventos ?? []
  const iUltimo = eventos.map((e) => e.tipo).lastIndexOf('ajuste_cliente')
  if (iUltimo < 0) return null
  const ajuste = eventos[iUltimo]
  const checklist = eventos.slice(iUltimo + 1).reverse().find((e) => e.tipo === 'checklist_ia')
  // Já reenviado/aprovado depois do ajuste: mostra fechado, só de histórico.
  if (!demanda.ajuste_pedido) return null

  const refazer = async () => {
    setGerando(true)
    try {
      const { checklist: texto } = await gestaoClientes.iaChecklistDoAjuste(demanda.id)
      onMudou({
        ...demanda,
        eventos: [...eventos, { id: crypto.randomUUID(), tipo: 'checklist_ia', texto, autor_nome: 'IA', created_at: new Date().toISOString() }],
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGerando(false)
    }
  }

  return (
    <div className="rounded-xl border border-danger/30 bg-danger/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
        <AlertTriangle className="h-4 w-4" /> Ajuste pedido pelo cliente
        <span className="text-xs font-normal text-foreground/45">· {ajuste.autor_nome} · {dataHoraCurta(ajuste.created_at)}</span>
      </p>
      <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-sm text-foreground/85">"{ajuste.texto}"</p>
      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70"><ClipboardCheck className="h-3.5 w-3.5" /> Checklist pra designer (IA)</p>
          <Button size="sm" variant="ghost" loading={gerando} leftIcon={<Sparkles className="h-3 w-3" />} onClick={() => void refazer()}>
            {checklist ? 'Refazer' : 'Gerar checklist'}
          </Button>
        </div>
        {checklist ? (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{checklist.texto}</p>
        ) : (
          <p className="mt-1 text-xs text-foreground/45">{gerando ? 'Montando…' : 'A IA transforma o comentário do cliente numa lista clara de mudanças.'}</p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ histórico

const ROTULO_EVENTO: Record<string, string> = {
  ajuste_cliente: 'Cliente pediu ajuste',
  aprovado_cliente: 'Cliente aprovou',
  checklist_ia: 'Checklist da IA',
  comentario: 'Comentário',
  etapa: 'Etapa',
}

function Historico({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const [texto, setTexto] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [aberto, setAberto] = React.useState(false)
  const eventos = demanda.eventos ?? []

  const comentar = async () => {
    if (!texto.trim()) return
    setSalvando(true)
    try {
      onMudou(await gestaoClientes.comentarNaArte(demanda.id, texto.trim()))
      setTexto('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="rounded-xl border border-line p-3">
      <button type="button" onClick={() => setAberto((x) => !x)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <History className="h-4 w-4 text-foreground/50" /> Histórico e comentários
          <span className="text-xs font-normal text-foreground/45">{eventos.length}</span>
        </span>
        <span className="text-xs text-accent">{aberto ? 'Fechar' : 'Ver'}</span>
      </button>
      {aberto && (
        <div className="mt-2 space-y-2">
          {eventos.length === 0 && <p className="text-xs text-foreground/45">Nada ainda.</p>}
          <ul className="max-h-60 space-y-1.5 overflow-y-auto">
            {eventos.map((e) => (
              <li key={e.id} className="text-xs">
                <span className="text-foreground/40">{dataHoraCurta(e.created_at)} · {e.autor_nome || 'Sistema'} · </span>
                <span className={cn('font-medium', e.tipo === 'ajuste_cliente' ? 'text-danger' : e.tipo === 'aprovado_cliente' ? 'text-success' : 'text-foreground/70')}>
                  {ROTULO_EVENTO[e.tipo] ?? e.tipo}
                </span>
                {e.texto && <p className="mt-0.5 whitespace-pre-wrap text-foreground/75">{e.texto}</p>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void comentar() }}
              placeholder="Escreva um comentário pra equipe…"
              className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
            />
            <Button size="sm" variant="secondary" loading={salvando} leftIcon={<MessageSquare className="h-3.5 w-3.5" />} onClick={() => void comentar()}>
              Comentar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ postagem agendada

const FORMATOS_POST: { valor: GcSocialAgendamento['formato']; rotulo: string }[] = [
  { valor: 'feed', rotulo: 'Feed (foto ou carrossel)' },
  { valor: 'reels', rotulo: 'Reels' },
  { valor: 'story', rotulo: 'Story (só Instagram)' },
]

/** Valor do <input type="datetime-local"> pra uma data (no fuso de quem está vendo). */
export function campoDataHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A legenda que já está nos detalhes ("Legenda: ..."), pra não digitar de novo. */
export function legendaDosDetalhes(descricao: string): string {
  const m = descricao.match(/legenda:\s*\n?([\s\S]+)$/i)
  return m ? m[1].trim() : ''
}

const dataHoraBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function PublicacaoDoCard({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const ag = demanda.agendamento ?? null
  const [editando, setEditando] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [gerando, setGerando] = React.useState(false)
  const [redes, setRedes] = React.useState<GcRedeSocial[]>(['instagram'])
  const [formato, setFormato] = React.useState<GcSocialAgendamento['formato']>('feed')
  const [quando, setQuando] = React.useState('')
  const [legenda, setLegenda] = React.useState('')
  const midias = midiasFinais(demanda)
  const temMidia = midias.length > 0

  const abrirForm = () => {
    const proxima = new Date(Date.now() + 60 * 60_000)
    proxima.setMinutes(0, 0, 0)
    setRedes(ag?.redes ?? ['instagram'])
    setFormato(ag?.formato ?? (midias.some((a) => a.type.startsWith('video/')) ? 'reels' : 'feed'))
    setQuando(ag && ag.status !== 'publicado' ? campoDataHora(new Date(ag.agendado_para)) : campoDataHora(proxima))
    setLegenda(ag?.legenda || legendaDosDetalhes(demanda.descricao))
    setEditando(true)
  }

  const gerarLegenda = async () => {
    setGerando(true)
    try {
      setLegenda((await gestaoClientes.iaLegenda(demanda.id)).legenda)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGerando(false)
    }
  }

  const agendar = async (agora: boolean) => {
    if (redes.length === 0) return toast.error('Escolha Instagram e/ou Facebook')
    if (!agora && !quando) return toast.error('Escolha a data e a hora')
    setSalvando(true)
    try {
      const r = await gestaoClientes.agendarPostagem(demanda.id, {
        redes, formato, legenda, agendado_para: agora ? new Date().toISOString() : new Date(quando).toISOString(),
      })
      onMudou(r)
      setEditando(false)
      toast.success(agora ? 'Publicando em até 1 minuto' : 'Postagem agendada')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const cancelar = async () => {
    if (!ag || !window.confirm('Cancelar este agendamento?')) return
    try {
      onMudou(await gestaoClientes.cancelarAgendamento(ag.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const alternarRede = (r: GcRedeSocial) => setRedes((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))
  const nomeRede = (r: GcRedeSocial) => (r === 'instagram' ? 'Instagram' : 'Facebook')

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Send className="h-4 w-4 text-accent" /> Publicação
        </p>
        {!editando && (!ag || ag.status === 'publicado' || ag.status === 'erro') && (
          <Button size="sm" variant="secondary" disabled={!temMidia} title={temMidia ? undefined : 'Anexe a arte final primeiro'} leftIcon={<CalendarClock className="h-3.5 w-3.5" />} onClick={abrirForm}>
            {ag?.status === 'erro' ? 'Tentar de novo' : ag?.status === 'publicado' ? 'Agendar outra' : 'Agendar postagem'}
          </Button>
        )}
      </div>

      {!editando && !ag && (
        <p className="text-xs text-foreground/45">
          {temMidia ? 'Agende o post no Instagram e/ou Facebook com a arte final.' : 'Anexe a arte final (imagem ou vídeo) pra poder agendar.'}
        </p>
      )}

      {!editando && ag && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              ag.status === 'publicado' ? 'bg-success/15 text-success' : ag.status === 'erro' ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent',
            )}>
              {ag.status === 'agendado' ? 'Agendado' : ag.status === 'publicando' ? 'Publicando…' : ag.status === 'publicado' ? 'Publicado' : 'Erro ao publicar'}
            </span>
            <span className="text-foreground/70">
              {ag.status === 'publicado' && ag.publicado_em ? dataHoraBr(ag.publicado_em) : dataHoraBr(ag.agendado_para)}
              {' · '}{ag.redes.map(nomeRede).join(' + ')} · {FORMATOS_POST.find((f) => f.valor === ag.formato)?.rotulo.split(' ')[0]}
            </span>
          </div>
          {ag.redes.map((r) => ag.resultado?.[r]?.link && (
            <a key={r} href={ag.resultado[r]!.link} target="_blank" rel="noopener noreferrer" className="mr-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <ExternalLink className="h-3 w-3" /> Ver no {nomeRede(r)}
            </a>
          ))}
          {ag.erro && <p className="rounded-lg bg-danger/5 px-2.5 py-1.5 text-xs text-danger">{ag.erro}</p>}
          {ag.status === 'agendado' && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={abrirForm}>Alterar</Button>
              <Button size="sm" variant="ghost" onClick={() => void cancelar()}>Cancelar agendamento</Button>
            </div>
          )}
        </div>
      )}

      {editando && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(['instagram', 'facebook'] as GcRedeSocial[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => alternarRede(r)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  redes.includes(r) ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:text-foreground',
                )}
              >
                {nomeRede(r)}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Formato"
              options={FORMATOS_POST.map((f) => ({ value: f.valor, label: f.rotulo }))}
              value={formato}
              onChange={(e) => setFormato(e.target.value as GcSocialAgendamento['formato'])}
            />
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground/70">Data e hora</label>
              <input
                type="datetime-local"
                value={quando}
                min={campoDataHora(new Date())}
                onChange={(e) => setQuando(e.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground focus:border-accent/60 focus:outline-none"
              />
            </div>
          </div>
          {formato !== 'story' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/70">Legenda</span>
                <Button size="sm" variant="ghost" loading={gerando} leftIcon={<Sparkles className="h-3 w-3" />} onClick={() => void gerarLegenda()}>
                  Gerar legenda
                </Button>
              </div>
              <Textarea rows={5} value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Texto que vai junto do post, com hashtags." />
            </div>
          )}
          <p className="text-[11px] text-foreground/45">Vai com a arte final, na ordem. Mais de uma imagem no Feed vira carrossel (até 10).</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditando(false)}>Cancelar</Button>
            <Button variant="secondary" size="sm" loading={salvando} onClick={() => void agendar(true)}>Publicar agora</Button>
            <Button size="sm" loading={salvando} leftIcon={<CalendarClock className="h-3.5 w-3.5" />} onClick={() => void agendar(false)}>Agendar</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ o painel inteiro

/** O próximo passo do card, como um botão grande: é o que a pessoa costuma fazer em seguida. */
function ProximoPasso({ demanda, clienteId, onMover, onMudou }: {
  demanda: GcSocialProducao; clienteId: string; onMover: (s: GcSocialStatus) => void; onMudou: (d: GcSocialProducao) => void
}) {
  const [enviando, setEnviando] = React.useState(false)
  const temArte = imagensFinais(demanda).length > 0

  const mandarProCliente = async () => {
    setEnviando(true)
    try {
      const r = await gestaoClientes.enviarParaAprovacao(clienteId, [demanda.id])
      const url = enderecoDoPortal(r.token, 'artes')
      const ok = await copiar(url)
      onMudou({ ...demanda, status: 'com_cliente', ajuste_pedido: false, enviado_cliente_em: new Date().toISOString() })
      toast.success(ok ? 'Enviada pro cliente. Link do portal copiado: cole no WhatsApp dele.' : `Enviada pro cliente. Link: ${url}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  switch (demanda.status) {
    case 'para_producao':
      return <Button size="sm" variant="secondary" onClick={() => onMover('em_producao')}>Começar a criar</Button>
    case 'em_producao':
      return (
        <Button size="sm" disabled={!temArte} title={temArte ? undefined : 'Anexe a arte final primeiro'} onClick={() => onMover('revisao')}>
          Arte pronta: mandar pra revisão
        </Button>
      )
    case 'revisao':
      return (
        <Button size="sm" loading={enviando} disabled={!temArte} leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => void mandarProCliente()}>
          Enviar pro cliente aprovar
        </Button>
      )
    case 'com_cliente':
      return (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={enviando} leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void mandarProCliente()}>
            Copiar link de aprovação
          </Button>
          <Button size="sm" onClick={() => onMover('aprovado')}>Cliente aprovou (marcar)</Button>
        </div>
      )
    case 'aprovado':
      return <Button size="sm" variant="secondary" onClick={() => onMover('trafego')}>Já está no tráfego</Button>
    default:
      return null
  }
}

export function DetalheDaArte({ demanda, clienteId, onMover, onMudou }: {
  demanda: GcSocialProducao
  clienteId: string
  onMover: (status: GcSocialStatus) => void
  onMudou: (d: GcSocialProducao) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {ETAPAS_ARTE.map((c) => (
          <button
            key={c.valor}
            type="button"
            title={c.ajuda}
            onClick={() => onMover(c.valor)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              demanda.status === c.valor ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/55 hover:border-accent/40 hover:text-foreground',
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', c.cor)} />
            {c.titulo}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-foreground/60">
          <span className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> {demanda.editor_nome ?? 'Sem editor'}</span>
          <span className="flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> {demanda.prazo ? `Prazo ${dataBr(demanda.prazo)}` : 'Sem prazo'}</span>
          <label className="flex items-center gap-1.5">
            Mês
            <select
              value={demanda.mes}
              onChange={async (e) => {
                try {
                  onMudou(await gestaoClientes.atualizarSocialProducao(demanda.id, { mes: e.target.value }))
                } catch (err) {
                  toast.error((err as Error).message)
                }
              }}
              className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-foreground"
              aria-label="Mês da arte"
            >
              {opcoesDeMes([demanda.mes]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          {demanda.aprovado_em && (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> Aprovada{demanda.aprovado_por ? ` por ${demanda.aprovado_por}` : ''} em {dataBr(demanda.aprovado_em)}
            </span>
          )}
        </div>
        <ProximoPasso demanda={demanda} clienteId={clienteId} onMover={onMover} onMudou={onMudou} />
      </div>

      <AjusteDoCliente demanda={demanda} onMudou={onMudou} />

      {demanda.descricao.trim() ? (
        <div className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-elevate/[0.02] p-4 text-sm leading-relaxed text-foreground/85">
          {demanda.descricao}
        </div>
      ) : (
        <p className="text-sm text-foreground/45">Sem detalhes da arte. Clique em Editar pra escrever.</p>
      )}

      <AnexosDoCard demanda={demanda} papel="final" onMudou={onMudou} colarAqui />
      <AnexosDoCard demanda={demanda} papel="referencia" onMudou={onMudou} />

      {(demanda.status === 'em_producao' || demanda.status === 'revisao' || demanda.status === 'com_cliente' || demanda.revisao_ia) && (
        <RevisaoDaIa demanda={demanda} onMudou={onMudou} />
      )}

      <PublicacaoDoCard demanda={demanda} onMudou={onMudou} />
      <Historico demanda={demanda} onMudou={onMudou} />
      <p className="text-[11px] text-foreground/35">
        {nomeDoMes(demanda.mes)}{demanda.criado_por_nome ? ` · pedida por ${demanda.criado_por_nome}` : ''}
      </p>
    </div>
  )
}
