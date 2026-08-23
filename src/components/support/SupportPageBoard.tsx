import * as React from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Building2, ChevronLeft, ChevronRight, Loader2, Plus, Search, UserCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { useClients } from '@/hooks/useClients'
import { supportPagesService } from '@/services/supportPages'
import type { SupportPageClient, SupportPageStage } from '@/services/supportPages'
import { onSseEvent } from '@/services/api'
import { cn } from '@/lib/utils'

/**
 * Quadro de uma CÓPIA do Suporte criada com "Com tudo" ou "Só os quadros".
 *
 * As colunas vêm de support_page_stages e os cartões de support_page_clients — os dois são desta
 * cópia. O cliente em si continua sendo o mesmo registro de `clients`: abrir o cartão abre o
 * cadastro real, e arrastar entre colunas grava só a etapa LOCAL (support_page_clients.stage_key),
 * nunca `clients.stage`. É isso que permite ter vários recortes do mesmo cliente sem bagunçar
 * funil, Dashboard e relatórios, que continuam lendo `clients.stage` do Pipeline original.
 */

export interface SupportPageBoardProps {
  pageId: string
  pageName: string
  stages: SupportPageStage[]
}

export function SupportPageBoard({ pageId, pageName, stages }: SupportPageBoardProps) {
  const [rows, setRows] = React.useState<SupportPageClient[] | null>(null)
  const [dragging, setDragging] = React.useState<SupportPageClient | null>(null)
  const [openClientId, setOpenClientId] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const reload = React.useCallback(async () => {
    try {
      setRows(await supportPagesService.getClients(pageId))
    } catch (err) {
      toast.error('Falha ao carregar o quadro: ' + (err as Error).message)
      setRows([])
    }
  }, [pageId])

  React.useEffect(() => { void reload() }, [reload])

  // Outro admin mexendo na mesma cópia (ou no cadastro de um cliente) reflete aqui sem F5.
  React.useEffect(
    () => onSseEvent((table) => {
      if (table === 'support_page_clients' || table === 'clients') void reload()
    }),
    [reload],
  )

  const byStage = React.useMemo(() => {
    const map = new Map<string, SupportPageClient[]>()
    for (const stage of stages) map.set(stage.key, [])
    for (const row of rows ?? []) {
      // Etapa apagada depois que o cliente entrou: cai na primeira coluna em vez de sumir.
      const list = map.get(row.page_stage_key) ?? map.get(stages[0]?.key ?? '')
      list?.push(row)
    }
    return map
  }, [rows, stages])

  const move = async (row: SupportPageClient, stage: SupportPageStage) => {
    if (row.page_stage_key === stage.key) return
    const previous = rows
    // Otimista: arrastar precisa parecer instantâneo; se o PUT falhar, volta como estava.
    setRows((current) =>
      (current ?? []).map((r) => (r.id === row.id ? { ...r, page_stage_key: stage.key } : r)),
    )
    try {
      await supportPagesService.setClientStage(pageId, row.id, stage.key, row.page_position ?? 0)
    } catch (err) {
      setRows(previous)
      toast.error('Não deu pra mover: ' + (err as Error).message)
    }
  }

  const remove = async (row: SupportPageClient) => {
    if (!window.confirm(`Tirar "${row.name}" de "${pageName}"? O cadastro do cliente continua no sistema.`)) return
    const previous = rows
    setRows((current) => (current ?? []).filter((r) => r.id !== row.id))
    try {
      await supportPagesService.removeClient(pageId, row.id)
    } catch (err) {
      setRows(previous)
      toast.error('Falha ao remover: ' + (err as Error).message)
    }
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const row = e.active.data.current?.row as SupportPageClient | undefined
    const stage = e.over?.data.current?.stage as SupportPageStage | undefined
    if (row && stage) void move(row, stage)
  }

  if (rows === null) {
    return (
      <>
        <TopBar title={pageName} />
        <div className="grid min-h-[50vh] place-items-center text-sm text-foreground/55">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando o quadro…
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title={pageName}
        subtitle={`${rows.length} cliente(s) neste quadro`}
        rightSlot={
          <Button size="sm" onClick={() => setAddOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Adicionar cliente
          </Button>
        }
      />

      <DndContext
        sensors={sensors}
        onDragStart={(e: DragStartEvent) =>
          setDragging((e.active.data.current?.row as SupportPageClient | undefined) ?? null)
        }
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {stages.map((stage, i) => (
            <StageColumn key={stage.id} stage={stage} count={(byStage.get(stage.key) ?? []).length}>
              {(byStage.get(stage.key) ?? []).map((row) => (
                <ClientCard
                  key={row.id}
                  row={row}
                  onOpen={() => setOpenClientId(row.id)}
                  onRemove={() => void remove(row)}
                  onMove={(dir) => {
                    const next = stages[i + dir]
                    if (next) void move(row, next)
                  }}
                  canLeft={i > 0}
                  canRight={i < stages.length - 1}
                />
              ))}
            </StageColumn>
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div className="w-[260px] rotate-2">
              <ClientCard row={dragging} onOpen={() => {}} onRemove={() => {}} onMove={() => {}} canLeft={false} canRight={false} overlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <AddClientsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        pageId={pageId}
        pageName={pageName}
        firstStageKey={stages[0]?.key}
        alreadyIn={new Set(rows.map((r) => r.id))}
        onAdded={reload}
      />

      {openClientId && <ClientDrawer clientId={openClientId} onClose={() => setOpenClientId(null)} />}
    </>
  )
}

function StageColumn({
  stage,
  count,
  children,
}: {
  stage: SupportPageStage
  count: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}`, data: { stage } })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[280px] shrink-0 flex-col rounded-xl border bg-card/40 p-2 transition-colors',
        isOver ? 'border-accent/50 bg-accent/[0.04]' : 'border-line',
      )}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.color }} />
        <span className="truncate text-xs font-medium text-foreground/80">{stage.name}</span>
        <span className="ml-auto text-[11px] text-foreground/40">{count}</span>
      </div>
      <div className="flex min-h-[60px] flex-col gap-2">{children}</div>
    </div>
  )
}

function ClientCard({
  row,
  onOpen,
  onRemove,
  onMove,
  canLeft,
  canRight,
  overlay,
}: {
  row: SupportPageClient
  onOpen: () => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
  canLeft: boolean
  canRight: boolean
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `client-${row.id}`,
    data: { row },
    disabled: overlay,
  })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group rounded-lg border border-line bg-card p-2.5 shadow-sm',
        isDragging && !overlay && 'opacity-40',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...listeners}
          {...attributes}
          className="flex-1 cursor-grab text-left active:cursor-grabbing"
          onClick={onOpen}
        >
          <span className="block truncate text-xs font-medium text-foreground/85">{row.name}</span>
          {row.company && (
            <span className="mt-1 flex items-center gap-1 text-[11px] text-foreground/45">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.company}</span>
            </span>
          )}
          {row.responsavel && (
            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-foreground/45">
              <UserCircle2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.responsavel}</span>
            </span>
          )}
        </button>
        {!overlay && (
          <button
            type="button"
            onClick={onRemove}
            title="Tirar deste quadro (não apaga o cliente)"
            className="shrink-0 rounded p-0.5 text-foreground/30 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!overlay && (
        <div className="mt-2 flex justify-end gap-1">
          <button
            type="button"
            disabled={!canLeft}
            onClick={() => onMove(-1)}
            className="rounded p-0.5 text-foreground/30 hover:bg-elevate/[0.08] hover:text-foreground/70 disabled:opacity-20"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRight}
            onClick={() => onMove(1)}
            className="rounded p-0.5 text-foreground/30 hover:bg-elevate/[0.08] hover:text-foreground/70 disabled:opacity-20"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

/** Traz clientes existentes pro quadro. Não cria cliente: aqui é só associação. */
function AddClientsModal({
  open,
  onClose,
  pageId,
  pageName,
  firstStageKey,
  alreadyIn,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  pageId: string
  pageName: string
  firstStageKey?: string
  alreadyIn: Set<string>
  onAdded: () => Promise<void>
}) {
  const clients = useClients()
  const [search, setSearch] = React.useState('')
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => { if (open) { setSearch(''); setPicked(new Set()) } }, [open])

  const candidates = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return clients
      .filter((c) => !alreadyIn.has(c.id))
      .filter((c) => !q || (c.name + ' ' + (c.company ?? '') + ' ' + c.email).toLowerCase().includes(q))
      .slice(0, 100)
  }, [clients, alreadyIn, search])

  const submit = async () => {
    if (!firstStageKey || picked.size === 0) return
    setSaving(true)
    try {
      // Entram todos na primeira coluna; dali o time arrasta pra onde faz sentido.
      for (const id of picked) await supportPagesService.setClientStage(pageId, id, firstStageKey)
      await onAdded()
      toast.success(`${picked.size} cliente(s) adicionado(s) a "${pageName}".`)
      onClose()
    } catch (err) {
      toast.error('Falha ao adicionar: ' + (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar cliente"
      description="São os mesmos cadastros do sistema — adicionar aqui não cria um cliente novo."
      size="sm"
    >
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome, empresa ou e-mail"
        leftIcon={<Search className="h-4 w-4" />}
        autoFocus
      />
      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
        {candidates.length === 0 && (
          <p className="px-1 py-2 text-xs text-foreground/45">Nenhum cliente disponível.</p>
        )}
        {candidates.map((c) => (
          <label key={c.id} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground/80 hover:bg-elevate/[0.04]">
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={() =>
                setPicked((prev) => {
                  const next = new Set(prev)
                  if (next.has(c.id)) next.delete(c.id)
                  else next.add(c.id)
                  return next
                })
              }
              className="h-3.5 w-3.5 accent-accent"
            />
            <span className="truncate">{c.name}</span>
            {c.company && <span className="ml-auto shrink-0 truncate text-[11px] text-foreground/40">{c.company}</span>}
          </label>
        ))}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
        <Button onClick={submit} disabled={picked.size === 0} loading={saving}>
          Adicionar{picked.size > 0 ? ` (${picked.size})` : ''}
        </Button>
      </div>
    </Modal>
  )
}
