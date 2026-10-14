import * as React from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'

export interface SimularLeadModalProps {
  open: boolean
  onClose: () => void
  onCreated: (leadId: string) => void
}

/** Simula a chegada de um lead do tráfego pago: cria o lead em Novos Leads e manda o template de
 * boas-vindas pro telefone informado (use o seu pra testar). */
export function SimularLeadModal({ open, onClose, onCreated }: SimularLeadModalProps) {
  const [nome, setNome] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [result, setResult] = React.useState<{ enviada: boolean; erro: string | null } | null>(null)

  React.useEffect(() => { if (open) setResult(null) }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setResult(null)
    try {
      const r = await api.post<{ id: string; enviada: boolean; erro: string | null }>(
        '/api/lead-rows/simular-trafego', { nome, telefone },
      )
      setResult({ enviada: r.enviada, erro: r.erro })
      if (r.enviada) toast.success('Lead criado e mensagem enviada.')
      else toast.error('Lead criado, mas a mensagem não saiu.')
      onCreated(r.id)
    } catch (err) {
      toast.error('Falha ao simular: ' + (err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const input = 'mt-1 w-full rounded-md bg-elevate/[0.05] px-2.5 py-2 text-sm text-foreground outline-none'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simular lead do tráfego"
      description="Cria um lead de teste em Novos Leads e envia o template de boas-vindas de verdade pro telefone abaixo."
      size="md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs text-foreground/50">
          Nome do lead
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Maria da Silva" className={input} required />
        </label>
        <label className="block text-xs text-foreground/50">
          Telefone (WhatsApp)
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="11999999999" inputMode="tel" className={input} required />
        </label>
        {result && (
          <p className={result.enviada ? 'text-sm text-emerald-600' : 'break-words text-sm text-red-500'}>
            {result.enviada ? 'Mensagem enviada. Confira o WhatsApp e o selo no card do lead.' : `Não enviou: ${result.erro}`}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          <Button type="submit" size="sm" disabled={sending}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {sending ? 'Enviando…' : 'Criar e enviar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
