import * as React from 'react'
import { createPortal } from 'react-dom'
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import {
  AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Copy, ExternalLink, FileDown, FileText, FolderOpen, ImagePlus, Link2, Loader2,
  MessageCircle, Paperclip, Pencil, Plus, Send, ShieldCheck, Sparkles, Trash2, UserRound, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import { useKanbanSensors } from '@/hooks/useKanbanSensors'
import { gestaoClientes, type GcSocialMaterial, type GcSocialProducao, type GcSocialStatus } from '@/services/gestaoClientes'
import {
  ETAPAS_ARTE, MAX_BYTES, copiar, enderecoDoPortal, imagensFinais, lerArquivo, mesDeHoje, nomeDoMes, opcoesDeMes, somarMes,
} from '@/lib/socialArtes'
import { cn } from '@/lib/utils'
import { DetalheDaArte } from './social/DetalheDaArte'
import { ModalPostarTodas } from './social/ModalPostarTodas'

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const hojeISO = () => new Date().toISOString().slice(0, 10)
type Coluna = (typeof ETAPAS_ARTE)[number]

/** A coluna do quadro — é o alvo onde o card é solto. O "+" sobe uma arte pronta direto nesta etapa. */
function ColunaProducao({ col, total, onSubirArte, acao, children }: {
  col: Coluna; total: number; onSubirArte: (arquivos: File[]) => void; acao?: React.ReactNode; children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.valor}`, data: { status: col.valor } })
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <div
      ref={setNodeRef}
      className={cn('flex min-w-0 flex-col rounded-2xl border bg-elevate/[0.025] transition-colors', isOver ? 'border-accent/60 bg-accent/[0.04]' : 'border-line')}
    >
      <header className="flex items-center justify-between gap-1 px-3 py-2.5">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground" title={col.ajuda}>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', col.cor)} />
          <span className="truncate">{col.titulo}</span>
        </h3>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-accent"
            title={`Subir arte pronta direto em ${col.titulo}`}
            aria-label={`Subir arte pronta em ${col.titulo}`}
          >
            <ImagePlus className="h-3.5 w-3.5" />
          </button>
          <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">{total}</span>
        </span>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            onSubirArte(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </header>
      {acao && <div className="px-2 pb-1.5">{acao}</div>}
      <div className="min-h-[80px] flex-1 space-y-1.5 px-2 pb-2">{children}</div>
    </div>
  )
}

function CartaoArrastavel({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('touch-manipulation', isDragging && 'opacity-30')}>
      {children}
    </div>
  )
}

/** A primeira linha útil dos detalhes (o formato da arte, normalmente), sem emoji na frente. */
function resumoDaArte(descricao: string): string {
  const linha = descricao.split('\n').map((l) => l.trim()).find((l) => l && !/^texto da arte:?$/i.test(l)) ?? ''
  return linha.replace(/^[^\p{L}\p{N}]+/u, '')
}

/** Card compacto: miniatura da arte final, título, selos (ajuste, IA, aprovado), editor e prazo. */
function CartaoProducao({ p, onAbrir, onExcluir, sobreposto }: {
  p: GcSocialProducao; onAbrir?: () => void; onExcluir?: () => void; sobreposto?: boolean
}) {
  const fechada = p.status === 'aprovado' || p.status === 'trafego'
  const atrasada = p.prazo && p.prazo < hojeISO() && !fechada && p.status !== 'com_cliente'
  const resumo = resumoDaArte(p.descricao)
  const capa = imagensFinais(p)[0]
  const nFinais = imagensFinais(p).length
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir?.() }}
      className={cn(
        'group relative block w-full cursor-grab overflow-hidden rounded-xl border bg-surface text-left shadow-sm transition-colors hover:border-accent/40 active:cursor-grabbing',
        p.ajuste_pedido ? 'border-danger/50' : 'border-line',
        sobreposto && 'shadow-lg ring-1 ring-accent/30',
      )}
    >
      {capa && (
        <div className="relative">
          <img src={capa.dataUrl} alt="" className="h-24 w-full object-cover" />
          {nFinais > 1 && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{nFinais} imagens</span>}
        </div>
      )}
      {onExcluir && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onExcluir() }}
          className="absolute right-1.5 top-1.5 rounded-md bg-surface/90 p-1 text-foreground/40 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 max-sm:opacity-100"
          aria-label="Excluir demanda"
          title="Excluir"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="px-3 py-2">
        {(p.ajuste_pedido || p.revisao_ia || (fechada && p.aprovado_por) || (p.status === 'aprovado' && !p.visto_trafego_em)) && (
          <div className="mb-1 flex flex-wrap gap-1">
            {p.ajuste_pedido && (
              <span className="flex items-center gap-0.5 rounded bg-danger/10 px-1.5 py-px text-[10px] font-semibold text-danger">
                <AlertTriangle className="h-2.5 w-2.5" /> Ajuste pedido
              </span>
            )}
            {p.revisao_ia && !fechada && (
              <span
                className={cn('flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] font-medium', p.revisao_ia.ok ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning')}
                title={p.revisao_ia.resumo}
              >
                <ShieldCheck className="h-2.5 w-2.5" /> {p.revisao_ia.ok ? 'IA ok' : `IA: ${p.revisao_ia.problemas.length} ponto${p.revisao_ia.problemas.length === 1 ? '' : 's'}`}
              </span>
            )}
            {p.status === 'aprovado' && !p.visto_trafego_em && (
              <span className="rounded bg-accent/10 px-1.5 py-px text-[10px] font-semibold text-accent">Nova pro tráfego</span>
            )}
            {fechada && p.aprovado_por && (
              <span className="rounded bg-success/10 px-1.5 py-px text-[10px] text-success">✓ {p.aprovado_por}</span>
            )}
          </div>
        )}
        <p className="line-clamp-2 pr-5 text-[13px] font-medium leading-snug text-foreground">{p.titulo}</p>
        {resumo && resumo !== p.titulo && !capa && <p className="mt-0.5 truncate text-[11px] text-foreground/45">{resumo}</p>}
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className={cn('flex min-w-0 items-center gap-1 truncate', p.editor_nome ? 'text-accent' : 'text-foreground/35')}>
            <UserRound className="h-3 w-3 shrink-0" />
            <span className="truncate">{p.editor_nome ?? 'Sem editor'}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {p.agendamento && (
              <span
                className={cn('flex items-center gap-0.5', p.agendamento.status === 'publicado' ? 'text-success' : p.agendamento.status === 'erro' ? 'font-medium text-danger' : 'text-accent')}
                title={p.agendamento.status === 'erro' ? p.agendamento.erro ?? 'Erro ao publicar' : 'Postagem'}
              >
                <Send className="h-3 w-3" />
                {p.agendamento.status === 'publicado' ? 'publicado'
                  : p.agendamento.status === 'erro' ? 'erro'
                    : new Date(p.agendamento.agendado_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {!capa && (p.anexos?.length ?? 0) > 0 && (
              <span className="flex items-center gap-0.5 text-foreground/45" title="Imagens de referência">
                <Paperclip className="h-3 w-3" /> {p.anexos!.length}
              </span>
            )}
            {p.prazo && (
              <span className={cn('flex items-center gap-1 text-foreground/45', atrasada && 'font-medium text-danger')}>
                <CalendarClock className="h-3 w-3" /> {dataBr(p.prazo).slice(0, 5)}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ mês

/** "‹ Novembro 2026 ›" + "Todos os meses". A equipe trabalha por mês: abre sempre no mês de hoje. */
function NavegadorDeMes({ mes, onChange, contagem }: { mes: string | null; onChange: (m: string | null) => void; contagem: (m: string | null) => number }) {
  const hoje = mesDeHoje()
  const atual = mes ?? hoje
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className={cn('flex items-center rounded-xl border bg-surface', mes ? 'border-accent/40' : 'border-line opacity-60')}>
        <button type="button" onClick={() => onChange(somarMes(atual, -1))} className="rounded-l-xl p-1.5 text-foreground/55 hover:bg-elevate/[0.05]" aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onChange(atual)} className="min-w-[9.5rem] px-2 text-center text-sm font-semibold text-foreground">
          {nomeDoMes(atual)}
          <span className="ml-1.5 rounded-full bg-accent/10 px-1.5 text-[11px] font-medium text-accent">{contagem(atual)}</span>
        </button>
        <button type="button" onClick={() => onChange(somarMes(atual, 1))} className="rounded-r-xl p-1.5 text-foreground/55 hover:bg-elevate/[0.05]" aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {mes !== hoje && (
        <button type="button" onClick={() => onChange(hoje)} className="h-8 rounded-lg px-2 text-xs text-accent hover:bg-accent/10">Este mês</button>
      )}
      <button
        type="button"
        onClick={() => onChange(mes ? null : hoje)}
        className={cn('h-8 rounded-lg border px-2.5 text-xs transition-colors', !mes ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-line text-foreground/60 hover:text-foreground')}
      >
        {mes ? `Ver todos os meses (${contagem(null)})` : 'Todos os meses'}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------ PDF das artes

function ModalPdfArtes({ aberto, onFechar, clienteId, demandas, periodo, onMudou }: {
  aberto: boolean; onFechar: () => void; clienteId: string; demandas: GcSocialProducao[]; periodo: string; onMudou: () => void
}) {
  const comImagem = demandas.filter((d) => imagensFinais(d).length > 0)
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  const [textos, setTextos] = React.useState<Record<string, { titulo: string; texto: string }>>({})
  const [marcarEnviado, setMarcarEnviado] = React.useState(true)
  const [gerando, setGerando] = React.useState(false)

  // Ao abrir: marca as que ainda não foram aprovadas (é o PDF que vai pro cliente aprovar).
  React.useEffect(() => {
    if (!aberto) return
    const pendentes = comImagem.filter((d) => d.status !== 'aprovado' && d.status !== 'trafego')
    setMarcados(new Set((pendentes.length ? pendentes : comImagem).map((d) => d.id)))
    setTextos(Object.fromEntries(comImagem.map((d) => [d.id, { titulo: d.titulo.replace(/^(arte|reels|criativo)\s*:\s*/i, ''), texto: '' }])))
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps

  const gerar = async () => {
    const itens = comImagem.filter((d) => marcados.has(d.id)).map((d) => ({ id: d.id, ...textos[d.id] }))
    if (itens.length === 0) return toast.error('Marque ao menos uma arte')
    setGerando(true)
    try {
      const blob = await gestaoClientes.pdfDoSocial(clienteId, { periodo, itens, marcar_enviado: marcarEnviado })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `social-media${periodo ? `-${periodo.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}` : ''}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      if (marcarEnviado) onMudou()
      onFechar()
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setGerando(false)
    }
  }

  const paginas = comImagem.filter((d) => marcados.has(d.id)).reduce((s, d) => s + imagensFinais(d).length, 0)

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="xl"
      title="PDF das artes"
      description={`Capa "Social media" com a logo da NX e uma página por arte final${periodo ? ` · ${periodo}` : ''}.`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-foreground/70">
            <input type="checkbox" checked={marcarEnviado} onChange={(e) => setMarcarEnviado(e.target.checked)} className="h-4 w-4 accent-[#4F8EF7]" />
            Mover as marcadas pra "Com o cliente"
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground/50">{paginas} página{paginas === 1 ? '' : 's'} + capa</span>
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button loading={gerando} disabled={paginas === 0} leftIcon={<FileDown className="h-4 w-4" />} onClick={() => void gerar()}>Baixar PDF</Button>
          </div>
        </div>
      }
    >
      {comImagem.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/55">
          Nenhuma demanda {periodo ? 'desse mês ' : ''}tem arte final anexada. Abra o card e use "Adicionar arte final".
        </p>
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {comImagem.map((d) => {
            const imagens = imagensFinais(d)
            const marcado = marcados.has(d.id)
            const t = textos[d.id] ?? { titulo: d.titulo, texto: '' }
            return (
              <li key={d.id} className={cn('rounded-xl border p-3', marcado ? 'border-accent/40' : 'border-line opacity-60')}>
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => setMarcados((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}
                    className="mt-1 h-4 w-4 shrink-0 accent-[#4F8EF7]"
                    aria-label={`Incluir ${d.titulo}`}
                  />
                  <div className="flex shrink-0 gap-1">
                    {imagens.slice(0, 3).map((a) => <img key={a.id} src={a.dataUrl} alt="" className="h-16 w-14 rounded-md object-cover" />)}
                    {imagens.length > 3 && <span className="flex h-16 w-8 items-center justify-center text-xs text-foreground/45">+{imagens.length - 3}</span>}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        value={t.titulo}
                        onChange={(e) => setTextos((x) => ({ ...x, [d.id]: { ...t, titulo: e.target.value } }))}
                        disabled={!marcado}
                        placeholder="Título da página (ex.: Tráfego pago)"
                        className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm font-medium"
                      />
                      <span className="shrink-0 text-[10px] text-foreground/45">{ETAPAS_ARTE.find((e) => e.valor === d.status)?.titulo}</span>
                    </div>
                    <textarea
                      value={t.texto}
                      onChange={(e) => setTextos((x) => ({ ...x, [d.id]: { ...t, texto: e.target.value } }))}
                      disabled={!marcado}
                      rows={2}
                      placeholder="O que foi feito nessa arte (aparece ao lado da imagem). Opcional."
                      className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ enviar pro cliente aprovar

function ModalEnviarAprovacao({ aberto, onFechar, clienteId, demandas, onMudou }: {
  aberto: boolean; onFechar: () => void; clienteId: string; demandas: GcSocialProducao[]; onMudou: () => void
}) {
  const candidatas = demandas.filter((d) => imagensFinais(d).length > 0 && ['em_producao', 'revisao', 'com_cliente'].includes(d.status))
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  const [enviando, setEnviando] = React.useState(false)
  const [link, setLink] = React.useState('')

  React.useEffect(() => {
    if (!aberto) return
    setLink('')
    setMarcados(new Set(candidatas.filter((d) => d.status === 'revisao').map((d) => d.id)))
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps

  const enviar = async () => {
    if (marcados.size === 0) return toast.error('Marque ao menos uma arte')
    setEnviando(true)
    try {
      const r = await gestaoClientes.enviarParaAprovacao(clienteId, [...marcados])
      const url = enderecoDoPortal(r.token, 'artes')
      setLink(url)
      await copiar(url)
      onMudou()
      toast.success(`${r.enviadas} arte${r.enviadas === 1 ? '' : 's'} no portal do cliente. Link copiado.`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const mensagem = `Oi! As artes novas estão prontas pra você aprovar. É só abrir o link, olhar cada uma e tocar em Aprovar ou Pedir ajuste: ${link}`

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="lg"
      title="Enviar pro cliente aprovar"
      description="As artes marcadas vão pro portal do cliente. Ele aprova ou pede ajuste em cada uma, e o quadro muda sozinho."
      footer={
        link ? (
          <div className="flex justify-end"><Button onClick={onFechar}>Pronto</Button></div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-foreground/50">{marcados.size} marcada{marcados.size === 1 ? '' : 's'}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
              <Button loading={enviando} disabled={marcados.size === 0} leftIcon={<Send className="h-4 w-4" />} onClick={() => void enviar()}>Enviar e copiar link</Button>
            </div>
          </div>
        )
      }
    >
      {link ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground/75">Mande este link pro cliente (já está copiado):</p>
          <div className="flex gap-2">
            <input readOnly value={link} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-elevate/[0.03] px-3 text-sm text-foreground" onFocus={(e) => e.target.select()} />
            <Button variant="secondary" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void copiar(link).then(() => toast.success('Copiado'))}>Copiar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#25D366] px-3 text-sm font-medium text-white hover:opacity-90"
            >
              <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp com a mensagem
            </a>
            <Button variant="ghost" size="sm" leftIcon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copiar(mensagem).then(() => toast.success('Mensagem copiada'))}>
              Copiar a mensagem
            </Button>
            <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1 px-2 text-sm text-accent hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Ver como o cliente vê
            </a>
          </div>
        </div>
      ) : candidatas.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/55">
          Nenhuma arte com arte final em criação ou revisão neste mês. Anexe a arte final no card primeiro.
        </p>
      ) : (
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {candidatas.map((d) => {
            const marcado = marcados.has(d.id)
            return (
              <li key={d.id}>
                <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-2.5', marcado ? 'border-accent/40 bg-accent/[0.03]' : 'border-line')}>
                  <input
                    type="checkbox"
                    checked={marcado}
                    onChange={() => setMarcados((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n })}
                    className="h-4 w-4 shrink-0 accent-[#4F8EF7]"
                  />
                  <img src={imagensFinais(d)[0].dataUrl} alt="" className="h-14 w-12 shrink-0 rounded-md object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{d.titulo}</span>
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-foreground/50">
                      {ETAPAS_ARTE.find((e) => e.valor === d.status)?.titulo}
                      {d.revisao_ia && (
                        <span className={d.revisao_ia.ok ? 'text-success' : 'text-warning'}>
                          {d.revisao_ia.ok ? '· IA ok' : `· IA apontou ${d.revisao_ia.problemas.length} ponto(s)`}
                        </span>
                      )}
                      {d.status === 'com_cliente' && <span>· reenviar</span>}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ o espaço de social media

interface FormProducao {
  id?: string
  titulo: string
  descricao: string
  status: GcSocialStatus
  editor: string
  prazo: string
  mes: string
}

const CHAVE_MES = 'nx-social-mes'
const lerMesSalvo = (): string | null | undefined => {
  try {
    const v = sessionStorage.getItem(CHAVE_MES)
    return v === null ? undefined : v === 'todos' ? null : v
  } catch {
    return undefined
  }
}

/**
 * O espaço de social media de UM cliente: o quadro da produção em 6 etapas (pedido → criação → revisão →
 * com o cliente → aprovado → no tráfego), separado por mês, os links (Drive etc.) e as fotos e arquivos.
 */
export function SocialDoCliente({ clienteId }: { clienteId: string }) {
  const { data: perfis } = useTeamProfiles()
  const [materiais, setMateriais] = React.useState<GcSocialMaterial[]>([])
  const [producao, setProducao] = React.useState<GcSocialProducao[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [form, setForm] = React.useState<FormProducao | null>(null)
  const [ideia, setIdeia] = React.useState('')
  const [montandoPedido, setMontandoPedido] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [linkAberto, setLinkAberto] = React.useState(false)
  const [linkTitulo, setLinkTitulo] = React.useState('')
  const [linkUrl, setLinkUrl] = React.useState('')
  const [ampliado, setAmpliado] = React.useState<GcSocialMaterial | null>(null)
  const [enviando, setEnviando] = React.useState(false)
  const inputArquivo = React.useRef<HTMLInputElement>(null)

  const carregar = React.useCallback(async () => {
    try {
      const r = await gestaoClientes.social(clienteId)
      setMateriais(r.materiais)
      setProducao(r.producao)
    } catch (err) {
      toast.error('Falha ao carregar: ' + (err as Error).message)
    } finally {
      setCarregando(false)
    }
  }, [clienteId])

  React.useEffect(() => { void carregar() }, [carregar])

  const agir = async (fn: () => Promise<unknown>, falha = 'Falha ao salvar: ') => {
    try {
      await fn()
      await carregar()
    } catch (err) {
      toast.error(falha + (err as Error).message)
    }
  }

  const sensors = useKanbanSensors()
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [vendoId, setVendoId] = React.useState<string | null>(null)
  const vendo = vendoId ? producao.find((p) => p.id === vendoId) ?? null : null
  // Mês aberto (null = todos). Abre no mês de hoje; volta pro último escolhido enquanto a aba do navegador estiver aberta.
  const [mes, setMesState] = React.useState<string | null>(() => {
    const salvo = lerMesSalvo()
    return salvo === undefined ? mesDeHoje() : salvo
  })
  const setMes = (m: string | null) => {
    setMesState(m)
    try { sessionStorage.setItem(CHAVE_MES, m ?? 'todos') } catch { /* sem storage */ }
  }
  const [pdfAberto, setPdfAberto] = React.useState(false)
  const [aprovacaoAberta, setAprovacaoAberta] = React.useState(false)
  const [postarAberto, setPostarAberto] = React.useState(false)
  const doMes = (m: string | null) => (m ? producao.filter((p) => p.mes === m) : producao)
  const producaoNoPeriodo = doMes(mes)
  const rotuloPeriodo = mes ? nomeDoMes(mes) : ''
  const ajustes = producaoNoPeriodo.filter((p) => p.ajuste_pedido).length
  const paraRevisar = producaoNoPeriodo.filter((p) => p.status === 'revisao').length

  const trocarCard = React.useCallback((atualizada: GcSocialProducao) => {
    setProducao((lista) => lista.map((p) => (p.id === atualizada.id ? { ...p, ...atualizada } : p)))
  }, [])

  /** Muda a etapa na tela na hora e grava; se o servidor recusar, recarrega o que vale. */
  const mover = async (id: string, status: GcSocialStatus) => {
    const atual = producao.find((p) => p.id === id)
    if (!atual || atual.status === status) return
    setProducao((lista) => lista.map((p) => (p.id === id ? { ...p, status } : p)))
    try {
      trocarCard(await gestaoClientes.atualizarSocialProducao(id, { status }))
    } catch (err) {
      toast.error('Falha ao mover: ' + (err as Error).message)
      await carregar()
    }
  }

  const aoSoltar = (e: DragEndEvent) => {
    setArrastando(null)
    const destino = e.over?.data.current?.status as GcSocialStatus | undefined
    if (destino) void mover(String(e.active.id), destino)
  }

  const excluir = async (p: GcSocialProducao) => {
    if (!window.confirm(`Excluir "${p.titulo}"? Os anexos vão junto.`)) return
    setVendoId((v) => (v === p.id ? null : v))
    setProducao((lista) => lista.filter((x) => x.id !== p.id))
    try {
      await gestaoClientes.excluirSocialProducao(p.id)
      toast.success('Demanda excluída')
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
      await carregar()
    }
  }

  /** O "+" da coluna: cada imagem vira um card já naquela etapa, com a imagem como arte final. */
  const subirArtePronta = async (status: GcSocialStatus, arquivos: File[]) => {
    if (arquivos.length === 0) return
    const t = toast.loading('Subindo arte…')
    try {
      for (const arquivo of arquivos) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB`)
          continue
        }
        const titulo = `Arte: ${arquivo.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim() || 'imagem'}`
        const criado = await gestaoClientes.criarSocialProducao(clienteId, { titulo, status, mes: mes ?? mesDeHoje() })
        const { name, type, size, dataUrl } = await lerArquivo(arquivo)
        await gestaoClientes.anexarNaProducao(criado.id, { name, type, size, dataUrl, papel: 'final' })
      }
      await carregar()
      toast.success('Arte adicionada', { id: t })
    } catch (err) {
      toast.error('Falha ao subir: ' + (err as Error).message, { id: t })
    }
  }

  const editar = (p: GcSocialProducao) => {
    setVendoId(null)
    setIdeia('')
    setForm({ id: p.id, titulo: p.titulo, descricao: p.descricao, status: p.status, editor: p.editor_id ?? '', prazo: p.prazo ?? '', mes: p.mes })
  }

  const opcoesEditor = [
    { value: '', label: 'Sem editor' },
    ...(perfis ?? []).map((p) => ({ value: p.id, label: (p.name && p.name.trim()) || p.email })),
  ]

  const montarPedidoComIa = async () => {
    if (!form || !ideia.trim()) return toast.error('Escreva a ideia em poucas palavras')
    setMontandoPedido(true)
    try {
      const r = await gestaoClientes.iaPedidoDaArte(clienteId, ideia.trim())
      setForm((f) => (f ? { ...f, titulo: r.titulo || f.titulo, descricao: r.descricao || f.descricao } : f))
      toast.success('Pedido montado. Confira e ajuste antes de salvar.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setMontandoPedido(false)
    }
  }

  const salvarProducao = async () => {
    if (!form) return
    if (!form.titulo.trim()) return toast.error('Dê um título à demanda')
    setSalvando(true)
    try {
      const dados = {
        titulo: form.titulo.trim(), descricao: form.descricao, status: form.status, editor_id: form.editor || null, prazo: form.prazo || null, mes: form.mes,
      }
      if (form.id) await gestaoClientes.atualizarSocialProducao(form.id, dados)
      else await gestaoClientes.criarSocialProducao(clienteId, dados)
      setForm(null)
      await carregar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const enviarArquivos = async (arquivos: File[]) => {
    if (arquivos.length === 0) return
    setEnviando(true)
    try {
      for (const arquivo of arquivos) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB — use um link do Drive pra arquivos grandes`)
          continue
        }
        await gestaoClientes.criarSocialMaterial(clienteId, { tipo: 'arquivo', anexo: await lerArquivo(arquivo) })
      }
      await carregar()
    } catch (err) {
      toast.error('Falha ao enviar: ' + (err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  const salvarLink = async () => {
    if (!linkTitulo.trim() || !linkUrl.trim()) return toast.error('Preencha o nome e o link')
    const url = /^https?:\/\//i.test(linkUrl.trim()) ? linkUrl.trim() : `https://${linkUrl.trim()}`
    await agir(async () => {
      await gestaoClientes.criarSocialMaterial(clienteId, { tipo: 'link', titulo: linkTitulo.trim(), url })
      setLinkTitulo('')
      setLinkUrl('')
      setLinkAberto(false)
    })
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-foreground/60">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    )
  }

  const links = materiais.filter((m) => m.tipo === 'link')
  const arquivos = materiais.filter((m) => m.tipo === 'arquivo')
  const noTrafego = producaoNoPeriodo.filter((p) => p.status === 'trafego')

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ produção */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Produção</h2>
            <NavegadorDeMes mes={mes} onChange={setMes} contagem={(m) => doMes(m).length} />
            {ajustes > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                <AlertTriangle className="h-3 w-3" /> {ajustes} ajuste{ajustes === 1 ? '' : 's'} pedido{ajustes === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leftIcon={<FileDown className="h-4 w-4" />} onClick={() => setPdfAberto(true)}>
              Gerar PDF das artes
            </Button>
            <Button size="sm" variant="secondary" leftIcon={<Send className="h-4 w-4" />} onClick={() => setAprovacaoAberta(true)}>
              Enviar pro cliente aprovar{paraRevisar > 0 ? ` (${paraRevisar})` : ''}
            </Button>
            <Button
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setIdeia('')
                setForm({ titulo: '', descricao: '', status: 'para_producao', editor: '', prazo: '', mes: mes ?? mesDeHoje() })
              }}
            >
              Nova demanda de produção
            </Button>
          </div>
        </div>
        <DndContext sensors={sensors} onDragStart={(e) => setArrastando(String(e.active.id))} onDragCancel={() => setArrastando(null)} onDragEnd={aoSoltar}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {ETAPAS_ARTE.map((col) => {
              const itens = producaoNoPeriodo
                .filter((p) => p.status === col.valor)
                // Ajuste pedido primeiro: é o que precisa de alguém agora.
                .sort((a, b) => Number(b.ajuste_pedido) - Number(a.ajuste_pedido))
              return (
                <ColunaProducao
                  key={col.valor}
                  col={col}
                  total={itens.length}
                  onSubirArte={(fs) => void subirArtePronta(col.valor, fs)}
                  acao={col.valor === 'trafego' ? (
                    <Button size="sm" className="w-full" leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => setPostarAberto(true)}>
                      Postar todas
                    </Button>
                  ) : undefined}
                >
                  {itens.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-foreground/35">Arraste um card pra cá</p>
                  )}
                  {itens.map((p) => (
                    <CartaoArrastavel key={p.id} id={p.id}>
                      <CartaoProducao p={p} onAbrir={() => setVendoId(p.id)} onExcluir={() => void excluir(p)} />
                    </CartaoArrastavel>
                  ))}
                </ColunaProducao>
              )
            })}
          </div>
          {createPortal(
            <DragOverlay>
              {(() => {
                const p = arrastando ? producao.find((x) => x.id === arrastando) : undefined
                return p ? <div className="w-[85vw] max-w-xs rotate-2 sm:w-[16rem]"><CartaoProducao p={p} sobreposto /></div> : null
              })()}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </section>

      {/* ------------------------------------------------------------ links e drive */}
      <section className="rounded-2xl border border-line p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FolderOpen className="h-4 w-4 text-accent" /> Drive e links
          </h2>
          {!linkAberto && (
            <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setLinkAberto(true)}>Adicionar link</Button>
          )}
        </div>
        {linkAberto && (
          <div className="mb-3 grid gap-2 rounded-xl border border-accent/30 bg-accent/[0.02] p-3 sm:grid-cols-[1fr_2fr_auto]">
            <Input label="Nome" value={linkTitulo} onChange={(e) => setLinkTitulo(e.target.value)} placeholder="Drive do cliente, Pasta de logos…" />
            <Input label="Link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" />
            <div className="flex items-end gap-2">
              <Button variant="ghost" onClick={() => setLinkAberto(false)}>Cancelar</Button>
              <Button onClick={() => void salvarLink()}>Salvar</Button>
            </div>
          </div>
        )}
        {links.length === 0 ? (
          <p className="py-3 text-sm text-foreground/45">Nenhum link ainda. Cole aqui o Drive, o Canva, a pasta de arquivos do cliente…</p>
        ) : (
          <ul className="divide-y divide-line">
            {links.map((l) => (
              <li key={l.id} className="group flex items-center gap-3 py-2">
                <Link2 className="h-4 w-4 shrink-0 text-foreground/40" />
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-foreground hover:text-accent">
                  {l.titulo}
                  <span className="ml-2 text-xs text-foreground/40">{l.url.replace(/^https?:\/\//, '').slice(0, 50)}</span>
                </a>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-foreground/35 hover:text-accent" aria-label="Abrir link">
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => window.confirm('Remover este link?') && void agir(() => gestaoClientes.excluirSocialMaterial(l.id))}
                  className="text-foreground/30 hover:text-danger"
                  aria-label="Remover link"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ fotos e arquivos */}
      <section className="rounded-2xl border border-line p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Paperclip className="h-4 w-4 text-accent" /> Fotos e arquivos do cliente
          </h2>
          <Button variant="secondary" size="sm" loading={enviando} leftIcon={<Plus className="h-4 w-4" />} onClick={() => inputArquivo.current?.click()}>Anexar</Button>
          <input
            ref={inputArquivo}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.zip,.psd,.ai"
            className="hidden"
            onChange={(e) => {
              void enviarArquivos(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>
        {arquivos.length === 0 ? (
          <p className="py-3 text-sm text-foreground/45">Nenhum arquivo ainda. Anexe as fotos e materiais do cliente (até 5MB cada; maiores, use um link do Drive).</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {arquivos.map((m) => (
              <div key={m.id} className="group relative overflow-hidden rounded-xl border border-line">
                {m.anexo?.type?.startsWith('image/') ? (
                  <button type="button" onClick={() => setAmpliado(m)} className="block w-full" title={m.titulo}>
                    <img src={m.anexo.dataUrl} alt={m.titulo} className="h-28 w-full object-cover" />
                  </button>
                ) : (
                  <a href={m.anexo?.dataUrl} download={m.anexo?.name} className="flex h-28 w-full items-center justify-center bg-elevate/[0.03] text-foreground/40" title="Baixar">
                    <FileText className="h-8 w-8" />
                  </a>
                )}
                <div className="flex items-center justify-between gap-1 border-t border-line px-2 py-1.5">
                  <p className="min-w-0 truncate text-[11px] text-foreground/65">{m.titulo}</p>
                  <button
                    type="button"
                    onClick={() => window.confirm('Remover este arquivo?') && void agir(() => gestaoClientes.excluirSocialMaterial(m.id))}
                    className="shrink-0 text-foreground/30 hover:text-danger"
                    aria-label="Remover arquivo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ janelas */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        size="lg"
        title={form?.id ? 'Editar demanda de produção' : 'Nova demanda de produção'}
        footer={
          <div className="flex items-center justify-between gap-2">
            {form?.id ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => {
                  if (!window.confirm('Excluir esta demanda?')) return
                  void agir(() => gestaoClientes.excluirSocialProducao(form.id!)).then(() => setForm(null))
                }}
              >
                Excluir
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              <Button loading={salvando} onClick={() => void salvarProducao()}>Salvar</Button>
            </div>
          </div>
        }
      >
        {form && (
          <div className="space-y-3">
            {!form.id && (
              <div className="rounded-xl border border-accent/30 bg-accent/[0.03] p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-accent" /> Montar o pedido com IA
                </p>
                <div className="flex gap-2 max-sm:flex-col">
                  <input
                    value={ideia}
                    onChange={(e) => setIdeia(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void montarPedidoComIa() }}
                    placeholder='Ex.: "anúncio Black Friday, 20% off em toda a loja, story e feed"'
                    className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
                  />
                  <Button loading={montandoPedido} variant="secondary" leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => void montarPedidoComIa()}>
                    Montar pedido
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-foreground/45">
                  A IA completa formato, texto da arte, referências do briefing e o que funcionou nos anúncios anteriores. Você revisa antes de salvar.
                </p>
              </div>
            )}
            <Input label="O que produzir *" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: 3 criativos de implante, reels de bastidores…" autoFocus={!!form.id} />
            <Textarea label="Detalhes" rows={10} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Referências, texto, formato, onde está o material…" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Select label="Etapa" options={ETAPAS_ARTE.map((c) => ({ value: c.valor, label: c.titulo }))} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as GcSocialStatus })} />
              <Select label="Mês da arte" options={opcoesDeMes([form.mes])} value={form.mes} onChange={(e) => setForm({ ...form, mes: e.target.value })} />
              <Select label="Editor" options={opcoesEditor} value={form.editor} onChange={(e) => setForm({ ...form, editor: e.target.value })} />
              <Input label="Prazo" type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!vendo}
        onClose={() => setVendoId(null)}
        size="xl"
        title={vendo?.titulo}
        footer={
          vendo && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" leftIcon={<Trash2 className="h-4 w-4" />} className="mr-auto text-danger hover:bg-danger/10" onClick={() => void excluir(vendo)}>
                Excluir
              </Button>
              <Button variant="ghost" onClick={() => setVendoId(null)}>Fechar</Button>
              <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => editar(vendo)}>Editar</Button>
            </div>
          )
        }
      >
        {vendo && <DetalheDaArte demanda={vendo} clienteId={clienteId} onMover={(s) => void mover(vendo.id, s)} onMudou={trocarCard} />}
      </Modal>

      <ModalPdfArtes aberto={pdfAberto} onFechar={() => setPdfAberto(false)} clienteId={clienteId} demandas={producaoNoPeriodo} periodo={rotuloPeriodo} onMudou={() => void carregar()} />
      <ModalEnviarAprovacao aberto={aprovacaoAberta} onFechar={() => setAprovacaoAberta(false)} clienteId={clienteId} demandas={producaoNoPeriodo} onMudou={() => void carregar()} />
      <ModalPostarTodas aberto={postarAberto} onFechar={() => setPostarAberto(false)} clienteId={clienteId} cards={noTrafego} mes={mes} onMudou={() => void carregar()} />

      <Modal open={!!ampliado} onClose={() => setAmpliado(null)} size="2xl" title={ampliado?.titulo}>
        {ampliado?.anexo && <img src={ampliado.anexo.dataUrl} alt={ampliado.titulo} className="max-h-[70vh] w-full object-contain" />}
      </Modal>
    </div>
  )
}
