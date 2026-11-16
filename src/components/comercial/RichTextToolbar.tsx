import * as React from 'react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, Italic, Minus, Palette, Plus, Underline } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Barra de formatação básica (negrito/itálico/sublinhado/cor/limpar) pra um <div contentEditable>
 * qualquer — usa document.execCommand em vez de trazer um editor rich-text de verdade (tiptap/
 * quill/etc. não existem no projeto), mesmo espírito minimalista do resto do Comercial. */
export function RichTextToolbar({ targetRef, className, extras = false }: { targetRef: React.RefObject<HTMLDivElement | null>; className?: string; extras?: boolean }) {
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
      {extras && (
        <>
          <span className="mx-1 h-5 w-px bg-line/70" />
          <ToolbarButton onClick={() => exec('justifyLeft')} title="Alinhar à esquerda"><AlignLeft className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec('justifyCenter')} title="Centralizar"><AlignCenter className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec('justifyRight')} title="Alinhar à direita"><AlignRight className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton onClick={() => exec('justifyFull')} title="Justificar"><AlignJustify className="h-3.5 w-3.5" /></ToolbarButton>
          <span className="mx-1 h-5 w-px bg-line/70" />
          {/* Só fontes que o servidor (Chromium no Linux) tem de verdade, pra o PDF sair igual à tela. */}
          <select
            title="Fonte do trecho selecionado"
            defaultValue=""
            onMouseDown={saveSelection}
            onChange={(e) => {
              const fonte = e.target.value
              e.target.value = ''
              if (!fonte) return
              const sel = window.getSelection()
              if (sel && savedRange.current) { sel.removeAllRanges(); sel.addRange(savedRange.current) }
              exec('fontName', fonte)
            }}
            className="h-8 rounded-md border border-line bg-card px-2 text-xs text-foreground/70 outline-none hover:bg-elevate/[0.06]"
          >
            <option value="">Fonte…</option>
            <option value="Arial">Arial</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
          </select>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // Arial no documento inteiro (colar do Word costuma trazer outras fontes).
              const alvo = targetRef.current
              if (!alvo) return
              alvo.focus()
              document.execCommand('selectAll', false)
              document.execCommand('fontName', false, 'Arial')
              window.getSelection()?.collapseToEnd()
            }}
            title="Aplicar a fonte Arial em todo o texto"
            className="h-8 shrink-0 rounded-md border border-line px-2 text-xs font-medium text-foreground/60 transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
          >
            Arial em tudo
          </button>
        </>
      )}
    </div>
  )
}

/** Zoom do papel (50% a 200%) — só muda como aparece na tela, não o documento nem o PDF. */
export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export function ZoomBar({ value, onChange, className }: { value: number; onChange: React.Dispatch<React.SetStateAction<number>>; className?: string }) {
  // Função de atualização (não o valor já calculado): cliques seguidos somam certo mesmo antes da tela redesenhar.
  const mudar = (delta: number) => onChange((v) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v + delta)))
  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      <ToolbarButton onClick={() => mudar(-10)} title="Diminuir o zoom"><Minus className="h-3.5 w-3.5" /></ToolbarButton>
      <button
        type="button"
        onClick={() => onChange(100)}
        title="Voltar a 100%"
        className="h-8 min-w-[3.25rem] rounded-md border border-line px-2 text-xs font-medium tabular-nums text-foreground/60 hover:bg-elevate/[0.06] hover:text-foreground"
      >
        {value}%
      </button>
      <ToolbarButton onClick={() => mudar(10)} title="Aumentar o zoom"><Plus className="h-3.5 w-3.5" /></ToolbarButton>
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
