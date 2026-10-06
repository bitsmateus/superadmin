import * as React from 'react'
import { CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { gestaoClientes } from '@/services/gestaoClientes'

/**
 * "Registrar alinhamento": cria uma nota do tipo Reunião/alinhamento. É essa nota que marca sozinho o
 * item "Alinhamento mensal" (na rotina e na jornada) — por isso o caminho é um clique e uma frase, não
 * a aba de notas inteira.
 */
export function RegistrarAlinhamento({
  clienteId,
  onRegistrado,
  tamanho = 'sm',
}: {
  clienteId: string
  onRegistrado: () => Promise<void> | void
  tamanho?: 'sm' | 'md'
}) {
  const [aberto, setAberto] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const registrar = async () => {
    setSalvando(true)
    try {
      await gestaoClientes.registrar(clienteId, {
        tipo: 'reuniao',
        titulo: 'Alinhamento com o cliente',
        descricao: texto.trim(),
      })
      toast.success('Alinhamento registrado')
      setTexto('')
      setAberto(false)
      await onRegistrado()
    } catch (err) {
      toast.error('Falha ao registrar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size={tamanho}
        leftIcon={<CalendarCheck className="h-3.5 w-3.5" />}
        onClick={() => setAberto(true)}
      >
        Registrar alinhamento
      </Button>
      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        size="md"
        title="Registrar alinhamento"
        description='Cria uma nota de "Reunião/alinhamento" — é ela que marca o alinhamento do mês como feito.'
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button loading={salvando} onClick={() => void registrar()}>
              Registrar
            </Button>
          </div>
        }
      >
        <Textarea
          label="O que foi combinado (opcional)"
          rows={4}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Resumo da conversa, próximos passos, o que o cliente pediu…"
        />
      </Modal>
    </>
  )
}
