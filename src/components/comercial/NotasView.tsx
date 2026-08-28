import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { RichTextToolbar } from '@/components/comercial/RichTextToolbar'
import { usePageNotes, usePageNotesLoaded } from '@/hooks/usePageNotes'
import { useLeadPages } from '@/hooks/useLeadPages'
import { pageNotesService } from '@/services/pageNotes'
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback'

// Bloco de notas único por página — sem separação por dia, sem botão de salvar (autosave contínuo).
// A tabela page_notes ainda guarda 1 linha por (page_id, note_date); aqui sempre usamos a mesma
// data-sentinela pra virar, na prática, uma nota só que nunca "vira o dia".
const SINGLE_NOTE_DATE = '2000-01-01'

/** Aba marcada is_notas — em vez do quadro de captação de leads, é só um bloco de notas único (tipo
 * o Bloco de Notas do Windows/Mac): sem quadros, kanban, métricas, SDR ou filtro — de propósito,
 * pra ficar simples. */
export function NotasView({ pageId }: { pageId: string }) {
  const pages = useLeadPages()
  const page = pages.find((p) => p.id === pageId)
  const loaded = usePageNotesLoaded(pageId)
  const notes = usePageNotes(pageId)
  const note = notes.find((n) => n.noteDate === SINGLE_NOTE_DATE) ?? null

  const bodyRef = React.useRef<HTMLDivElement>(null)
  // O contentEditable só recebe o texto salvo UMA VEZ, na primeira renderização — depois disso ele
  // é dono do próprio conteúdo. Sem essa trava, a nota passaria de null pra um objeto real assim
  // que o primeiro autosave voltasse do servidor, o efeito rodaria de novo e sobrescreveria o
  // innerHTML no meio da digitação (perdendo o cursor).
  const loadedOnce = React.useRef(false)

  React.useEffect(() => {
    if (loadedOnce.current || !bodyRef.current || !loaded) return
    bodyRef.current.innerHTML = note?.content ?? ''
    loadedOnce.current = true
  }, [note, loaded])

  const debouncedSave = useDebouncedCallback((html: string) => {
    void pageNotesService.upsert(pageId, SINGLE_NOTE_DATE, html)
  }, 600)

  return (
    <>
      <TopBar title={page?.name ?? 'Notas'} subtitle="Comercial · bloco de notas" />
      <div className="mx-auto max-w-[800px] px-1 pb-8">
        {!loaded ? (
          <div className="grid min-h-[30vh] place-items-center text-sm text-foreground/50">
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</span>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
            <div className="p-4">
              <RichTextToolbar targetRef={bodyRef} className="mb-2" />
              <div
                ref={bodyRef}
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => debouncedSave((e.target as HTMLDivElement).innerHTML)}
                className="min-h-[70vh] rounded-lg border border-line/60 bg-elevate/[0.02] p-3 text-sm leading-relaxed outline-none focus:ring-1 focus:ring-accent/30"
                style={{ color: '#000000' }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
