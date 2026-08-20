import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { leadBoardsService } from '@/services/leadBoards'
import { formatDateTimeShort } from '@/lib/utils'
import type { LeadBoard, LeadRow } from '@/types/leadBoard'

export interface LeadTrashModalProps {
  open: boolean
  onClose: () => void
  boards: LeadBoard[]
}

/** Lixeira dos leads excluídos dessa aba — busca sob demanda toda vez que abre, sem cache. */
export function LeadTrashModal({ open, onClose, boards }: LeadTrashModalProps) {
  const [loading, setLoading] = React.useState(false)
  const [rows, setRows] = React.useState<LeadRow[]>([])
  const [restoringId, setRestoringId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    const boardIds = new Set(boards.map((b) => b.id))
    leadBoardsService.getTrash()
      .then((all) => setRows(all.filter((r) => boardIds.has(r.boardId))))
      .catch((err) => toast.error('Falha ao carregar a lixeira: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [open, boards])

  const restore = async (id: string) => {
    setRestoringId(id)
    try {
      await leadBoardsService.restoreRow(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      toast.success('Lead restaurado.')
    } catch (err) {
      toast.error('Falha ao restaurar: ' + (err as Error).message)
    } finally {
      setRestoringId(null)
    }
  }

  const boardName = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? '—'

  return (
    <Modal open={open} onClose={onClose} title="Lixeira" description="Leads excluídos — restaure se precisar." size="lg">
      {loading ? (
        <div className="grid place-items-center py-10 text-sm text-foreground/50">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-center">
          <Trash2 className="h-6 w-6 text-foreground/25" />
          <p className="text-sm text-foreground/40">Nenhum lead excluído por aqui.</p>
        </div>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-white/[0.04] overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.nome || 'Sem nome'}</p>
                <p className="truncate text-[11px] text-foreground/45">
                  {boardName(r.boardId)}
                  {r.deletedAt && <> · excluído {formatDateTimeShort(r.deletedAt)}</>}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => restore(r.id)}
                loading={restoringId === r.id}
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
              >
                Restaurar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
