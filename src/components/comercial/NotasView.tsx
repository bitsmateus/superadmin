import * as React from 'react'
import { toast } from 'sonner'
import { CalendarDays, Loader2, Trash2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { RichTextToolbar } from '@/components/comercial/RichTextToolbar'
import { usePageNotes, usePageNotesLoaded } from '@/hooks/usePageNotes'
import { useLeadPages } from '@/hooks/useLeadPages'
import { pageNotesService, type PageNote } from '@/services/pageNotes'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS_LONG = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
const MONTHS_LONG = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function formatDayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return `${WEEKDAYS_LONG[date.getDay()]}, ${d} de ${MONTHS_LONG[m - 1]} de ${y}`
}

/** Aba marcada is_notas — em vez do quadro de captação de leads, é só um bloco de notas: uma
 * entrada por dia, com formatação básica (negrito/cor/etc.), pra lembrar do que precisa fazer. Sem
 * quadros, kanban, métricas, SDR ou filtro — de propósito, é pra ficar simples. */
export function NotasView({ pageId }: { pageId: string }) {
  const pages = useLeadPages()
  const page = pages.find((p) => p.id === pageId)
  const loaded = usePageNotesLoaded(pageId)
  const notes = usePageNotes(pageId)
  const today = todayStr()
  const todayNote = notes.find((n) => n.noteDate === today) ?? null
  const pastNotes = notes.filter((n) => n.noteDate !== today)

  return (
    <>
      <TopBar title={page?.name ?? 'Notas'} subtitle="Comercial · bloco de notas" />
      <div className="mx-auto max-w-[800px] space-y-4 px-1 pb-8">
        {!loaded ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
          </div>
        ) : (
          <>
            <NoteCard pageId={pageId} noteDate={today} note={todayNote} isToday />
            {pastNotes.map((n) => (
              <NoteCard key={n.id} pageId={pageId} noteDate={n.noteDate} note={n} />
            ))}
            {pastNotes.length === 0 && (
              <p className="py-6 text-center text-xs text-foreground/40">Nenhuma nota de dias anteriores ainda.</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

function NoteCard({
  pageId,
  noteDate,
  note,
  isToday,
}: {
  pageId: string
  noteDate: string
  note: PageNote | null
  isToday?: boolean
}) {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  // O contentEditable só recebe o texto salvo UMA VEZ, na primeira renderização — depois disso ele
  // é dono do próprio conteúdo. Sem essa trava, a nota de hoje passaria de null pra um objeto real
  // assim que o primeiro autosave voltasse do servidor, o efeito rodaria de novo e sobrescreveria
  // o innerHTML no meio da digitação (perdendo o cursor).
  const loadedOnce = React.useRef(false)

  React.useEffect(() => {
    if (loadedOnce.current || !bodyRef.current) return
    bodyRef.current.innerHTML = note?.content ?? ''
    loadedOnce.current = true
  }, [note])

  const debouncedSave = useDebouncedCallback((html: string) => {
    void pageNotesService.upsert(pageId, noteDate, html)
  }, 600)

  const removeNote = () => {
    if (!note) return
    if (!window.confirm(`Excluir a nota de ${formatDayLabel(noteDate)}?`)) return
    void pageNotesService.remove(note.id)
    toast.success('Nota excluída.')
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-accent" />
          {isToday ? `Hoje — ${formatDayLabel(noteDate)}` : formatDayLabel(noteDate)}
        </span>
        {note && (
          <button
            type="button"
            onClick={removeNote}
            title="Excluir nota deste dia"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/40 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="p-4">
        <RichTextToolbar targetRef={bodyRef} className="mb-2" />
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => debouncedSave((e.target as HTMLDivElement).innerHTML)}
          className="min-h-[80px] rounded-lg border border-line/60 bg-elevate/[0.02] p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-accent/30"
          style={{ color: '#000000' }}
        />
      </div>
    </div>
  )
}
