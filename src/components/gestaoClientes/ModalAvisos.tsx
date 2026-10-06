import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

/**
 * Lista o que está estranho nos números e deixa a pessoa decidir: corrigir ou seguir mesmo assim.
 *
 * Aviso, não bloqueio seco — há casos legítimos (lead que veio de outra origem, venda de lead
 * antigo), e travar faria digitar número falso pra passar. Mas onde o número vai parar na frente do
 * CLIENTE (publicar relatório), `exigirMarcar` pede um "revisei" explícito antes de liberar o botão:
 * um clique distraído não pode publicar CTR de 458%.
 */
export function ModalAvisos({
  avisos,
  salvando,
  titulo = 'Esses números não batem',
  rotuloConfirmar = 'Salvar mesmo assim',
  exigirMarcar = false,
  onCorrigir,
  onSalvarMesmoAssim,
}: {
  /** Null = fechado. */
  avisos: string[] | null
  salvando?: boolean
  titulo?: string
  rotuloConfirmar?: string
  /** Exige marcar "revisei" antes de liberar o botão de confirmar. */
  exigirMarcar?: boolean
  onCorrigir: () => void
  onSalvarMesmoAssim: () => void
}) {
  const [revisei, setRevisei] = React.useState(false)
  // Cada vez que a janela abre, a marcação recomeça: a confirmação de uma publicação não vale pra
  // a próxima.
  React.useEffect(() => {
    if (avisos !== null) setRevisei(false)
  }, [avisos])

  return (
    <Modal
      open={avisos !== null}
      onClose={onCorrigir}
      size="md"
      title={titulo}
      description="Confira antes de seguir. Se estiverem certos mesmo, é só confirmar."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCorrigir}>
            Voltar e corrigir
          </Button>
          <Button
            variant="secondary"
            loading={salvando}
            disabled={exigirMarcar && !revisei}
            onClick={onSalvarMesmoAssim}
          >
            {rotuloConfirmar}
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
      {exigirMarcar && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-foreground/80">
          <input
            type="checkbox"
            checked={revisei}
            onChange={(e) => setRevisei(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line"
          />
          Revisei os números e sei que o cliente vai ler o relatório assim.
        </label>
      )}
    </Modal>
  )
}
