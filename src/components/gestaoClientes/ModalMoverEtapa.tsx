import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { GcPreviaMover } from '@/services/gestaoClientes'

/**
 * Confirmação de mover o cliente de etapa. Mostra EXATAMENTE o que vai acontecer com o checklist —
 * quantas etapas serão concluídas (e quantos itens isso marca) ou reabertas (e quantos itens isso
 * desmarca) — porque mover não é só trocar de coluna: é um efeito grande que não pode ficar
 * escondido atrás de um arrastar.
 */
export function ModalMoverEtapa({
  aberto,
  cliente,
  previa,
  confirmando,
  onCancelar,
  onConfirmar,
}: {
  aberto: boolean
  cliente: string
  previa: GcPreviaMover | null
  confirmando: boolean
  onCancelar: () => void
  onConfirmar: () => void
}) {
  const fechar = previa?.fechar ?? []
  const reabrir = previa?.reabrir ?? []
  const itensMarcados = fechar.reduce((s, f) => s + f.itens_abertos, 0)
  const itensDesmarcados = reabrir.reduce((s, r) => s + r.itens_marcados, 0)

  return (
    <Modal
      open={aberto}
      onClose={onCancelar}
      size="md"
      title="Mover de etapa?"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button loading={confirmando} onClick={onConfirmar}>
            Mover {cliente}
          </Button>
        </div>
      }
    >
      {previa && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-foreground/85">
            <strong className="text-foreground">{cliente}</strong>
            <span className="text-foreground/60">{previa.origem}</span>
            <ArrowRight className="h-4 w-4 text-foreground/40" />
            <strong className="text-foreground">{previa.destino}</strong>
          </p>

          {fechar.length > 0 && (
            <div className="rounded-lg border border-success/25 bg-success/[0.05] px-3 py-2.5 text-sm">
              <p className="font-medium text-foreground">
                {fechar.length} etapa(s) serão concluídas
                {itensMarcados > 0 && ` — ${itensMarcados} item(ns) do checklist serão marcados`}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground/65">
                {fechar.map((f) => (
                  <li key={f.nome}>
                    {f.nome}
                    {f.itens_abertos > 0 ? ` (${f.itens_abertos} item(ns) em aberto)` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reabrir.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2.5 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {reabrir.length} etapa(s) serão reabertas
                {itensDesmarcados > 0 && ` — ${itensDesmarcados} item(ns) serão desmarcados`}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground/65">
                {reabrir.map((r) => (
                  <li key={r.nome}>
                    {r.nome} ({r.itens_marcados} item(ns) marcado(s))
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-foreground/55">
                Quem marcou e quando cada item foi feito se perde ao desmarcar.
              </p>
            </div>
          )}

          {fechar.length === 0 && reabrir.length === 0 && (
            <p className="text-sm text-foreground/60">Só a etapa atual muda; nenhum item é alterado.</p>
          )}

          <p className="text-xs text-foreground/45">O movimento fica registrado no histórico do cliente.</p>
        </div>
      )}
    </Modal>
  )
}
