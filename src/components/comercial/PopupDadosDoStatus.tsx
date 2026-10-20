import * as React from 'react'
import { CalendarClock } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { registrarPedidoDeDadoDoStatus, type PedidoDeDadoDoStatus } from '@/services/leadBoards'

type Pedido = PedidoDeDadoDoStatus & { responder: (valor: string | null) => void }

/**
 * Popup único (montado no Layout) que pede a data e o horário quando um lead vai pra "Reunião agendada" ou
 * "Proposta enviada" nos CRMs do Arthur e do Luis. Sem preencher os dois, não confirma — e o lead fica onde
 * estava. Vários pedidos (mover em lote) entram numa fila e aparecem um de cada vez.
 */
export function PopupDadosDoStatus() {
  const [fila, setFila] = React.useState<Pedido[]>([])
  const atual = fila[0] ?? null
  const [data, setData] = React.useState('')
  const [hora, setHora] = React.useState('')

  React.useEffect(
    () => registrarPedidoDeDadoDoStatus((p) => new Promise<string | null>((responder) => setFila((f) => [...f, { ...p, responder }]))),
    [],
  )

  React.useEffect(() => {
    if (!atual) return
    const [d, h] = (atual.valorAtual || '').split('T')
    setData(/^\d{4}-\d{2}-\d{2}$/.test(d ?? '') ? d : '')
    setHora(/^\d{2}:\d{2}/.test(h ?? '') ? h.slice(0, 5) : '')
  }, [atual])

  const fechar = (valor: string | null) => {
    if (!atual) return
    atual.responder(valor)
    setFila((f) => f.slice(1))
  }

  if (!atual) return null
  const agendamento = atual.campo === 'agendamento'
  const pronto = /^\d{4}-\d{2}-\d{2}$/.test(data) && /^\d{2}:\d{2}$/.test(hora)

  return (
    <Modal
      open
      onClose={() => fechar(null)}
      size="sm"
      title={agendamento ? 'Quando é a reunião?' : 'Quando retornar?'}
      description={
        agendamento
          ? `Pra marcar "${atual.nome}" como ${atual.status}, informe o dia e o horário da reunião.`
          : `Pra marcar "${atual.nome}" como ${atual.status}, informe o dia e o horário do retorno.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => fechar(null)}>Cancelar</Button>
          <Button disabled={!pronto} onClick={() => fechar(`${data}T${hora}`)}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-accent/[0.06] px-3 py-2 text-xs text-foreground/70">
          <CalendarClock className="h-4 w-4 shrink-0 text-accent" />
          {agendamento ? 'Sem dia e horário da reunião o lead não vai pra Reunião agendada.' : 'Sem dia e horário em "Retornar" o lead não vai pra Proposta enviada.'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/70">Dia *</span>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              autoFocus
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-foreground/70">Horário *</span>
            <input
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && pronto) fechar(`${data}T${hora}`) }}
              className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </label>
        </div>
        {fila.length > 1 && <p className="text-xs text-foreground/45">Depois deste, mais {fila.length - 1} lead(s) pra preencher.</p>}
      </div>
    </Modal>
  )
}
