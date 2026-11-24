import * as React from 'react'
import { Check, Download, FileText, Link2, Loader2, Paperclip, Pencil, StickyNote, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Section } from '../ClientDrawer'
import { CrmLeadTab } from './CrmLeadTab'
import { Button } from '@/components/ui/Button'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { asText, cn } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import { marcosDoCliente } from '@/lib/linhaDoTempoDoCliente'
import type { Client, NoteAttachment } from '@/types/client'

const MAX_ANEXO_BYTES = 10 * 1024 * 1024

interface Pendente { id: string; arquivo: File; nome: string }

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`)
const extensaoDe = (nome: string) => /\.[a-z0-9]{1,5}$/i.exec(nome)?.[0] ?? ''

function lerComoDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Não consegui ler o arquivo'))
    r.readAsDataURL(f)
  })
}

function salvarComo(href: string, nome: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Notas internas do cliente: o espaço do time de suporte pra registrar pontos de atendimento, pendências, combinados e o que
 * mais precisar lembrar. Só o time vê. Aqui só aparece o que foi escrito nesta aba (e o briefing que o cliente preencheu), junto
 * com a linha do tempo do cliente: briefing gerado/enviado/preenchido, mudanças de etapa, reunião, entrega.
 */
function NotasEmLinha({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [texto, setTexto] = React.useState('')
  const [editandoId, setEditandoId] = React.useState<string | null>(null)
  const [textoEdicao, setTextoEdicao] = React.useState('')
  const [pendentes, setPendentes] = React.useState<Pendente[]>([])
  const [registrando, setRegistrando] = React.useState(false)
  const [abrindo, setAbrindo] = React.useState<string | null>(null)
  const [vendo, setVendo] = React.useState<{ nome: string; dataUrl: string } | null>(null)
  const [arrastando, setArrastando] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)

  // Notas do time e marcos do cliente numa lista só, do mais novo pro mais antigo.
  const linha = React.useMemo(() => {
    const notas = (client.notes ?? []).filter((n) => n.origem === 'notas_internas').map((n) => ({ tipo: 'nota' as const, em: n.createdAt, n }))
    const marcos = marcosDoCliente(client.logs).map((l) => ({ tipo: 'marco' as const, em: l.createdAt, l }))
    return [...notas, ...marcos].sort((a, b) => b.em.localeCompare(a.em))
  }, [client.notes, client.logs])

  const adicionarArquivos = (arquivos: File[]) => {
    const novos: Pendente[] = []
    for (const f of arquivos) {
      if (f.size > MAX_ANEXO_BYTES) {
        toast.error(`"${f.name}" passa de 10MB`)
        continue
      }
      novos.push({ id: crypto.randomUUID(), arquivo: f, nome: f.name || (f.type.startsWith('image/') ? 'print.png' : 'arquivo') })
    }
    if (novos.length) setPendentes((l) => [...l, ...novos])
  }

  const registrar = async () => {
    const t = texto.trim()
    if (!t && pendentes.length === 0) return
    if (!user) {
      toast.error('Defina seu nome em Configurações antes de registrar notas.')
      return
    }
    setRegistrando(true)
    try {
      const anexos: NoteAttachment[] = []
      for (const p of pendentes) {
        // O nome que a pessoa deu vale; se ela apagou a extensão, volta a do arquivo original (senão o download perde o tipo).
        let nome = p.nome.trim() || p.arquivo.name || 'arquivo'
        if (!extensaoDe(nome)) nome += extensaoDe(p.arquivo.name)
        anexos.push(await db.uploadNoteFile(client.id, { name: nome, type: p.arquivo.type, dataUrl: await lerComoDataUrl(p.arquivo) }))
      }
      db.addInternalNote(client.id, t, user, anexos)
      db.addLog(client.id, anexos.length ? `Nota interna registrada com ${anexos.length} arquivo${anexos.length === 1 ? '' : 's'}` : 'Nota interna registrada')
      setTexto('')
      setPendentes([])
      toast.success('Nota registrada')
    } catch (err) {
      toast.error('Não consegui anexar: ' + (err as Error).message)
    } finally {
      setRegistrando(false)
    }
  }

  /** Busca o conteúdo no servidor: imagem abre grande, o resto baixa. */
  const abrirAnexo = async (a: NoteAttachment, baixar = false) => {
    setAbrindo(a.id)
    try {
      const c = await db.noteFileContent(a.id)
      if (!baixar && a.type.startsWith('image/')) setVendo({ nome: a.name, dataUrl: c.dataUrl })
      else salvarComo(c.dataUrl, a.name)
    } catch (err) {
      toast.error('Não consegui abrir o arquivo: ' + (err as Error).message)
    } finally {
      setAbrindo(null)
    }
  }

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <StickyNote className="h-3.5 w-3.5 text-accent" />
            Notas internas do cliente
          </span>
        }
      >
        <p className="mb-3 text-xs text-foreground/50">
          Só o time vê. Use pra anotar pontos de atendimento, pendências, combinados e tudo que o próximo a atender precisa saber.
          Abaixo, as notas e a linha do tempo do cliente (briefing, etapas, entrega) juntas.
        </p>
        <div
          className={cn('space-y-2 rounded-lg', arrastando && 'ring-2 ring-accent/40')}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault()
            setArrastando(false)
            adicionarArquivos(Array.from(e.dataTransfer.files))
          }}
        >
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onPaste={(e) => {
              const arquivos = Array.from(e.clipboardData?.files ?? [])
              if (arquivos.length) {
                e.preventDefault()
                adicionarArquivos(arquivos)
              }
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void registrar()
            }}
            placeholder="Ex.: Pendente: cliente vai mandar o número novo. Atendimento: configurado o chatbot, falta testar o horário…"
            rows={4}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          {pendentes.length > 0 && (
            <ul className="space-y-1.5">
              {pendentes.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line bg-elevate/[0.03] px-2.5 py-1.5">
                  <FileText className="h-4 w-4 shrink-0 text-foreground/45" />
                  <input
                    value={p.nome}
                    onChange={(e) => setPendentes((l) => l.map((x) => (x.id === p.id ? { ...x, nome: e.target.value } : x)))}
                    placeholder="Nome do arquivo"
                    aria-label="Nome do arquivo"
                    className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm text-foreground focus:border-accent focus:outline-none"
                  />
                  <span className="shrink-0 text-[11px] text-foreground/45">{tamanho(p.arquivo.size)}</span>
                  <button type="button" onClick={() => setPendentes((l) => l.filter((x) => x.id !== p.id))} className="shrink-0 text-foreground/40 hover:text-danger" title="Tirar" aria-label="Tirar arquivo">
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()} leftIcon={<Paperclip className="h-3.5 w-3.5" />}>
                Anexar arquivo
              </Button>
              <input ref={input} type="file" multiple className="hidden" onChange={(e) => { adicionarArquivos(Array.from(e.target.files ?? [])); e.target.value = '' }} />
              <span className="hidden text-[11px] text-foreground/40 sm:inline">Ctrl + Enter também registra · cole ou arraste arquivos aqui (até 10MB)</span>
            </div>
            <Button size="sm" onClick={() => void registrar()} loading={registrando} disabled={!texto.trim() && pendentes.length === 0} leftIcon={<StickyNote className="h-3.5 w-3.5" />}>
              Registrar nota
            </Button>
          </div>
        </div>

        <div className="mt-5">
          {linha.length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhuma nota interna nem movimento do cliente ainda.</p>
          ) : (
            <ul className="space-y-2.5">
              {linha.map((item) => {
                if (item.tipo === 'marco') {
                  const l = item.l
                  return (
                    <li key={`marco:${l.id}`} className="flex items-start gap-3 px-1">
                      <span className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-elevate/[0.04] ring-1 ring-line">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                      </span>
                      <div className="min-w-0 flex-1 rounded-md border border-line bg-elevate/[0.02] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-foreground/90">{asText(l.action)}</span>
                          <span className="shrink-0 text-[10px] text-foreground/40" title={new Date(l.createdAt).toLocaleString('pt-BR')}>
                            {timeAgo(l.createdAt)}
                          </span>
                        </div>
                        {l.detail && <p className="mt-0.5 text-xs text-foreground/55">{asText(l.detail)}</p>}
                      </div>
                    </li>
                  )
                }
                const n = item.n
                return (
                <li key={n.id} className={cn('rounded-lg border border-warning/30 bg-warning/[0.06] p-3')}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{asText(n.author, '—')}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[10px] text-foreground/45" title={new Date(n.createdAt).toLocaleString('pt-BR')}>
                        {timeAgo(n.createdAt)}
                      </span>
                      {editandoId !== n.id && (
                        <>
                          <button
                            type="button"
                            title="Editar nota"
                            onClick={() => {
                              setEditandoId(n.id)
                              setTextoEdicao(n.text)
                            }}
                            className="ml-1 grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-accent"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Excluir nota"
                            onClick={() => {
                              if (!window.confirm('Excluir esta nota interna?')) return
                              db.deleteNote(client.id, n.id)
                              db.addLog(client.id, 'Nota interna excluída')
                              toast.success('Nota excluída')
                            }}
                            className="grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-danger"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {editandoId === n.id ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={textoEdicao}
                        onChange={(e) => setTextoEdicao(e.target.value)}
                        rows={4}
                        autoFocus
                        className="w-full resize-y rounded-lg border border-accent/40 bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setEditandoId(null)} className="px-2 py-1 text-xs text-foreground/50 transition-colors hover:text-foreground">
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={!textoEdicao.trim()}
                          onClick={() => {
                            const t = textoEdicao.trim()
                            if (!t) return
                            db.updateNote(client.id, n.id, t)
                            db.addLog(client.id, 'Nota interna editada')
                            toast.success('Nota atualizada')
                            setEditandoId(null)
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
                        >
                          <Check className="h-3 w-3" />
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {n.text.trim() && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground/85">{asText(n.text)}</p>}
                      {(n.attachments ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {n.attachments!.map((a) => (
                            <div key={a.id} className="flex items-center overflow-hidden rounded-md border border-line bg-surface text-xs">
                              <button type="button" onClick={() => void abrirAnexo(a)} className="flex max-w-[260px] items-center gap-1.5 px-2 py-1.5 text-foreground/80 hover:text-accent" title={a.type.startsWith('image/') ? 'Ampliar' : 'Baixar'}>
                                {abrindo === a.id ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                                <span className="truncate">{a.name}</span>
                                <span className="shrink-0 text-foreground/40">{tamanho(a.size)}</span>
                              </button>
                              <button type="button" onClick={() => void abrirAnexo(a, true)} className="border-l border-line px-1.5 py-1.5 text-foreground/45 hover:text-accent" title="Baixar" aria-label="Baixar">
                                <Download className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      </Section>
      {vendo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4" onClick={() => setVendo(null)}>
          <img src={vendo.dataUrl} alt={vendo.nome} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => salvarComo(vendo.dataUrl, vendo.nome)} className="rounded-full bg-white/15 p-2 text-white hover:bg-white/30" aria-label="Baixar"><Download className="h-5 w-5" /></button>
            <button type="button" onClick={() => setVendo(null)} className="rounded-full bg-white/15 p-2 text-white hover:bg-white/30" aria-label="Fechar"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A aba "Notas internas" tem dois botões no topo: as notas (com a linha do tempo) e, no Pipeline do Suporte, a "Lead do CRM" —
 * o histórico que o SDR combinou com o cliente (antes ficava dentro de "Entrega").
 */
export function NotasInternasTab({ client, comLeadDoCrm }: { client: Client; comLeadDoCrm?: boolean }) {
  const [aba, setAba] = React.useState<'notas' | 'lead'>('notas')
  const mostrandoLead = !!comLeadDoCrm && aba === 'lead'
  return (
    <div className="space-y-4">
      {comLeadDoCrm && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAba('notas')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              !mostrandoLead ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
            )}
          >
            <StickyNote className="h-3.5 w-3.5" />
            Notas
          </button>
          <button
            type="button"
            onClick={() => setAba('lead')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
              mostrandoLead ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
            )}
          >
            <Link2 className="h-3.5 w-3.5" />
            Lead do CRM
          </button>
        </div>
      )}
      {mostrandoLead ? <CrmLeadTab client={client} /> : <NotasEmLinha client={client} />}
    </div>
  )
}
