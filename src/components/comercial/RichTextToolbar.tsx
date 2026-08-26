import * as React from 'react'
import { Bold, Eraser, Italic, Palette, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Barra de formatação básica (negrito/itálico/sublinhado/cor/limpar) pra um <div contentEditable>
 * qualquer — usa document.execCommand em vez de trazer um editor rich-text de verdade (tiptap/
 * quill/etc. não existem no projeto), mesmo espírito minimalista do resto do Comercial. */
export function RichTextToolbar({ targetRef, className }: { targetRef: React.RefObject<HTMLDivElement | null>; className?: string }) {
  // O <input type="color"> nativo rouba o foco do contentEditable assim que abre, o que apaga a
  // seleção de texto antes do usuário escolher a cor — guarda o range aqui no mousedown (antes do
  // picker abrir) e restaura no onChange, senão "foreColor" aplicaria sem nada selecionado.
  const savedRange = React.useRef<Range | null>(null)

  const exec = (command: string, value?: string) => {
    targetRef.current?.focus()
    document.execCommand(command, false, value)
  }

  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
  }

  const applyColor = (color: string) => {
    const sel = window.getSelection()
    if (sel && savedRange.current) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
    exec('foreColor', color)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 rounded-lg border border-line/60 bg-elevate/[0.02] p-1.5', className)}>
      <ToolbarButton onClick={() => exec('bold')} title="Negrito"><Bold className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => exec('italic')} title="Itálico"><Italic className="h-3.5 w-3.5" /></ToolbarButton>
      <ToolbarButton onClick={() => exec('underline')} title="Sublinhado"><Underline className="h-3.5 w-3.5" /></ToolbarButton>
      <label
        onMouseDown={saveSelection}
        title="Cor do texto"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 text-foreground/60 transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
      >
        <Palette className="h-3.5 w-3.5" />
        <input
          type="color"
          onChange={(e) => applyColor(e.target.value)}
          className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
        />
      </label>
      <ToolbarButton onClick={() => exec('removeFormat')} title="Limpar formatação"><Eraser className="h-3.5 w-3.5" /></ToolbarButton>
    </div>
  )
}

function ToolbarButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-foreground/60 transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
    >
      {children}
    </button>
  )
}
