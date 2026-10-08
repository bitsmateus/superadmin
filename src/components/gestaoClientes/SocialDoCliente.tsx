import * as React from 'react'
import {
  CalendarClock, ExternalLink, FileText, FolderOpen, Link2, Loader2, Paperclip, Pencil, Plus, Trash2, UserRound, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
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
        <div className="grid gap-3 lg:grid-cols-3">
          {COLUNAS.map((col) => {
            const itens = producao.filter((p) => p.status === col.valor)
            return (
              <div key={col.valor} className="rounded-2xl border border-line bg-elevate/[0.025]">
                <header className="flex items-center justify-between gap-2 px-3.5 py-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className={cn('h-2 w-2 rounded-full', col.cor)} />
                      {col.titulo}
                    </h3>
                    <p className="text-[11px] text-foreground/40">{col.ajuda}</p>
                  </div>
                  <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">{itens.length}</span>
                </header>
                <div className="space-y-2 px-2 pb-2">
                  {itens.length === 0 && (
                    <p className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-foreground/35">Nada aqui</p>
                  )}
                  {itens.map((p) => {
                    const atrasada = p.prazo && p.prazo < hojeISO() && p.status !== 'pronto'
                    return (
                      <article key={p.id} className="rounded-xl border border-line bg-surface p-3 shadow-sm">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm font-medium text-foreground', p.status === 'pronto' && 'text-foreground/50 line-through')}>{p.titulo}</p>
                            {p.descricao && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-foreground/55">{p.descricao}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({ id: p.id, titulo: p.titulo, descricao: p.descricao, status: p.status, editor: p.editor_id ?? '', prazo: p.prazo ?? '' })
                            }
                            className="shrink-0 rounded-md p-1 text-foreground/35 hover:text-accent"
                            aria-label="Editar demanda"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span
                            className={cn(
                              'flex items-center gap-1 rounded-full px-2 py-0.5',
                              p.editor_nome ? 'bg-accent/10 text-accent' : 'bg-elevate/[0.05] text-foreground/40',
                            )}
                          >
                            <UserRound className="h-3 w-3" />
                            {p.editor_nome ? `Editor: ${p.editor_nome}` : 'Sem editor'}
                          </span>
                          {p.prazo && (
                            <span className={cn('flex items-center gap-1 text-foreground/50', atrasada && 'font-medium text-danger')}>
                              <CalendarClock className="h-3 w-3" /> {dataBr(p.prazo)}
                            </span>
                          )}
                        </div>
                        <select
                          value={p.status}
                          onChange={(e) => void agir(() => gestaoClientes.atualizarSocialProducao(p.id, { status: e.target.value as GcSocialStatus }))}
                          aria-label="Mover para"
                          className="mt-2 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs text-foreground/70"
                        >
                          {COLUNAS.map((c) => (
                            <option key={c.valor} value={c.valor}>
                              Mover para: {c.titulo}
                            </option>
                          ))}
                        </select>
                      </article>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
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
            <Textarea label="Detalhes" rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Referências, texto, formato, onde está o material…" />
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

      <Modal open={!!ampliado} onClose={() => setAmpliado(null)} size="2xl" title={ampliado?.titulo}>
        {ampliado?.anexo && <img src={ampliado.anexo.dataUrl} alt={ampliado.titulo} className="max-h-[70vh] w-full object-contain" />}
      </Modal>
    </div>
  )
}
