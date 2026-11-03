import * as React from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ClipboardList, GripVertical, MessageSquareText, MousePointerClick, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepKind } from '@/lib/demoStudio/types'
import { urlDoArquivo, type Etapa, type Frame } from '@/services/demoStudio'

export const TIPOS_DE_ETAPA: Record<StepKind, { rotulo: string; icone: React.ComponentType<{ className?: string }> }> = {
  HOTSPOT: { rotulo: 'Destaque', icone: MousePointerClick },
  MODAL: { rotulo: 'Cartão', icone: MessageSquareText },
  LEAD_FORM: { rotulo: 'Formulário', icone: ClipboardList },
  CTA: { rotulo: 'Chamada final', icone: Send },
}

/** O que falta numa etapa (o editor sinaliza; publicar recusa destaque sem retângulo). */
export function pendenciasDaEtapa(e: Etapa): string[] {
  const p: string[] = []
  if (e.kind === 'HOTSPOT' && !e.hotspot) p.push('sem destaque')
  if (!e.title.trim()) p.push('sem texto')
  return p
}

export function ListaEtapas({ etapas, frames, selecionada, onSelecionar, onReordenar, somenteLeitura }: {
  etapas: Etapa[]
  frames: Map<string, Frame>
  selecionada: string | null
  onSelecionar: (id: string) => void
  onReordenar: (ids: string[]) => void
  somenteLeitura?: boolean
}) {
  const sensores = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const aoSoltar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const de = etapas.findIndex((x) => x.id === e.active.id)
    const para = etapas.findIndex((x) => x.id === e.over!.id)
    onReordenar(arrayMove(etapas, de, para).map((x) => x.id))
  }
  return (
    <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
      <SortableContext items={etapas.map((e) => e.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-1.5">
          {etapas.map((e, i) => (
            <ItemEtapa
              key={e.id}
              etapa={e}
              numero={i + 1}
              frame={frames.get(e.frameId)}
              ativa={e.id === selecionada}
              onClick={() => onSelecionar(e.id)}
              somenteLeitura={somenteLeitura}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function ItemEtapa({ etapa, numero, frame, ativa, onClick, somenteLeitura }: {
  etapa: Etapa
  numero: number
  frame?: Frame
  ativa: boolean
  onClick: () => void
  somenteLeitura?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: etapa.id, disabled: somenteLeitura })
  const tipo = TIPOS_DE_ETAPA[etapa.kind]
  const pend = pendenciasDaEtapa(etapa)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm',
        ativa ? 'border-accent/60 bg-accent/[0.06]' : 'border-line bg-surface hover:bg-elevate/[0.03]',
        isDragging && 'z-10 shadow-lg',
      )}
    >
      {!somenteLeitura && (
        <button type="button" className="cursor-grab text-foreground/30 hover:text-foreground/60" aria-label={`Arrastar etapa ${numero}`} {...attributes} {...listeners}>
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-foreground/45">{numero}</span>
        <div className="h-8 w-14 shrink-0 overflow-hidden rounded border border-line bg-elevate/[0.04]">
          {frame && <img src={urlDoArquivo(frame.thumb)} alt="" className="h-full w-full object-cover object-top" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate', etapa.title ? 'text-foreground' : 'italic text-foreground/40')}>{etapa.title || '(sem texto)'}</p>
          <p className="flex items-center gap-1 text-[11px] text-foreground/45">
            <tipo.icone className="h-3 w-3" /> {tipo.rotulo}
            {pend.length > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-amber-500"><AlertTriangle className="h-3 w-3" /> {pend.join(', ')}</span>
            )}
          </p>
        </div>
      </button>
    </li>
  )
}
