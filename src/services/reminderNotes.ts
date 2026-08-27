import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { ReminderNote, ReminderNoteAttachment } from '@/types/ticket'

type NoteRow = {
  id: string; reminder_id: string; author_id: string | null; author_name: string
  content: string; attachments: ReminderNoteAttachment[] | null; created_at: string
}
function rowToNote(r: NoteRow): ReminderNote {
  return {
    id: r.id, reminderId: r.reminder_id, authorId: r.author_id,
    authorName: r.author_name, content: r.content, attachments: r.attachments ?? [],
    createdAt: r.created_at,
  }
}

// ---------- Cache (carregado sob demanda por tarefa, mesmo padrão de leadNotes.ts) ----------

let notes: ReminderNote[] = []
const loadedReminderIds = new Set<string>()

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'reminder_notes') return
    if (type === 'DELETE') {
      const id = (data as { id?: string }).id
      if (id) notes = notes.filter((n) => n.id !== id)
      notify()
      return
    }
    const row = data as Partial<NoteRow>
    if (typeof row.content !== 'string' || typeof row.author_name !== 'string') return
    const next = rowToNote(row as NoteRow)
    const idx = notes.findIndex((n) => n.id === next.id)
    if (idx === -1) notes = [next, ...notes]
    else { const copy = notes.slice(); copy[idx] = next; notes = copy }
    notify()
  })
}

export const reminderNotesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },
  getAllNotes(): ReminderNote[] { return notes },
  isLoaded(reminderId: string): boolean { return loadedReminderIds.has(reminderId) },

  async loadNotes(reminderId: string): Promise<void> {
    ensureRealtime()
    try {
      const rows = await api.get<NoteRow[]>(`/api/reminder-notes?reminder_id=${reminderId}`)
      const fresh = rows.map(rowToNote)
      notes = [...notes.filter((n) => n.reminderId !== reminderId), ...fresh]
      loadedReminderIds.add(reminderId)
      notify()
    } catch (err) {
      toast.error('Falha ao carregar atualizações: ' + (err as Error).message)
    }
  },

  async addNote(
    reminderId: string,
    content: string,
    authorName: string,
    attachments: ReminderNoteAttachment[] = [],
  ): Promise<ReminderNote | null> {
    const trimmed = content.trim()
    if (!trimmed && attachments.length === 0) return null
    try {
      const row = await api.post<NoteRow>('/api/reminder-notes', {
        reminder_id: reminderId, content: trimmed, author_name: authorName, attachments,
      })
      const note = rowToNote(row)
      notes = [note, ...notes]
      notify()
      return note
    } catch (err) {
      toast.error('Falha ao enviar atualização: ' + (err as Error).message)
      return null
    }
  },

  updateNote(id: string, content: string): void {
    const trimmed = content.trim()
    if (!trimmed) return
    const idx = notes.findIndex((n) => n.id === id)
    if (idx === -1) return
    const prev = notes[idx]
    const next = { ...prev, content: trimmed }
    const copy = notes.slice(); copy[idx] = next; notes = copy
    notify()

    void (async () => {
      try {
        await api.patch(`/api/reminder-notes/${id}`, { content: trimmed })
      } catch (err) {
        const rollback = notes.slice()
        const ridx = rollback.findIndex((n) => n.id === id)
        if (ridx !== -1) rollback[ridx] = prev
        notes = rollback
        notify()
        toast.error('Falha ao editar atualização: ' + (err as Error).message)
      }
    })()
  },

  async deleteNote(id: string): Promise<void> {
    const prev = notes
    notes = notes.filter((n) => n.id !== id)
    notify()
    try {
      await api.delete(`/api/reminder-notes/${id}`)
    } catch (err) {
      notes = prev
      notify()
      toast.error('Falha ao excluir atualização: ' + (err as Error).message)
    }
  },
}
