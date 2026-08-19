import * as React from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  AtSign,
  Calendar,
  Circle,
  Clock,
  FileText,
  Hash,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Phone,
  Trash2,
  Type,
  UserCircle2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { EditableField } from '@/components/comercial/EditableField'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useAuth } from '@/hooks/useAuth'
import { useLeadBoards, useLeadRow } from '@/hooks/useLeadBoards'
import { useLeadNotes } from '@/hooks/useLeadNotes'
import { useTeam, teamMemberLabel, type TeamMember } from '@/hooks/useTeam'
import { leadBoardsService } from '@/services/leadBoards'
import { leadNotesService } from '@/services/leadNotes'
import { cn, formatDateTimeShort, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { LeadNoteAttachment } from '@/types/leadBoard'

const MAX_FILE_BYTES = 5 * 1024 * 1024

export interface LeadDetailModalProps {
  leadRowId: string | null
  onClose: () => void
}

export function LeadDetailModal({ leadRowId, onClose }: LeadDetailModalProps) {
  const row = useLeadRow(leadRowId)
  const boards = useLeadBoards()
  const board = boards.find((b) => b.id === row?.boardId)

  React.useEffect(() => {
    if (!leadRowId) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [leadRowId, onClose])

  if (!leadRowId || !row) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-[min(88vh,820px)] w-[min(96vw,1100px)] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl animate-scale-in"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <EditableField
              value={row.nome}
              onSave={(next) => leadBoardsService.updateRow(row.id, { nome: next })}
              placeholder="Nome do lead"
              className="w-full text-xl font-semibold text-[#323338]"
            />
            <p className="mt-1 text-xs text-foreground/40">
              in → {board?.name ?? '—'} Board
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-foreground/50 hover:bg-elevate/[0.06] hover:text-foreground focus-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-[320px] shrink-0 overflow-y-auto border-r border-line px-4 py-2">
            <FieldRow icon={<Circle className="h-3.5 w-3.5" style={{ color: board?.color }} fill={board?.color} />} label="Grupo">
              <select
                value={row.boardId}
                onChange={(e) => leadBoardsService.updateRow(row.id, { boardId: e.target.value })}
                className="w-full rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-[#323338] outline-none"
              >
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FieldRow>

            <FieldRow icon={<Type className="h-3.5 w-3.5" />} label="Empresa">
              <BoxedField value={row.empresa} onSave={(v) => leadBoardsService.updateRow(row.id, { empresa: v })} />
            </FieldRow>
            <FieldRow icon={<Phone className="h-3.5 w-3.5" />} label="Telefone">
              <BoxedField value={row.telefone} onSave={(v) => leadBoardsService.updateRow(row.id, { telefone: v })} />
            </FieldRow>
            <FieldRow icon={<Circle className="h-3.5 w-3.5" />} label="Tipo">
              <LeadLabelCell field="tipo" value={row.tipo} onChange={(v) => leadBoardsService.updateRow(row.id, { tipo: v })} />
            </FieldRow>
            <FieldRow icon={<Calendar className="h-3.5 w-3.5" />} label="Dia de contato">
              <LeadLabelCell field="diaContato" value={row.diaContato} onChange={(v) => leadBoardsService.updateRow(row.id, { diaContato: v })} />
            </FieldRow>
            <FieldRow icon={<Circle className="h-3.5 w-3.5" />} label="Status">
              <LeadLabelCell field="status" value={row.status} onChange={(v) => leadBoardsService.updateRow(row.id, { status: v })} />
            </FieldRow>
            <FieldRow icon={<UserCircle2 className="h-3.5 w-3.5" />} label="SDR">
              <BoxedField value={row.sdr} onSave={(v) => leadBoardsService.updateRow(row.id, { sdr: v })} />
            </FieldRow>
            <FieldRow icon={<Calendar className="h-3.5 w-3.5" />} label="Retornar">
              <BoxedField type="datetime-local" value={row.retornar} onSave={(v) => leadBoardsService.updateRow(row.id, { retornar: v })} />
            </FieldRow>
            <FieldRow icon={<UserCircle2 className="h-3.5 w-3.5" />} label="Resp.">
              <BoxedField value={row.responsavel} onSave={(v) => leadBoardsService.updateRow(row.id, { responsavel: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Número">
              <BoxedField value={row.numero} onSave={(v) => leadBoardsService.updateRow(row.id, { numero: v })} />
            </FieldRow>
            <FieldRow icon={<Type className="h-3.5 w-3.5" />} label="Dor do cliente">
              <BoxedField value={row.dorCliente} onSave={(v) => leadBoardsService.updateRow(row.id, { dorCliente: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Nº atendentes">
              <BoxedField value={row.numeroAtendentes} onSave={(v) => leadBoardsService.updateRow(row.id, { numeroAtendentes: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Valor MRR">
              <BoxedField value={row.valorMrr} onSave={(v) => leadBoardsService.updateRow(row.id, { valorMrr: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Valor Implementação">
              <BoxedField value={row.valorImplementacao} onSave={(v) => leadBoardsService.updateRow(row.id, { valorImplementacao: v })} />
            </FieldRow>
            <FieldRow icon={<Clock className="h-3.5 w-3.5" />} label="Log de criação">
              <div className="rounded-md bg-elevate/[0.03] px-2 py-1.5 text-xs text-foreground/40">
                {formatDateTimeShort(row.createdAt)}
              </div>
            </FieldRow>
          </div>

          <UpdatesPane leadRowId={row.id} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FieldRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 py-1.5">
      <span className="flex w-5 shrink-0 items-center justify-center text-[#323338]/60">{icon}</span>
      <span className="w-[104px] shrink-0 text-xs font-medium text-[#323338]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function BoxedField({ value, onSave, type }: { value: string; onSave: (v: string) => void; type?: 'text' | 'date' | 'datetime-local' }) {
  return (
    <EditableField
      value={value}
      type={type}
      onSave={onSave}
      className="rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-[#323338]"
    />
  )
}

function UpdatesPane({ leadRowId }: { leadRowId: string }) {
  const { profile } = useAuth()
  const notes = useLeadNotes(leadRowId)
  const team = useTeam()
  const [tab, setTab] = React.useState('updates')
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [pendingAttachments, setPendingAttachments] = React.useState<LeadNoteAttachment[]>([])
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionSearch, setMentionSearch] = React.useState('')
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState('')

  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const mentionBtnRef = React.useRef<HTMLButtonElement>(null)
  const mentionPopRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(mentionPopRef, mentionOpen, () => setMentionOpen(false))

  React.useEffect(() => { void leadNotesService.loadNotes(leadRowId) }, [leadRowId])

  const allAttachments = React.useMemo(
    () => notes.flatMap((n) => n.attachments.map((a) => ({ attachment: a, note: n }))),
    [notes],
  )

  const filteredTeam = React.useMemo(
    () => team.filter((m) => teamMemberLabel(m).toLowerCase().includes(mentionSearch.toLowerCase())),
    [team, mentionSearch],
  )

  const insertMention = (m: TeamMember) => {
    const label = `@${teamMemberLabel(m)} `
    const el = textareaRef.current
    if (el) {
      const start = el.selectionStart ?? text.length
      const end = el.selectionEnd ?? text.length
      const next = text.slice(0, start) + label + text.slice(end)
      setText(next)
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + label.length
        el.setSelectionRange(pos, pos)
      })
    } else {
      setText((t) => t + label)
    }
    setMentionOpen(false)
    setMentionSearch('')
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    const next: LeadNoteAttachment[] = []
    for (const file of Array.from(files)) {
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
      next.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, dataUrl })
    }
    setPendingAttachments((prev) => [...prev, ...next])
  }

  const submit = async () => {
    if (!text.trim() && pendingAttachments.length === 0) return
    setSending(true)
    const authorName = profile?.name || profile?.email || 'Alguém'
    const note = await leadNotesService.addNote(leadRowId, text, authorName, pendingAttachments)
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
          { value: 'activity', label: 'Log de atividade' },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'updates' && (
          <>
            <div className="rounded-lg border border-line p-3">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escreva uma atualização e mencione outros com @"
                className="min-h-[70px] w-full resize-y bg-transparent text-sm text-[#323338] placeholder:text-foreground/30 focus:outline-none"
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
                <div className="flex items-center gap-1">
                  <div className="relative">
                    <button
                      ref={mentionBtnRef}
                      type="button"
                      onClick={() => setMentionOpen((o) => !o)}
                      title="Mencionar alguém"
                      className="grid h-7 w-7 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
                    >
                      <AtSign className="h-4 w-4" />
                    </button>
                    {mentionOpen && (
                      <div
                        ref={mentionPopRef}
                        className="absolute left-0 top-full z-20 mt-1 w-56 rounded-lg border border-line bg-card p-2 shadow-xl"
                      >
                        <input
                          autoFocus
                          value={mentionSearch}
                          onChange={(e) => setMentionSearch(e.target.value)}
                          placeholder="Buscar pessoa…"
                          className="mb-1.5 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
                        />
                        <div className="max-h-40 overflow-y-auto">
                          {filteredTeam.length === 0 ? (
                            <p className="px-1 py-1 text-xs text-foreground/40">Ninguém encontrado.</p>
                          ) : (
                            filteredTeam.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => insertMention(m)}
                                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-foreground/80 hover:bg-elevate/[0.05]"
                              >
                                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-elevate/[0.06] text-[9px] font-medium">
                                  {initials(teamMemberLabel(m))}
                                </span>
                                <span className="truncate">{teamMemberLabel(m)}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Anexar imagem ou PDF"
                    className="grid h-7 w-7 place-items-center rounded text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </div>
                <Button size="sm" onClick={submit} disabled={(!text.trim() && !pendingAttachments.length) || sending} loading={sending}>
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
                        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] font-medium text-[#323338] ring-1 ring-line">
                          {initials(n.authorName) || <UserCircle2 className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-[#323338]">{n.authorName}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-foreground/40" title={timeAgo(n.createdAt)}>
                                {formatDateTimeShort(n.createdAt)}
                              </span>
                              {editingNoteId !== n.id && (
                                <div className="hidden items-center gap-0.5 group-hover:flex">
                                  <button
                                    type="button"
                                    title="Editar"
                                    onClick={() => { setEditingNoteId(n.id); setEditingText(n.content) }}
                                    className="grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-accent"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Excluir"
                                    onClick={() => {
                                      if (window.confirm('Excluir esta atualização?')) void leadNotesService.deleteNote(n.id)
                                    }}
                                    className="grid h-5 w-5 place-items-center rounded text-foreground/35 transition-colors hover:text-danger"
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
                                className="w-full resize-y rounded-lg border border-accent/40 bg-surface px-3 py-2 text-sm text-[#323338] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
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
                                    leadNotesService.updateNote(n.id, editingText)
                                    setEditingNoteId(null)
                                  }}
                                  disabled={!editingText.trim()}
                                >
                                  Salvar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            n.content && <p className="mt-1 whitespace-pre-wrap text-sm text-[#323338]">{n.content}</p>
                          )}
                          {n.attachments.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {n.attachments.map((a) => (
                                a.type.startsWith('image/') ? (
                                  <a key={a.id} href={a.dataUrl} target="_blank" rel="noreferrer">
                                    <img src={a.dataUrl} alt={a.name} className="h-16 w-16 rounded object-cover ring-1 ring-line" />
                                  </a>
                                ) : (
                                  <a
                                    key={a.id}
                                    href={a.dataUrl}
                                    download={a.name}
                                    className="flex items-center gap-1.5 rounded-md border border-line bg-elevate/[0.03] px-2 py-1.5 text-xs text-foreground/70 hover:text-foreground"
                                  >
                                    <FileText className="h-3.5 w-3.5" /> {a.name}
                                  </a>
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
            <div className={cn('grid grid-cols-3 gap-3')}>
              {allAttachments.map(({ attachment: a, note: n }) => (
                <a
                  key={a.id}
                  href={a.dataUrl}
                  target={a.type.startsWith('image/') ? '_blank' : undefined}
                  download={a.type.startsWith('image/') ? undefined : a.name}
                  rel="noreferrer"
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
                </a>
              ))}
            </div>
          )
        )}

        {tab === 'activity' && (
          <p className="text-xs text-foreground/40">Em breve.</p>
        )}
      </div>
    </div>
  )
}
