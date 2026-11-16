import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { dataBr, pontosService, type Feriado } from '@/services/pontos'

const ABRANGENCIA: Record<Feriado['abrangencia'], string> = { nacional: 'Nacional', estadual: 'Santa Catarina', municipal: 'Tubarão' }

/** Tabela de feriados (nacional / SC / Tubarão), vale pra todos os colaboradores. */
export function FeriadosModal({ open, onClose, onSalvo }: { open: boolean; onClose: () => void; onSalvo: () => void }) {
  const [lista, setLista] = React.useState<Feriado[]>([])
  const [data, setData] = React.useState('')
  const [nome, setNome] = React.useState('')
  const [abrangencia, setAbrangencia] = React.useState<Feriado['abrangencia']>('municipal')

  const carregar = React.useCallback(() => { pontosService.feriados().then(setLista).catch((e) => toast.error((e as Error).message)) }, [])
  React.useEffect(() => { if (open) carregar() }, [open, carregar])

  const adicionar = async () => {
    if (!data || !nome.trim()) return toast.error('Informe a data e o nome.')
    try {
      await pontosService.salvarFeriado({ data, nome: nome.trim(), abrangencia })
      setData(''); setNome('')
      carregar(); onSalvo()
    } catch (e) { toast.error((e as Error).message) }
  }
  const remover = async (f: Feriado) => {
    if (!window.confirm(`Remover o feriado "${f.nome}" (${dataBr(f.data)})?`)) return
    try { await pontosService.removerFeriado(f.id); carregar(); onSalvo() } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Feriados" size="lg" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="mb-4 grid gap-2 sm:grid-cols-[9rem,1fr,9rem,auto] sm:items-end">
        <Input label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Input label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aniversário de Tubarão" />
        <label className="text-xs font-medium text-foreground/70">
          Abrangência
          <select value={abrangencia} onChange={(e) => setAbrangencia(e.target.value as Feriado['abrangencia'])} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
            {Object.entries(ABRANGENCIA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </label>
        <Button onClick={() => void adicionar()}>Adicionar</Button>
      </div>
      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line text-sm">
        {lista.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-3 py-2">
            <span className="w-24 tabular-nums text-foreground/70">{dataBr(f.data)}</span>
            <span className="flex-1 text-foreground">{f.nome}</span>
            <span className="text-xs text-foreground/50">{ABRANGENCIA[f.abrangencia]}</span>
            <button type="button" title="Remover" onClick={() => void remover(f)} className="rounded p-1 text-foreground/40 hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
          </li>
        ))}
        {!lista.length && <li className="px-3 py-4 text-center text-foreground/45">Nenhum feriado cadastrado.</li>}
      </ul>
    </Modal>
  )
}
