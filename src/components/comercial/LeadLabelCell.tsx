import * as React from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { useLeadLabels } from '@/hooks/useLeadLabels'
import { leadLabelsService } from '@/services/leadLabels'
import { cn } from '@/lib/utils'
import type { LeadLabelField } from '@/types/leadBoard'

const FIELD_TITLES: Record<LeadLabelField, string> = {
  tipo: 'Tipo',
  diaContato: 'Dia de contato',
  status: 'Status',
  sdr: 'SDR',
  ligacao: 'Ligação',
}

export interface LeadLabelCellProps {
  field: LeadLabelField
  value: string
  onChange: (next: string) => void
  /** Marca a célula vazia como pendência obrigatória (borda/tom vermelho + "Obrigatório"). */
  required?: boolean
  /** Aba dona das etiquetas — obrigatório pra tudo, exceto "sdr" (continua global). */
  pageId?: string
}

export function LeadLabelCell({ field, value, onChange, required, pageId }: LeadLabelCellProps) {
  const labels = useLeadLabels(field, pageId)
  const [open, setOpen] = React.useState(false)
  const [manageOpen, setManageOpen] = React.useState(false)
  const [coords, setCoords] = React.useState<{ top?: number; bottom?: number; left: number } | null>(null)
  const btnRef = React.useRef<HTMLButtonElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  useOutsideClose(popRef, open, () => setOpen(false))

  React.useEffect(() => { void leadLabelsService.ensureLoaded() }, [])

  const current = labels.find((l) => l.name === value)

  const openPicker = () => {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - 328)
      // Linha perto do fim da tela: abre pra CIMA (ancorado por "bottom") em vez de sempre pra
      // baixo — senão a lista de etiquetas nascia fora da área visível e só dava pra ver rolando
      // a página. Mesmo mecanismo do Agendamento/Retornar.
      const spaceBelow = window.innerHeight - rect.bottom
      if (spaceBelow < 260 && rect.top > spaceBelow) {
        setCoords({ bottom: window.innerHeight - rect.top + 4, left })
      } else {
        setCoords({ top: rect.bottom + 4, left })
      }
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        title={!value && required ? 'Obrigatório' : undefined}
        className={cn(
          'flex h-full min-h-[34px] w-full items-center truncate px-2.5 py-1.5 text-sm font-medium',
          field === 'tipo' ? 'justify-start text-left' : 'justify-center text-center',
          value ? 'text-white' : required ? 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/30' : 'text-foreground/30',
        )}
        style={value ? { backgroundColor: current?.color ?? '#9CA3AF' } : undefined}
      >
        {value ? value : required ? 'Obrigatório' : 'Selecionar…'}
      </button>

      {open && coords && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            left: coords.left,
            ...(coords.top !== undefined ? { top: coords.top } : { bottom: coords.bottom }),
          }}
          className="z-50 flex max-h-[60vh] w-72 flex-col rounded-xl border border-line bg-card p-2.5 shadow-xl"
        >
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto">
            {field !== 'ligacao' && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false) }}
                className="rounded-md border border-dashed border-line px-2 py-1.5 text-xs text-foreground/40 hover:bg-elevate/[0.04]"
              >
                Nenhum
              </button>
            )}
            {labels.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => { onChange(l.name); setOpen(false) }}
                className={cn(
                  'truncate rounded-md px-2 py-1.5 text-xs font-medium text-white hover:opacity-90',
                  l.name === value && 'ring-2 ring-foreground/40 ring-offset-1',
                )}
                style={{ backgroundColor: l.color }}
              >
                {l.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { setOpen(false); setManageOpen(true) }}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-foreground/50 hover:bg-elevate/[0.04]"
          >
            <Pencil className="h-3 w-3" />
            Editar etiquetas
          </button>
        </div>,
        document.body,
      )}

      <ManageLabelsModal field={field} pageId={pageId} open={manageOpen} onClose={() => setManageOpen(false)} />
    </>
  )
}

function ManageLabelsModal({
  field, pageId, open, onClose,
}: { field: LeadLabelField; pageId?: string; open: boolean; onClose: () => void }) {
  const labels = useLeadLabels(field, pageId)
  const [newName, setNewName] = React.useState('')
  const [newColor, setNewColor] = React.useState('#4F8EF7')

  const addLabel = () => {
    if (!newName.trim()) return
    void leadLabelsService.createLabel(field, newName, newColor, pageId ?? null)
    setNewName('')
    setNewColor('#4F8EF7')
  }

  return (
    <Modal open={open} onClose={onClose} title={`Editar etiquetas — ${FIELD_TITLES[field]}`} size="sm">
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {labels.length === 0 && (
          <p className="text-xs text-foreground/40">Nenhuma etiqueta ainda.</p>
        )}
        {labels.map((l) => (
          <div key={l.id} className="flex items-center gap-2">
            <input
              type="color"
              value={l.color}
              onChange={(e) => leadLabelsService.updateLabel(l.id, { color: e.target.value })}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <input
              defaultValue={l.name}
              onBlur={(e) => {
                const trimmed = e.target.value.trim()
                if (trimmed && trimmed !== l.name) leadLabelsService.updateLabel(l.id, { name: trimmed })
                else e.target.value = l.name
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm text-foreground focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Excluir a etiqueta "${l.name}"?`)) void leadLabelsService.deleteLabel(l.id)
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded text-foreground/40 hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nova etiqueta"
          onKeyDown={(e) => { if (e.key === 'Enter') addLabel() }}
          className="h-8 flex-1 rounded-md border border-line bg-surface px-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none"
        />
        <Button size="sm" onClick={addLabel} disabled={!newName.trim()} leftIcon={<Plus className="h-3.5 w-3.5" />}>
          Adicionar
        </Button>
      </div>
    </Modal>
  )
}
