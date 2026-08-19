import { toast } from 'sonner'
import { api, onSseEvent } from '@/services/api'
import type { LeadNote, LeadNoteAttachment } from '@/types/leadBoard'

type NoteRow = {
  id: string; lead_row_id: string; author_id: string | null; author_name: string
  content: string; attachments: LeadNoteAttachment[] | null; created_at: string
}
function rowToNote(r: NoteRow): LeadNote {
  return {
    id: r.id, leadRowId: r.lead_row_id, authorId: r.author_id,
    authorName: r.author_name, content: r.content, attachments: r.attachments ?? [],
    createdAt: r.created_at,
  }
}

// ---------- Cache (carregado sob demanda por lead, igual às mensagens de ticket) ----------

let notes: LeadNote[] = []
const loadedLeadIds = new Set<string>()

const subs = new Set<() => void>()
function notify() { for (const fn of subs) fn() }

let unsubSse: (() => void) | null = null
function ensureRealtime() {
  if (unsubSse) return
  unsubSse = onSseEvent((table, type, data) => {
    if (table !== 'lead_notes') return
    if (type === 'DELETE') {
      const id = (data as { id?: string }).id
      if (id) notes = notes.filter((n) => n.id !== id)
      notify()
      return
    }
    // Payloads muito grandes (ex.: anexo pesado) chegam truncados só com
    // {id} — ignora em vez de gravar uma nota incompleta no cache; quem
    // enviou já recebeu a nota completa via retorno do POST.
    const row = data as Partial<NoteRow>
    if (typeof row.content !== 'string' || typeof row.author_name !== 'string') return
    const next = rowToNote(row as NoteRow)
    const idx = notes.findIndex((n) => n.id === next.id)
    if (idx === -1) notes = [next, ...notes]
    else { const copy = notes.slice(); copy[idx] = next; notes = copy }
    notify()
  })
}

export const leadNotesService = {
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn) } },

  /** Referência crua do cache — filtrar/ordenar por leadRowId fica por conta do hook (useMemo). */
  getAllNotes(): LeadNote[] { return notes },

  isLoaded(leadRowId: string): boolean { return loadedLeadIds.has(leadRowId) },

  async loadNotes(leadRowId: string): Promise<void> {
    ensureRealtime()
    try {
      const rows = await api.get<NoteRow[]>(`/api/lead-notes?lead_row_id=${leadRowId}`)
      const fresh = rows.map(rowToNote)
      notes = [...notes.filter((n) => n.leadRowId !== leadRowId), ...fresh]
      loadedLeadIds.add(leadRowId)
      notify()
    } catch (err) {
      toast.error('Falha ao carregar anotações: ' + (err as Error).message)
    }
  },

  async addNote(
    leadRowId: string,
    content: string,
    authorName: string,
    attachments: LeadNoteAttachment[] = [],
  ): Promise<LeadNote | null> {
    const trimmed = content.trim()
    if (!trimmed && attachments.length === 0) return null
    try {
      const row = await api.post<NoteRow>('/api/lead-notes', {
        lead_row_id: leadRowId, content: trimmed, author_name: authorName, attachments,
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
}
