import * as React from 'react'
import { createPortal } from 'react-dom'
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import {
  CalendarClock, ExternalLink, FileDown, FileText, FolderOpen, Link2, Loader2, Paperclip, Pencil, Plus, Send, Trash2, UserRound, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import { useKanbanSensors } from '@/hooks/useKanbanSensors'
import {
  gestaoClientes, type GcRedeSocial, type GcSocialAgendamento, type GcSocialMaterial, type GcSocialProducao, type GcSocialStatus,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

const MAX_BYTES = 5 * 1024 * 1024

const COLUNAS: { valor: GcSocialStatus; titulo: string; ajuda: string; cor: string }[] = [
  { valor: 'para_producao', titulo: 'Para produzir', ajuda: 'Pedidos esperando alguém pegar', cor: 'bg-warning' },
  { valor: 'em_producao', titulo: 'Em produção', ajuda: 'Quem está editando agora', cor: 'bg-accent' },
  { valor: 'pronto', titulo: 'Pronto', ajuda: 'Entregue ou aprovado', cor: 'bg-success' },
]

const dataBr = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')
const hojeISO = () => new Date().toISOString().slice(0, 10)

function lerArquivo(arquivo: File): Promise<{ id: string; name: string; type: string; size: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () =>
      resolve({
        id: crypto.randomUUID(),
        name: arquivo.name || (arquivo.type.startsWith('image/') ? 'imagem.png' : 'arquivo'),
        type: arquivo.type,
        size: arquivo.size,
        dataUrl: leitor.result as string,
      })
    leitor.onerror = reject
    leitor.readAsDataURL(arquivo)
  })
}

/** A coluna do quadro de produção — é o alvo onde o card é solto. */
function ColunaProducao({
  col, total, children,
}: {
  col: (typeof COLUNAS)[number]
  total: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.valor}`, data: { status: col.valor } })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-2xl border bg-elevate/[0.025] transition-colors',
        isOver ? 'border-accent/60 bg-accent/[0.04]' : 'border-line',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground" title={col.ajuda}>
          <span className={cn('h-2 w-2 rounded-full', col.cor)} />
          {col.titulo}
        </h3>
        <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">{total}</span>
      </header>
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

/**
 * Card compacto: título, uma linha do que é a arte, editor e prazo. Clicar abre tudo (os detalhes
 * inteiros e o texto da arte); arrastar move de coluna.
 */
function CartaoProducao({ p, onAbrir, onExcluir, sobreposto }: {
  p: GcSocialProducao; onAbrir?: () => void; onExcluir?: () => void; sobreposto?: boolean
}) {
  const atrasada = p.prazo && p.prazo < hojeISO() && p.status !== 'pronto'
  const resumo = resumoDaArte(p.descricao)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir?.() }}
      className={cn(
        'group relative block w-full cursor-grab rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-sm transition-colors hover:border-accent/40 active:cursor-grabbing',
        sobreposto && 'shadow-lg ring-1 ring-accent/30',
      )}
    >
      {onExcluir && (
        <button
          type="button"
          // Não deixa o clique na lixeira virar arrasto nem abrir o card.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onExcluir() }}
          className="absolute right-1.5 top-1.5 rounded-md p-1 text-foreground/30 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 max-sm:opacity-100"
          aria-label="Excluir demanda"
          title="Excluir"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <p className={cn('line-clamp-2 pr-5 text-[13px] font-medium leading-snug text-foreground', p.status === 'pronto' && 'text-foreground/50 line-through')}>
        {p.titulo}
      </p>
      {resumo && resumo !== p.titulo && <p className="mt-0.5 truncate text-[11px] text-foreground/45">{resumo}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className={cn('flex min-w-0 items-center gap-1 truncate', p.editor_nome ? 'text-accent' : 'text-foreground/35')}>
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">{p.editor_nome ?? 'Sem editor'}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {p.agendamento && (
            <span
              className={cn(
                'flex items-center gap-0.5',
                p.agendamento.status === 'publicado' ? 'text-success' : p.agendamento.status === 'erro' ? 'font-medium text-danger' : 'text-accent',
              )}
              title={p.agendamento.status === 'erro' ? p.agendamento.erro ?? 'Erro ao publicar' : 'Postagem'}
            >
              <Send className="h-3 w-3" />
              {p.agendamento.status === 'publicado' ? 'publicado'
                : p.agendamento.status === 'erro' ? 'erro'
                  : new Date(p.agendamento.agendado_para).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {(p.anexos?.length ?? 0) > 0 && (
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
  )
}

/**
 * Imagens de referência de UMA demanda (a copy e as fotos que ela usa ficam juntas). Anexa pelo botão,
 * arrastando arquivos ou colando um print (Ctrl+V) com a janela aberta. Cada arquivo sobe sozinho.
 */
function ReferenciasDaArte({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const [enviando, setEnviando] = React.useState(false)
  const [ampliada, setAmpliada] = React.useState<string | null>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const anexos = demanda.anexos ?? []

  const enviar = React.useCallback(async (arquivos: File[]) => {
    if (arquivos.length === 0) return
    setEnviando(true)
    try {
      let atual: GcSocialProducao | null = null
      for (const arquivo of arquivos) {
        if (arquivo.size > MAX_BYTES) {
          toast.error(`"${arquivo.name}" passa de 5MB — use um link do Drive pra arquivos grandes`)
          continue
        }
        const { name, type, size, dataUrl } = await lerArquivo(arquivo)
        atual = await gestaoClientes.anexarNaProducao(demanda.id, { name, type, size, dataUrl })
      }
      if (atual) onMudou(atual)
    } catch (err) {
      toast.error('Falha ao anexar: ' + (err as Error).message)
    } finally {
      setEnviando(false)
    }
  }, [demanda.id, onMudou])

  // Colar um print com a janela aberta anexa direto.
  React.useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const arquivos = Array.from(e.clipboardData?.files ?? [])
      if (arquivos.length === 0) return
      e.preventDefault()
      void enviar(arquivos)
    }
    window.addEventListener('paste', aoColar)
    return () => window.removeEventListener('paste', aoColar)
  }, [enviar])

  const remover = async (anexoId: string) => {
    if (!window.confirm('Remover esta imagem?')) return
    try {
      onMudou(await gestaoClientes.removerAnexoDaProducao(demanda.id, anexoId))
    } catch (err) {
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void enviar(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Paperclip className="h-4 w-4 text-accent" /> Imagens de referência
          {anexos.length > 0 && <span className="text-xs font-normal text-foreground/45">{anexos.length}</span>}
        </p>
        <Button size="sm" variant="secondary" loading={enviando} leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
          Adicionar arquivos
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,video/*,.pdf"
          className="hidden"
          onChange={(e) => {
            void enviar(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {anexos.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-foreground/40">
          Arraste as imagens aqui, cole um print (Ctrl+V) ou clique em Adicionar arquivos.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {anexos.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-lg border border-line">
              {a.type.startsWith('image/') ? (
                <button type="button" onClick={() => setAmpliada(a.dataUrl)} className="block w-full" title={a.name}>
                  <img src={a.dataUrl} alt={a.name} className="h-24 w-full object-cover" />
                </button>
              ) : (
                <a href={a.dataUrl} download={a.name} title={`Baixar ${a.name}`} className="flex h-24 w-full flex-col items-center justify-center gap-1 bg-elevate/[0.03] px-2 text-foreground/45">
                  <FileText className="h-6 w-6" />
                  <span className="w-full truncate text-center text-[10px]">{a.name}</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => void remover(a.id)}
                className="absolute right-1 top-1 rounded-md bg-black/55 p-1 text-white opacity-0 transition-opacity hover:bg-danger group-hover:opacity-100 max-sm:opacity-100"
                aria-label="Remover imagem"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {ampliada && (
        <button
          type="button"
          onClick={() => setAmpliada(null)}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          aria-label="Fechar imagem"
        >
          <img src={ampliada} alt="" className="max-h-full max-w-full object-contain" />
        </button>
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
function campoDataHora(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A legenda que a IA já escreveu nos detalhes ("Legenda: ..."), pra não digitar de novo. */
function legendaDosDetalhes(descricao: string): string {
  const m = descricao.match(/legenda:\s*\n?([\s\S]+)$/i)
  return m ? m[1].trim() : ''
}

const dataHoraBr = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/**
 * "Publicação" no card: agenda o post no Instagram e/ou na página do Facebook com as mídias anexadas.
 * Quem publica é o servidor, na hora marcada (a API do Instagram não tem agendamento próprio).
 */
function PublicacaoDoCard({ demanda, onMudou }: { demanda: GcSocialProducao; onMudou: (d: GcSocialProducao) => void }) {
  const ag = demanda.agendamento ?? null
  const [editando, setEditando] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)
  const [redes, setRedes] = React.useState<GcRedeSocial[]>(['instagram'])
  const [formato, setFormato] = React.useState<GcSocialAgendamento['formato']>('feed')
  const [quando, setQuando] = React.useState('')
  const [legenda, setLegenda] = React.useState('')
  const temMidia = (demanda.anexos ?? []).some((a) => /^(image|video)\//.test(a.type))

  const abrirForm = () => {
    const proxima = new Date(Date.now() + 60 * 60_000)
    proxima.setMinutes(0, 0, 0)
    setRedes(ag?.redes ?? ['instagram'])
    setFormato(ag?.formato ?? ((demanda.anexos ?? []).some((a) => a.type.startsWith('video/')) ? 'reels' : 'feed'))
    setQuando(ag && ag.status !== 'publicado' ? campoDataHora(new Date(ag.agendado_para)) : campoDataHora(proxima))
    setLegenda(ag?.legenda || legendaDosDetalhes(demanda.descricao))
    setEditando(true)
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
          <Button size="sm" variant="secondary" disabled={!temMidia} title={temMidia ? undefined : 'Anexe a arte primeiro'} leftIcon={<CalendarClock className="h-3.5 w-3.5" />} onClick={abrirForm}>
            {ag?.status === 'erro' ? 'Tentar de novo' : ag?.status === 'publicado' ? 'Agendar outra' : 'Agendar postagem'}
          </Button>
        )}
      </div>

      {!editando && !ag && (
        <p className="text-xs text-foreground/45">
          {temMidia ? 'Agende o post no Instagram e/ou Facebook com as imagens anexadas acima.' : 'Anexe a arte (imagem ou vídeo) pra poder agendar.'}
        </p>
      )}

      {!editando && ag && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              ag.status === 'publicado' ? 'bg-success/15 text-success'
                : ag.status === 'erro' ? 'bg-danger/10 text-danger'
                  : 'bg-accent/10 text-accent',
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
            <Textarea label="Legenda" rows={5} value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Texto que vai junto do post, com hashtags." />
          )}
          <p className="text-[11px] text-foreground/45">
            Vai com as mídias anexadas no card, na ordem. Mais de uma imagem no Feed vira carrossel (até 10).
          </p>
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

// ------------------------------------------------------------------ filtro por tempo

type FiltroTempo = { tipo: 'tudo' | '7d' | '30d' | 'mes' | 'mes_passado' | 'personalizado'; de: string; ate: string }

const FILTROS_TEMPO: { valor: FiltroTempo['tipo']; rotulo: string }[] = [
  { valor: 'tudo', rotulo: 'Todo o período' },
  { valor: '7d', rotulo: 'Últimos 7 dias' },
  { valor: '30d', rotulo: 'Últimos 30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mes_passado', rotulo: 'Mês passado' },
  { valor: 'personalizado', rotulo: 'Escolher datas' },
]

/** Data ISO → 'YYYY-MM-DD' no fuso de quem está vendo. */
function diaLocal(iso: string | Date): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function limitesDoFiltro(f: FiltroTempo): { de: string; ate: string; rotulo: string } {
  const hoje = new Date()
  const atras = (n: number) => diaLocal(new Date(hoje.getTime() - n * 86_400_000))
  const nomeMes = (d: Date) => {
    const n = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    return n[0].toUpperCase() + n.slice(1)
  }
  switch (f.tipo) {
    case '7d': return { de: atras(6), ate: '', rotulo: 'Últimos 7 dias' }
    case '30d': return { de: atras(29), ate: '', rotulo: 'Últimos 30 dias' }
    case 'mes': {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      return { de: diaLocal(ini), ate: '', rotulo: nomeMes(ini) }
    }
    case 'mes_passado': {
      const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)
      const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0)
      return { de: diaLocal(ini), ate: diaLocal(fim), rotulo: nomeMes(ini) }
    }
    case 'personalizado':
      return {
        de: f.de, ate: f.ate,
        rotulo: f.de || f.ate ? `${f.de ? dataBr(f.de) : '…'} a ${f.ate ? dataBr(f.ate) : 'hoje'}` : '',
      }
    default: return { de: '', ate: '', rotulo: '' }
  }
}

function FiltroPeriodo({ filtro, onChange }: { filtro: FiltroTempo; onChange: (f: FiltroTempo) => void }) {
  const campo = 'h-8 rounded-lg border border-line bg-surface px-2 text-xs text-foreground/75'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={filtro.tipo}
        onChange={(e) => onChange({ ...filtro, tipo: e.target.value as FiltroTempo['tipo'] })}
        aria-label="Filtrar pela data de criação"
        className={campo}
      >
        {FILTROS_TEMPO.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
      </select>
      {filtro.tipo === 'personalizado' && (
        <>
          <input type="date" value={filtro.de} onChange={(e) => onChange({ ...filtro, de: e.target.value })} className={campo} aria-label="De" />
          <span className="text-xs text-foreground/40">até</span>
          <input type="date" value={filtro.ate} onChange={(e) => onChange({ ...filtro, ate: e.target.value })} className={campo} aria-label="Até" />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ PDF das artes

/**
 * Escolhe as artes que entram no PDF de apresentação (só as que têm imagem anexada) e deixa ajustar o
 * título e o texto de cada uma — o texto é o que aparece ao lado da imagem ("Adicionamos o elemento 3D…").
 */
function ModalPdfArtes({ aberto, onFechar, clienteId, demandas, periodo }: {
  aberto: boolean; onFechar: () => void; clienteId: string; demandas: GcSocialProducao[]; periodo: string
}) {
  const comImagem = demandas.filter((d) => (d.anexos ?? []).some((a) => a.type.startsWith('image/')))
  const [marcados, setMarcados] = React.useState<Set<string>>(new Set())
  const [textos, setTextos] = React.useState<Record<string, { titulo: string; texto: string }>>({})
  const [gerando, setGerando] = React.useState(false)

  // Ao abrir: tudo marcado, título sem o "Arte:/Reels:" da frente e texto em branco pra a pessoa escrever.
  React.useEffect(() => {
    if (!aberto) return
    setMarcados(new Set(comImagem.map((d) => d.id)))
    setTextos(Object.fromEntries(comImagem.map((d) => [d.id, { titulo: d.titulo.replace(/^(arte|reels|criativo)\s*:\s*/i, ''), texto: '' }])))
  }, [aberto]) // eslint-disable-line react-hooks/exhaustive-deps

  const gerar = async () => {
    const itens = comImagem.filter((d) => marcados.has(d.id)).map((d) => ({ id: d.id, ...textos[d.id] }))
    if (itens.length === 0) return toast.error('Marque ao menos uma arte')
    setGerando(true)
    try {
      const blob = await gestaoClientes.pdfDoSocial(clienteId, { periodo, itens })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `social-media${periodo ? `-${periodo.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}` : ''}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      onFechar()
    } catch (err) {
      toast.error('Falha ao gerar o PDF: ' + (err as Error).message)
    } finally {
      setGerando(false)
    }
  }

  const paginas = comImagem
    .filter((d) => marcados.has(d.id))
    .reduce((s, d) => s + (d.anexos ?? []).filter((a) => a.type.startsWith('image/')).length, 0)

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="xl"
      title="PDF das artes"
      description={`Capa "Social media" com a logo da NX e uma página por imagem anexada${periodo ? ` · ${periodo}` : ''}.`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-foreground/50">{paginas} página{paginas === 1 ? '' : 's'} de arte + capa</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button loading={gerando} disabled={paginas === 0} leftIcon={<FileDown className="h-4 w-4" />} onClick={() => void gerar()}>
              Baixar PDF
            </Button>
          </div>
        </div>
      }
    >
      {comImagem.length === 0 ? (
        <p className="py-6 text-center text-sm text-foreground/55">
          Nenhuma demanda {periodo ? 'desse período ' : ''}tem imagem anexada. Abra o card e use "Adicionar arquivos" pra anexar a arte.
        </p>
      ) : (
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {comImagem.map((d) => {
            const imagens = (d.anexos ?? []).filter((a) => a.type.startsWith('image/'))
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
                    <input
                      value={t.titulo}
                      onChange={(e) => setTextos((x) => ({ ...x, [d.id]: { ...t, titulo: e.target.value } }))}
                      disabled={!marcado}
                      placeholder="Título da página (ex.: Tráfego pago)"
                      className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm font-medium"
                    />
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

interface FormProducao {
  id?: string
  titulo: string
  descricao: string
  status: GcSocialStatus
  editor: string
  prazo: string
}

/**
 * O espaço de social media de UM cliente: a produção (para produzir / em produção / pronto, com o editor de cada
 * uma), os links (Drive etc.) e as fotos e arquivos que a designer anexa.
 */
export function SocialDoCliente({ clienteId }: { clienteId: string }) {
  const { data: perfis } = useTeamProfiles()
  const [materiais, setMateriais] = React.useState<GcSocialMaterial[]>([])
  const [producao, setProducao] = React.useState<GcSocialProducao[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [form, setForm] = React.useState<FormProducao | null>(null)
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

  React.useEffect(() => {
    void carregar()
  }, [carregar])

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
  const [vendo, setVendo] = React.useState<GcSocialProducao | null>(null)
  const [filtro, setFiltro] = React.useState<FiltroTempo>({ tipo: 'tudo', de: '', ate: '' })
  const [pdfAberto, setPdfAberto] = React.useState(false)
  const limites = limitesDoFiltro(filtro)
  // O filtro olha a data em que a demanda foi CRIADA (dia de São Paulo, como a pessoa vê).
  const producaoNoPeriodo = producao.filter((p) => {
    const dia = diaLocal(p.created_at)
    return (!limites.de || dia >= limites.de) && (!limites.ate || dia <= limites.ate)
  })

  /** Muda a situação na tela na hora e grava; se o servidor recusar, recarrega o que vale. */
  const mover = async (id: string, status: GcSocialStatus) => {
    const atual = producao.find((p) => p.id === id)
    if (!atual || atual.status === status) return
    setProducao((lista) => lista.map((p) => (p.id === id ? { ...p, status } : p)))
    setVendo((v) => (v?.id === id ? { ...v, status } : v))
    try {
      await gestaoClientes.atualizarSocialProducao(id, { status })
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

  /** Some da tela na hora; se o servidor recusar, recarrega o que vale. */
  const excluir = async (p: GcSocialProducao) => {
    if (!window.confirm(`Excluir "${p.titulo}"? Os anexos vão junto.`)) return
    setVendo((v) => (v?.id === p.id ? null : v))
    setProducao((lista) => lista.filter((x) => x.id !== p.id))
    try {
      await gestaoClientes.excluirSocialProducao(p.id)
      toast.success('Demanda excluída')
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
      await carregar()
    }
  }

  const editar = (p: GcSocialProducao) => {
    setVendo(null)
    setForm({ id: p.id, titulo: p.titulo, descricao: p.descricao, status: p.status, editor: p.editor_id ?? '', prazo: p.prazo ?? '' })
  }

  const opcoesEditor = [
    { value: '', label: 'Sem editor' },
    ...(perfis ?? []).map((p) => ({ value: p.id, label: (p.name && p.name.trim()) || p.email })),
  ]

  const salvarProducao = async () => {
    if (!form) return
    if (!form.titulo.trim()) return toast.error('Dê um título à demanda')
    setSalvando(true)
    try {
      const dados = {
        titulo: form.titulo.trim(),
        descricao: form.descricao,
        status: form.status,
        editor_id: form.editor || null,
        prazo: form.prazo || null,
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

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ produção */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Produção</h2>
            <FiltroPeriodo filtro={filtro} onChange={setFiltro} />
            {filtro.tipo !== 'tudo' && (
              <span className="text-xs text-foreground/45">
                {producaoNoPeriodo.length} de {producao.length} criadas
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" leftIcon={<FileDown className="h-4 w-4" />} onClick={() => setPdfAberto(true)}>
              Gerar PDF das artes
            </Button>
            <Button
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => setForm({ titulo: '', descricao: '', status: 'para_producao', editor: '', prazo: '' })}
            >
              Nova demanda de produção
            </Button>
          </div>
        </div>
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setArrastando(String(e.active.id))}
          onDragCancel={() => setArrastando(null)}
          onDragEnd={aoSoltar}
        >
          <div className="grid gap-3 lg:grid-cols-3">
            {COLUNAS.map((col) => {
              const itens = producaoNoPeriodo.filter((p) => p.status === col.valor)
              return (
                <ColunaProducao key={col.valor} col={col} total={itens.length}>
                  {itens.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-foreground/35">
                      Arraste um card pra cá
                    </p>
                  )}
                  {itens.map((p) => (
                    <CartaoArrastavel key={p.id} id={p.id}>
                      <CartaoProducao p={p} onAbrir={() => setVendo(p)} onExcluir={() => void excluir(p)} />
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
                return p ? (
                  <div className="w-[85vw] max-w-sm rotate-2 sm:w-[20rem]">
                    <CartaoProducao p={p} sobreposto />
                  </div>
                ) : null
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
            <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setLinkAberto(true)}>
              Adicionar link
            </Button>
          )}
        </div>
        {linkAberto && (
          <div className="mb-3 grid gap-2 rounded-xl border border-accent/30 bg-accent/[0.02] p-3 sm:grid-cols-[1fr_2fr_auto]">
            <Input label="Nome" value={linkTitulo} onChange={(e) => setLinkTitulo(e.target.value)} placeholder="Drive do cliente, Pasta de logos…" />
            <Input label="Link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://drive.google.com/…" />
            <div className="flex items-end gap-2">
              <Button variant="ghost" onClick={() => setLinkAberto(false)}>
                Cancelar
              </Button>
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
            <Paperclip className="h-4 w-4 text-accent" /> Fotos e arquivos
          </h2>
          <Button variant="secondary" size="sm" loading={enviando} leftIcon={<Plus className="h-4 w-4" />} onClick={() => inputArquivo.current?.click()}>
            Anexar
          </Button>
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
                  <a
                    href={m.anexo?.dataUrl}
                    download={m.anexo?.name}
                    className="flex h-28 w-full items-center justify-center bg-elevate/[0.03] text-foreground/40"
                    title="Baixar"
                  >
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
        size="md"
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
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm(null)}>
                Cancelar
              </Button>
              <Button loading={salvando} onClick={() => void salvarProducao()}>
                Salvar
              </Button>
            </div>
          </div>
        }
      >
        {form && (
          <div className="space-y-3">
            <Input label="O que produzir *" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: 3 criativos de implante, reels de bastidores…" autoFocus />
            <Textarea label="Detalhes" rows={10} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Referências, texto, formato, onde está o material…" />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Situação"
                options={COLUNAS.map((c) => ({ value: c.valor, label: c.titulo }))}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as GcSocialStatus })}
              />
              <Select label="Editor" options={opcoesEditor} value={form.editor} onChange={(e) => setForm({ ...form, editor: e.target.value })} />
              <Input label="Prazo" type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!vendo}
        onClose={() => setVendo(null)}
        size="lg"
        title={vendo?.titulo}
        footer={
          vendo && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                leftIcon={<Trash2 className="h-4 w-4" />}
                className="mr-auto text-danger hover:bg-danger/10"
                onClick={() => void excluir(vendo)}
              >
                Excluir
              </Button>
              <Button variant="ghost" onClick={() => setVendo(null)}>
                Fechar
              </Button>
              <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => editar(vendo)}>
                Editar
              </Button>
            </div>
          )
        }
      >
        {vendo && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {COLUNAS.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  onClick={() => void mover(vendo.id, c.valor)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                    vendo.status === c.valor
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-line text-foreground/55 hover:border-accent/40 hover:text-foreground',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', c.cor)} />
                  {c.titulo}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-foreground/60">
              <span className="flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" /> {vendo.editor_nome ?? 'Sem editor'}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" /> {vendo.prazo ? `Prazo ${dataBr(vendo.prazo)}` : 'Sem prazo'}
              </span>
            </div>
            {vendo.descricao.trim() ? (
              <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-elevate/[0.02] p-4 text-sm leading-relaxed text-foreground/85">
                {vendo.descricao}
              </div>
            ) : (
              <p className="text-sm text-foreground/45">Sem detalhes da arte. Clique em Editar pra escrever.</p>
            )}
            <ReferenciasDaArte
              demanda={vendo}
              onMudou={(atualizada) => {
                setVendo(atualizada)
                setProducao((lista) => lista.map((p) => (p.id === atualizada.id ? atualizada : p)))
              }}
            />
            <PublicacaoDoCard
              demanda={vendo}
              onMudou={(atualizada) => {
                setVendo(atualizada)
                setProducao((lista) => lista.map((p) => (p.id === atualizada.id ? atualizada : p)))
              }}
            />
          </div>
        )}
      </Modal>

      <ModalPdfArtes
        aberto={pdfAberto}
        onFechar={() => setPdfAberto(false)}
        clienteId={clienteId}
        demandas={producaoNoPeriodo}
        periodo={limites.rotulo}
      />

      <Modal open={!!ampliado} onClose={() => setAmpliado(null)} size="2xl" title={ampliado?.titulo}>
        {ampliado?.anexo && <img src={ampliado.anexo.dataUrl} alt={ampliado.titulo} className="max-h-[70vh] w-full object-contain" />}
      </Modal>
    </div>
  )
}
