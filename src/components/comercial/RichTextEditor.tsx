import * as React from 'react'
import { AlignCenter, Bold, Italic } from 'lucide-react'
import { cn } from '@/lib/utils'
import { stripHtml } from '@/lib/richText'

export interface RichTextEditorHandle {
  focus: () => void
  insertTextAtCursor: (text: string) => void
}

export interface RichTextEditorProps {
  /** Conteúdo em HTML — negrito/itálico/centralizado viram tags reais, não markdown. */
  value: string
  onChange: (html: string) => void
  onPasteFiles?: (files: File[]) => void
  placeholder?: string
  className?: string
}

function ToolbarButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      // Sem isso o clique tira o foco do editor antes do onClick rodar, e o execCommand
      // perde a seleção de texto que precisa pra aplicar o negrito/itálico nela.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded text-foreground/55 transition-colors hover:bg-elevate/[0.06] hover:text-foreground"
    >
      {icon}
    </button>
  )
}

/** Caixa de texto rico (negrito/itálico/centralizar) — estilo Monday: borda fica azul ao
 * focar, barra de ferramentas fixa em cima. Cresce sozinha com o conteúdo (div, não textarea). */
export const RichTextEditor = React.forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor({ value, onChange, onPasteFiles, placeholder, className }, ref) {
    const editorRef = React.useRef<HTMLDivElement>(null)
    const [empty, setEmpty] = React.useState(!stripHtml(value))

    React.useEffect(() => {
      // Só reescreve o DOM quando o valor muda por fora (ex.: limpar após enviar) — nunca
      // enquanto a pessoa está digitando, senão o cursor pula pro início a cada tecla.
      if (editorRef.current && editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value
        setEmpty(!stripHtml(value))
      }
    }, [value])

    React.useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      insertTextAtCursor: (text: string) => {
        editorRef.current?.focus()
        document.execCommand('insertText', false, text)
      },
    }))

    const emitChange = () => {
      const html = editorRef.current?.innerHTML ?? ''
      setEmpty(!stripHtml(html))
      onChange(html)
    }

    const exec = (command: string) => {
      editorRef.current?.focus()
      document.execCommand(command)
      emitChange()
    }

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      const files = Array.from(e.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((f): f is File => !!f)
      if (files.length && onPasteFiles) {
        e.preventDefault()
        onPasteFiles(files)
        return
      }
      // Sempre cola como texto puro — não deixa entrar fonte/cor/estilo estranho de outro app.
      e.preventDefault()
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
      emitChange()
    }

    return (
      <div className={cn(className)}>
        <div className="-mx-3 -mt-3 mb-2 flex items-center gap-0.5 border-b border-line/70 px-1.5 py-1">
          <ToolbarButton icon={<Bold className="h-3.5 w-3.5" />} title="Negrito" onClick={() => exec('bold')} />
          <ToolbarButton icon={<Italic className="h-3.5 w-3.5" />} title="Itálico" onClick={() => exec('italic')} />
          <ToolbarButton icon={<AlignCenter className="h-3.5 w-3.5" />} title="Centralizar" onClick={() => exec('justifyCenter')} />
        </div>
        <div className="relative">
          {empty && placeholder && (
            <span className="pointer-events-none absolute left-0 top-0 text-sm text-foreground/30">{placeholder}</span>
          )}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={emitChange}
            onPaste={handlePaste}
            className="max-h-[40vh] min-h-[54px] w-full overflow-y-auto text-sm text-[#323338] outline-none"
          />
        </div>
      </div>
    )
  },
)
