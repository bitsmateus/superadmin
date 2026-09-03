import * as React from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  ArrowRight, Download, FileText, Image as ImageIcon, KanbanSquare,
  Paperclip, Pencil, Trash2, UserCircle2, X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/comercial/RichTextEditor'
import { useAuth } from '@/hooks/useAuth'
import { useReminderNotes } from '@/hooks/useReminderNotes'
import { useReminderEvents } from '@/hooks/useReminderEvents'
import { reminderNotesService } from '@/services/reminderNotes'
import { reminderEventsService } from '@/services/reminderEvents'
import { sanitizeHtml, stripHtml } from '@/lib/richText'
import { cn, formatDateTimeShort, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { ReminderNoteAttachment } from '@/types/ticket'
import type { SupportColumn } from '@/types/supportColumn'

const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Atualizações (com formatação/anexos, separadas por autor), Arquivos e Linha do tempo de uma
 * tarefa — mesmo padrão do card do CRM (LeadDetailModal/UpdatesPane), sem @menção (a tarefa já tem
 * "Responsável" pra isso). Linha do tempo aqui só tem o evento "status" (mudança de coluna) — é o
 * único campo de tarefa que já tinha uma forma dedicada de mudar (arrastar no Kanban). */
export function TaskUpdatesPane({ reminderId, columns }: { reminderId: string; columns: SupportColumn[] }) {
  const { profile } = useAuth()
  const notes = useReminderNotes(reminderId)
  const events = useReminderEvents(reminderId)
  const [tab, setTab] = React.useState('updates')
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [pendingAttachments, setPendingAttachments] = React.useState<ReminderNoteAttachment[]>([])
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState('')
  const [preview, setPreview] = React.useState<ReminderNoteAttachment | null>(null)

  const editorRef = React.useRef<RichTextEditorHandle>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => { void reminderNotesService.loadNotes(reminderId) }, [reminderId])
  React.useEffect(() => { void reminderEventsService.loadEvents(reminderId) }, [reminderId])

  const columnLabel = React.useCallback(
    (key: string | null) => (key ? columns.find((c) => c.key === key)?.name ?? key : undefined),
    [columns],
  )

  const allAttachments = React.useMemo(
    () => notes.flatMap((n) => n.attachments.map((a) => ({ attachment: a, note: n }))),
    [notes],
  )

  const timelineItems = React.useMemo(() => {
    const fromEvents = events.map((e) => ({
      id: e.id,
      at: e.createdAt,
      actor: e.actorName,
      icon: <KanbanSquare className="h-3.5 w-3.5" />,
      text: e.fromValue ? 'Movida de coluna' : 'Entrou na coluna',
      from: columnLabel(e.fromValue),
      to: columnLabel(e.toValue),
    }))
    const fromNotes = notes.map((n) => {
      const plain = stripHtml(n.content)
      return {
        id: `note-${n.id}`,
        at: n.createdAt,
        actor: n.authorName,
        icon: undefined,
        text: plain
          ? `Atualização: "${plain.length > 90 ? plain.slice(0, 90) + '…' : plain}"`
          : n.attachments.length > 0 ? 'Anexou um arquivo' : 'Atualização',
        from: undefined as string | undefined,
        to: undefined as string | undefined,
      }
    })
    return [...fromEvents, ...fromNotes].sort((a, b) => b.at.localeCompare(a.at))
  }, [events, notes, columnLabel])

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    const next: ReminderNoteAttachment[] = []
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`"${file.name}" passa de 5MB`)
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      next.push({
        id: crypto.randomUUID(),
        name: file.name || (file.type.startsWith('image/') ? 'print.png' : 'arquivo'),
        type: file.type,
        size: file.size,
        dataUrl,
      })
    }
    setPendingAttachments((prev) => [...prev, ...next])
  }

  const downloadAttachment = (a: ReminderNoteAttachment) => {
    const link = document.createElement('a')
    link.href = a.dataUrl
    link.download = a.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const hasText = stripHtml(text).length > 0

  const submit = async () => {
    if (!hasText && pendingAttachments.length === 0) return
    setSending(true)
    const authorName = profile?.name || profile?.email || 'Alguém'
    const note = await reminderNotesService.addNote(reminderId, text, authorName, pendingAttachments)
    setSending(false)
    if (note) { setText(''); setPendingAttachments([]) }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'updates', label: 'Atualizações' },
          { value: 'files', label: 'Arquivos' },
          { value: 'timeline', label: 'Linha do tempo' },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-1">
        {tab === 'updates' && (
          <>
            <div className="rounded-lg border border-line p-3 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
              <RichTextEditor
                ref={editorRef}
                value={text}
                onChange={setText}
                onPasteFiles={handleFiles}
                placeholder="Escreva uma atualização, cole um print (Ctrl+V)…"
              />
              {pendingAttachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-1.5 rounded-md border border-line bg-elevate/[0.03] px-2 py-1 text-xs text-foreground/70">
                      {a.type.startsWith('image/') ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                      <span className="max-w-[120px] truncate">{a.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingAttachments((p) => p.filter((x) => x.id !== a.id))}
                        className="text-foreground/40 hover:text-danger"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                  multiple
                  className="hidden"
                  onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Anexar imagem ou PDF"
                  className="grid h-9 w-9 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground lg:h-7 lg:w-7"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <Button size="sm" onClick={submit} disabled={(!hasText && !pendingAttachments.length) || sending} loading={sending}>
                  Enviar atualização
                </Button>
              </div>
            </div>

            <div className="mt-4">
              {notes.length === 0 ? (
                <p className="text-xs text-foreground/40">Nenhuma atualização ainda.</p>
              ) : (
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.id} className="group rounded-lg border border-line bg-elevate/[0.02] p-3">
                      <div className="flex items-start gap-3">
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] font-medium text-foreground ring-1 ring-line">
                          {initials(n.authorName) || <UserCircle2 className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-foreground">{n.authorName}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-foreground/40" title={timeAgo(n.createdAt)}>
                                {formatDateTimeShort(n.createdAt)}
                              </span>
                              {editingNoteId !== n.id && (
                                // "group-hover" nunca dispara em toque — sem o "flex" na base, editar/excluir
                                // uma atualização ficava impossível no celular. Abaixo de lg fica sempre visível;
                                // a partir de lg volta a só aparecer no hover, igual antes.
                                <div className="flex items-center gap-0.5 lg:hidden lg:group-hover:flex">
                                  <button
                                    type="button"
                                    title="Editar"
                                    onClick={() => { setEditingNoteId(n.id); setEditingText(stripHtml(n.content)) }}
                                    className="grid h-8 w-8 place-items-center rounded text-foreground/35 transition-colors hover:text-accent lg:h-5 lg:w-5"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Excluir"
                                    onClick={() => {
                                      if (window.confirm('Excluir esta atualização?')) void reminderNotesService.deleteNote(n.id)
                                    }}
                                    className="grid h-8 w-8 place-items-center rounded text-foreground/35 transition-colors hover:text-danger lg:h-5 lg:w-5"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          {editingNoteId === n.id ? (
                            <div className="mt-2 space-y-2">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                rows={3}
                                autoFocus
                                className="w-full resize-y rounded-lg border border-accent/40 bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setEditingNoteId(null)}
                                  className="px-2 py-1 text-xs text-foreground/50 transition-colors hover:text-foreground"
                                >
                                  Cancelar
                                </button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    reminderNotesService.updateNote(n.id, editingText)
                                    setEditingNoteId(null)
                                  }}
                                  disabled={!editingText.trim()}
                                >
                                  Salvar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            stripHtml(n.content) && (
                              <div
                                className="mt-1 whitespace-pre-wrap text-sm text-foreground"
                                dangerouslySetInnerHTML={{ __html: sanitizeHtml(n.content) }}
                              />
                            )
                          )}
                          {n.attachments.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {n.attachments.map((a) => (
                                a.type.startsWith('image/') ? (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => setPreview(a)}
                                    className="block overflow-hidden rounded-lg ring-1 ring-line"
                                  >
                                    <img src={a.dataUrl} alt={a.name} className="max-h-56 max-w-full object-contain" />
                                  </button>
                                ) : (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => setPreview(a)}
                                    className="flex items-center gap-1.5 rounded-md border border-line bg-elevate/[0.03] px-2 py-1.5 text-xs text-foreground/70 hover:text-foreground"
                                  >
                                    <FileText className="h-3.5 w-3.5" /> {a.name}
                                  </button>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === 'files' && (
          allAttachments.length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhum arquivo anexado ainda.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {allAttachments.map(({ attachment: a, note: n }) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setPreview(a)}
                  className="group rounded-lg border border-line p-2 text-center hover:border-accent/50"
                >
                  {a.type.startsWith('image/') ? (
                    <img src={a.dataUrl} alt={a.name} className="mb-1.5 h-20 w-full rounded object-cover" />
                  ) : (
                    <div className="mb-1.5 grid h-20 w-full place-items-center rounded bg-elevate/[0.04]">
                      <FileText className="h-6 w-6 text-foreground/40" />
                    </div>
                  )}
                  <p className="truncate text-[11px] text-foreground/70">{a.name}</p>
                  <p className="truncate text-[10px] text-foreground/35">{n.authorName}</p>
                </button>
              ))}
            </div>
          )
        )}

        {tab === 'timeline' && (
          timelineItems.length === 0 ? (
            <p className="text-xs text-foreground/40">Sem histórico ainda.</p>
          ) : (
            <ul className="relative ml-3 space-y-5 border-l border-line pl-5">
              {timelineItems.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute -left-8 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-accent/10 text-accent ring-4 ring-card">
                    {item.icon}
                  </span>
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                    {item.text && <span>{item.text}</span>}
                    {item.from && (
                      <span className="rounded bg-elevate/[0.08] px-1.5 py-0.5 text-[11px] font-medium text-foreground/70">
                        {item.from}
                      </span>
                    )}
                    {item.from && item.to && <ArrowRight className="h-3 w-3 shrink-0 text-foreground/30" />}
                    {item.to && (
                      <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        {item.to}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-foreground/40">
                    {item.actor} · <span title={timeAgo(item.at)}>{formatDateTimeShort(item.at)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {preview && createPortal(
        <div
          className={cn('fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 animate-fade-in')}
          onClick={() => setPreview(null)}
        >
          <div className="flex max-h-full max-w-full flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex w-full max-w-full items-center justify-between gap-4">
              <span className="truncate text-sm text-white/90">{preview.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadAttachment(preview)}
                  className="flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20"
                >
                  <Download className="h-3.5 w-3.5" /> Baixar
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  aria-label="Fechar"
                  className="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-white hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {preview.type.startsWith('image/') ? (
              <img src={preview.dataUrl} alt={preview.name} className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" />
            ) : preview.type === 'application/pdf' ? (
              <iframe src={preview.dataUrl} title={preview.name} className="h-[80vh] w-[90vw] rounded-lg bg-white" />
            ) : (
              <div className="grid h-40 w-80 max-w-[90vw] place-items-center rounded-lg bg-white/10 p-4 text-center text-sm text-white/70">
                Pré-visualização não disponível pra esse tipo de arquivo. Clique em "Baixar" pra abrir.
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
