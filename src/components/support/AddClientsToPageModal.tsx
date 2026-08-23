import * as React from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useClients } from '@/hooks/useClients'
import { supportPagesService } from '@/services/supportPages'

/**
 * Traz clientes já existentes pra dentro de uma cópia do Suporte.
 *
 * Não cria cliente nenhum: a cópia guarda uma lista de quem aparece nela (support_page_clients),
 * então o cadastro continua único no sistema e o mesmo cliente pode estar em vários recortes.
 */
export function AddClientsToPageModal({
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
  /** Etapa em que os escolhidos entram — dali o time move pra onde faz sentido. */
  firstStageKey?: string
  alreadyIn: Set<string>
  onAdded: () => void | Promise<void>
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
      .filter((c) => !q || `${c.name} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q))
      .slice(0, 100)
  }, [clients, alreadyIn, search])

  const submit = async () => {
    if (!firstStageKey || picked.size === 0) return
    setSaving(true)
    try {
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
          <label
            key={c.id}
            className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground/80 hover:bg-elevate/[0.04]"
          >
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
            {c.company && (
              <span className="ml-auto shrink-0 truncate text-[11px] text-foreground/40">{c.company}</span>
            )}
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
