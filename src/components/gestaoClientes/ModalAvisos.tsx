import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

/**
 * Lista o que está estranho nos números e deixa a pessoa decidir: corrigir ou salvar mesmo assim.
 * Aviso, não bloqueio — há casos legítimos, e travar faria digitar número falso pra passar.
 */
export function ModalAvisos({
  avisos,
  salvando,
  onCorrigir,
  onSalvarMesmoAssim,
}: {
  /** Null = fechado. */
  avisos: string[] | null
  salvando?: boolean
  onCorrigir: () => void
  onSalvarMesmoAssim: () => void
}) {
  return (
    <Modal
      open={avisos !== null}
      onClose={onCorrigir}
      size="md"
      title="Esses números não batem"
      description="Confira antes de salvar. Se estiverem certos mesmo, é só salvar assim."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCorrigir}>
            Voltar e corrigir
          </Button>
          <Button variant="secondary" loading={salvando} onClick={onSalvarMesmoAssim}>
            Salvar mesmo assim
          </Button>
        </div>
      }
    >
      <ul className="space-y-2">
        {(avisos ?? []).map((a, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.05] px-3 py-2 text-sm text-foreground/85"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            {a}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
