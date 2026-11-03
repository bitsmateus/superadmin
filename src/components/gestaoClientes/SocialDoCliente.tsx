import * as React from 'react'
import { createPortal } from 'react-dom'
import { DndContext, DragOverlay, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import {
  CalendarClock, ExternalLink, FileText, FolderOpen, Link2, Loader2, Paperclip, Pencil, Plus, Trash2, UserRound, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import { useKanbanSensors } from '@/hooks/useKanbanSensors'
import {
  gestaoClientes, type GcSocialMaterial, type GcSocialProducao, type GcSocialStatus,
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
function CartaoProducao({ p, onAbrir, sobreposto }: { p: GcSocialProducao; onAbrir?: () => void; sobreposto?: boolean }) {
  const atrasada = p.prazo && p.prazo < hojeISO() && p.status !== 'pronto'
  const resumo = resumoDaArte(p.descricao)
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        'block w-full cursor-grab rounded-xl border border-line bg-surface px-3 py-2 text-left shadow-sm transition-colors hover:border-accent/40 active:cursor-grabbing',
        sobreposto && 'shadow-lg ring-1 ring-accent/30',
      )}
    >
      <p className={cn('line-clamp-2 text-[13px] font-medium leading-snug text-foreground', p.status === 'pronto' && 'text-foreground/50 line-through')}>
        {p.titulo}
      </p>
      {resumo && resumo !== p.titulo && <p className="mt-0.5 truncate text-[11px] text-foreground/45">{resumo}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className={cn('flex min-w-0 items-center gap-1 truncate', p.editor_nome ? 'text-accent' : 'text-foreground/35')}>
          <UserRound className="h-3 w-3 shrink-0" />
          <span className="truncate">{p.editor_nome ?? 'Sem editor'}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
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
    </button>
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
          <h2 className="text-sm font-semibold text-foreground">Produção</h2>
          <Button
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setForm({ titulo: '', descricao: '', status: 'para_producao', editor: '', prazo: '' })}
          >
            Nova demanda de produção
          </Button>
        </div>
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setArrastando(String(e.active.id))}
          onDragCancel={() => setArrastando(null)}
          onDragEnd={aoSoltar}
        >
          <div className="grid gap-3 lg:grid-cols-3">
            {COLUNAS.map((col) => {
              const itens = producao.filter((p) => p.status === col.valor)
              return (
                <ColunaProducao key={col.valor} col={col} total={itens.length}>
                  {itens.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-foreground/35">
                      Arraste um card pra cá
                    </p>
                  )}
                  {itens.map((p) => (
                    <CartaoArrastavel key={p.id} id={p.id}>
                      <CartaoProducao p={p} onAbrir={() => setVendo(p)} />
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
            <div className="flex justify-end gap-2">
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
          </div>
        )}
      </Modal>

      <Modal open={!!ampliado} onClose={() => setAmpliado(null)} size="2xl" title={ampliado?.titulo}>
        {ampliado?.anexo && <img src={ampliado.anexo.dataUrl} alt={ampliado.titulo} className="max-h-[70vh] w-full object-contain" />}
      </Modal>
    </div>
  )
}
