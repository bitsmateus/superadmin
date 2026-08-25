import * as React from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  ArrowRight,
  ArrowRightLeft,
  AtSign,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  FileText,
  Hash,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pencil,
  Phone,
  Sparkles,
  Trash2,
  Type,
  UserCircle2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { EditableField } from '@/components/comercial/EditableField'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import { RetornarField } from '@/components/comercial/RetornarField'
import { AgendamentoField } from '@/components/comercial/AgendamentoField'
import { LeadLabelCell } from '@/components/comercial/LeadLabelCell'
import { RichTextEditor, type RichTextEditorHandle } from '@/components/comercial/RichTextEditor'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useAuth } from '@/hooks/useAuth'
import { useLeadBoards, useLeadRow } from '@/hooks/useLeadBoards'
import { useLeadNotes } from '@/hooks/useLeadNotes'
import { useLeadEvents } from '@/hooks/useLeadEvents'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { useTeam, teamMemberLabel, type TeamMember } from '@/hooks/useTeam'
import { leadBoardsService } from '@/services/leadBoards'
import { leadNotesService } from '@/services/leadNotes'
import { leadEventsService } from '@/services/leadEvents'
import { leadLabelsService } from '@/services/leadLabels'
import { cn, formatDateTimeShort, initials } from '@/lib/utils'
import { sanitizeHtml, stripHtml } from '@/lib/richText'
import { timeAgo } from '@/lib/time'
import type { LeadEvent, LeadNoteAttachment } from '@/types/leadBoard'

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
            <FieldRow icon={<Phone className="h-3.5 w-3.5" />} label="Telefone" required>
              <BoxedField value={row.telefone} onSave={(v) => leadBoardsService.updateRow(row.id, { telefone: v })} required />
            </FieldRow>
            <FieldRow icon={<Circle className="h-3.5 w-3.5" />} label="Tipo">
              <LeadLabelCell field="tipo" value={row.tipo} onChange={(v) => leadBoardsService.updateRow(row.id, { tipo: v })} pageId={board?.page} />
            </FieldRow>
            <FieldRow icon={<Calendar className="h-3.5 w-3.5" />} label="Dia de contato" required>
              <LeadLabelCell field="diaContato" value={row.diaContato} onChange={(v) => leadBoardsService.updateRow(row.id, { diaContato: v })} required pageId={board?.page} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Ligação">
              <LeadLabelCell field="ligacao" value={row.ligacao} onChange={(v) => leadBoardsService.updateRow(row.id, { ligacao: v })} pageId={board?.page} />
            </FieldRow>
            <FieldRow icon={<Circle className="h-3.5 w-3.5" />} label="Status" required>
              <LeadLabelCell field="status" value={row.status} onChange={(v) => leadBoardsService.updateRow(row.id, { status: v })} required pageId={board?.page} />
            </FieldRow>
            <FieldRow icon={<UserCircle2 className="h-3.5 w-3.5" />} label="SDR">
              <LeadLabelCell field="sdr" value={row.sdr} onChange={(v) => leadBoardsService.updateRow(row.id, { sdr: v })} />
            </FieldRow>
            <FieldRow icon={<Calendar className="h-3.5 w-3.5" />} label="Agendamento">
              <AgendamentoField
                value={row.agendamento}
                onChange={(next) => leadBoardsService.updateRow(row.id, { agendamento: next })}
                className="rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-[#323338]"
              />
            </FieldRow>
            <FieldRow icon={<Calendar className="h-3.5 w-3.5" />} label="Retornar">
              <RetornarField
                value={row.retornar}
                retornado={row.retornado}
                onChange={(patch) => leadBoardsService.updateRow(row.id, patch)}
                className="rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-[#323338]"
              />
            </FieldRow>
            <FieldRow icon={<Type className="h-3.5 w-3.5" />} label="Dor do cliente">
              <BoxedField value={row.dorCliente} onSave={(v) => leadBoardsService.updateRow(row.id, { dorCliente: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Nº atendentes">
              <BoxedField value={row.numeroAtendentes} onSave={(v) => leadBoardsService.updateRow(row.id, { numeroAtendentes: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Valor MRR">
              <BoxedCurrencyField value={row.valorMrr} onSave={(v) => leadBoardsService.updateRow(row.id, { valorMrr: v })} />
            </FieldRow>
            <FieldRow icon={<Hash className="h-3.5 w-3.5" />} label="Valor Implementação">
              <BoxedCurrencyField value={row.valorImplementacao} onSave={(v) => leadBoardsService.updateRow(row.id, { valorImplementacao: v })} />
            </FieldRow>
            <FieldRow icon={<Clock className="h-3.5 w-3.5" />} label="Log de criação">
              <div className="rounded-md bg-elevate/[0.03] px-2 py-1.5 text-xs text-foreground/40">
                {formatDateTimeShort(row.createdAt)}
              </div>
            </FieldRow>
          </div>

          <UpdatesPane leadRowId={row.id} pageId={board?.page} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function FieldRow({ icon, label, required, children }: { icon: React.ReactNode; label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line/60 py-1.5">
      <span className="flex w-5 shrink-0 items-center justify-center text-[#323338]/60">{icon}</span>
      <span className="w-[104px] shrink-0 text-xs font-medium text-[#323338]">
        {label}
        {required && <span className="text-red-400" title="Obrigatório"> *</span>}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function BoxedField({ value, onSave, type, required }: { value: string; onSave: (v: string) => void; type?: 'text' | 'date' | 'datetime-local'; required?: boolean }) {
  return (
    <EditableField
      value={value}
      type={type}
      placeholder={required ? 'Obrigatório' : undefined}
      onSave={onSave}
      className={cn(
        'rounded-md px-2 py-1.5 text-sm text-[#323338]',
        required && !value ? 'bg-red-50 ring-1 ring-inset ring-red-200' : 'bg-elevate/[0.05]',
      )}
    />
  )
}

function BoxedCurrencyField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <CurrencyField
      value={value}
      onSave={onSave}
      className="rounded-md bg-elevate/[0.05] px-2 py-1.5 text-sm text-[#323338]"
    />
  )
}

interface EventChip { label: string; color: string }
interface EventDescription {
  icon: React.ReactNode
  text: string
  from?: EventChip
  to?: EventChip
}
interface EventColorMaps {
  status: Record<string, string>
  diaContato: Record<string, string>
  sdr: Record<string, string>
  board: Record<string, string>
}

/** Traduz um evento automático (status/dia de contato/SDR/quadro/retornado/criação) pra texto +
 * etiquetas coloridas, usando as mesmas cores cadastradas em "Editar etiquetas" e nos quadros. */
function describeEvent(e: LeadEvent, colors: EventColorMaps): EventDescription {
  const chip = (value: string | null, map: Record<string, string>): EventChip | undefined =>
    value ? { label: value, color: map[value] ?? '#9CA3AF' } : undefined

  switch (e.type) {
    case 'created':
      return { icon: <Sparkles className="h-3.5 w-3.5" />, text: 'Lead chegou' }
    case 'status':
      return {
        icon: <Circle className="h-3.5 w-3.5" />,
        text: e.fromValue ? 'Status' : 'Status definido como',
        from: chip(e.fromValue, colors.status),
        to: chip(e.toValue, colors.status),
      }
    case 'dia_contato':
      return {
        icon: <Calendar className="h-3.5 w-3.5" />,
        text: e.fromValue ? 'Dia de contato' : 'Dia de contato definido como',
        from: chip(e.fromValue, colors.diaContato),
        to: chip(e.toValue, colors.diaContato),
      }
    case 'sdr':
      return {
        icon: <UserCircle2 className="h-3.5 w-3.5" />,
        text: e.fromValue ? 'SDR' : 'SDR assumiu o lead',
        from: chip(e.fromValue, colors.sdr),
        to: chip(e.toValue, colors.sdr),
      }
    case 'board':
      return {
        icon: <ArrowRightLeft className="h-3.5 w-3.5" />,
        text: e.fromValue ? 'Movido de quadro' : 'Entrou no quadro',
        from: chip(e.fromValue, colors.board),
        to: chip(e.toValue, colors.board),
      }
    case 'retornado':
      return {
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
        text: '',
        to: e.toValue === 'true'
          ? { label: 'Marcado como retornado', color: '#15803D' }
          : { label: 'Desmarcado como retornado', color: '#9CA3AF' },
      }
    default:
      return { icon: <Sparkles className="h-3.5 w-3.5" />, text: 'Atualização' }
  }
}

function UpdatesPane({ leadRowId, pageId }: { leadRowId: string; pageId?: string }) {
  const { profile } = useAuth()
  const notes = useLeadNotes(leadRowId)
  const events = useLeadEvents(leadRowId)
  const statusLabels = useLeadLabels('status', pageId)
  const diaContatoLabels = useLeadLabels('diaContato', pageId)
  const sdrLabels = useLeadLabels('sdr')
  const allBoards = useLeadBoards()
  const team = useTeam()
  const [tab, setTab] = React.useState('updates')
  const [text, setText] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [pendingAttachments, setPendingAttachments] = React.useState<LeadNoteAttachment[]>([])
  const [mentionOpen, setMentionOpen] = React.useState(false)
  const [mentionSearch, setMentionSearch] = React.useState('')
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState('')
  const [preview, setPreview] = React.useState<LeadNoteAttachment | null>(null)

  const editorRef = React.useRef<RichTextEditorHandle>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const mentionBtnRef = React.useRef<HTMLButtonElement>(null)
  const mentionPopRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(mentionPopRef, mentionOpen, () => setMentionOpen(false))

  React.useEffect(() => { void leadNotesService.loadNotes(leadRowId) }, [leadRowId])
  React.useEffect(() => { void leadEventsService.loadEvents(leadRowId) }, [leadRowId])
  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])

  const eventColors = React.useMemo<EventColorMaps>(() => ({
    status: Object.fromEntries(statusLabels.map((l) => [l.name, l.color])),
    diaContato: Object.fromEntries(diaContatoLabels.map((l) => [l.name, l.color])),
    sdr: Object.fromEntries(sdrLabels.map((l) => [l.name, l.color])),
    board: Object.fromEntries(allBoards.map((b) => [b.name, b.color])),
  }), [statusLabels, diaContatoLabels, sdrLabels, allBoards])

  const allAttachments = React.useMemo(
    () => notes.flatMap((n) => n.attachments.map((a) => ({ attachment: a, note: n }))),
    [notes],
  )

  // Linha do tempo automática: junta os eventos gravados pelo backend (chegada, mudança de
  // status/dia de contato/SDR/quadro, retornado) com as próprias atualizações, por ordem de hora.
  // Atualiza em tempo real — events/notes já são reativos via SSE (useLeadEvents/useLeadNotes).
  const timelineItems = React.useMemo(() => {
    const fromEvents = events.map((e) => {
      const desc = describeEvent(e, eventColors)
      return { id: e.id, at: e.createdAt, actor: e.actorName, ...desc }
    })
    const fromNotes = notes.map((n) => {
      const plain = stripHtml(n.content)
      return {
      id: `note-${n.id}`,
      at: n.createdAt,
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      text: plain
        ? `Atualização: "${plain.length > 90 ? plain.slice(0, 90) + '…' : plain}"`
        : n.attachments.length > 0 ? 'Anexou um arquivo' : 'Atualização',
      from: undefined as EventChip | undefined,
      to: undefined as EventChip | undefined,
      actor: n.authorName,
      }
    })
    return [...fromEvents, ...fromNotes].sort((a, b) => b.at.localeCompare(a.at))
  }, [events, notes, eventColors])

  const filteredTeam = React.useMemo(
    () => team.filter((m) => teamMemberLabel(m).toLowerCase().includes(mentionSearch.toLowerCase())),
    [team, mentionSearch],
  )

  const insertMention = (m: TeamMember) => {
    const label = `@${teamMemberLabel(m)} `
    if (editorRef.current) {
      editorRef.current.insertTextAtCursor(label)
    } else {
      setText((t) => t + label)
    }
    setMentionOpen(false)
    setMentionSearch('')
  }

  const handleFiles = async (files: File[]) => {
    if (!files.length) return
    const next: LeadNoteAttachment[] = []
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

  const downloadAttachment = (a: LeadNoteAttachment) => {
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
          { value: 'timeline', label: 'Linha do tempo' },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'updates' && (
          <>
            <div className="rounded-lg border border-line p-3 transition-colors focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
              <RichTextEditor
                ref={editorRef}
                value={text}
                onChange={setText}
                onPasteFiles={handleFiles}
                placeholder="Escreva uma atualização, cole um print (Ctrl+V) e mencione outros com @"
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
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                    multiple
                    className="hidden"
                    onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
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
                                    onClick={() => { setEditingNoteId(n.id); setEditingText(stripHtml(n.content)) }}
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
                            stripHtml(n.content) && (
                              <div
                                className="mt-1 whitespace-pre-wrap text-sm text-[#323338]"
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
                                    <img src={a.dataUrl} alt={a.name} className="max-h-72 max-w-full object-contain" />
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
            <div className={cn('grid grid-cols-3 gap-3')}>
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
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-[#323338]">
                    {item.text && <span>{item.text}</span>}
                    {item.from && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                        style={{ backgroundColor: item.from.color }}
                      >
                        {item.from.label}
                      </span>
                    )}
                    {item.from && item.to && <ArrowRight className="h-3 w-3 shrink-0 text-foreground/30" />}
                    {item.to && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                        style={{ backgroundColor: item.to.color }}
                      >
                        {item.to.label}
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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 animate-fade-in"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-full max-w-full flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
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
              <img
                src={preview.dataUrl}
                alt={preview.name}
                className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
              />
            ) : preview.type === 'application/pdf' ? (
              <iframe
                src={preview.dataUrl}
                title={preview.name}
                className="h-[80vh] w-[90vw] rounded-lg bg-white"
              />
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
