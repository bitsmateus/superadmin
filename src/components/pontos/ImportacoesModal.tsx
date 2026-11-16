import * as React from 'react'
import { Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { dataBr, pontosService, type Importacao } from '@/services/pontos'

/** "Importações realizadas": histórico com "Desfazer importação" (tira só o que aquela importação trouxe). */
export function ImportacoesModal({ open, onClose, onDesfeita }: { open: boolean; onClose: () => void; onDesfeita: () => void }) {
  const [lista, setLista] = React.useState<Importacao[]>([])
  const [desfazendo, setDesfazendo] = React.useState<string | null>(null)
  const carregar = React.useCallback(() => { pontosService.importacoes().then(setLista).catch((e) => toast.error((e as Error).message)) }, [])
  React.useEffect(() => { if (open) carregar() }, [open, carregar])

  const desfazer = async (i: Importacao) => {
    if (!window.confirm(`Desfazer a importação de "${i.arquivo_nome}"? Saem só as batidas que ela trouxe; ajustes manuais e outras importações ficam.`)) return
    setDesfazendo(i.id)
    try {
      const r = await pontosService.desfazerImportacao(i.id)
      toast.success(`Importação desfeita: ${r.removidas} batida(s) removida(s)${r.devolvidas ? `, ${r.devolvidas} devolvida(s)` : ''}.`)
      carregar(); onDesfeita()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDesfazendo(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Importações realizadas" size="2xl" footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-foreground/45">
            <tr>
              <th className="px-2 py-2">Quando</th><th className="px-2 py-2">Arquivo</th><th className="px-2 py-2">Modo</th>
              <th className="px-2 py-2">Período lido</th><th className="px-2 py-2 text-right">Novos</th><th className="px-2 py-2 text-right">Atualiz.</th>
              <th className="px-2 py-2 text-right">Ignorados</th><th className="px-2 py-2">Quem</th><th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((i) => (
              <tr key={i.id} className={i.desfeita_em ? 'border-t border-line opacity-50' : 'border-t border-line'}>
                <td className="whitespace-nowrap px-2 py-2">{new Date(i.criado_em).toLocaleString('pt-BR')}</td>
                <td className="max-w-[14rem] truncate px-2 py-2" title={i.arquivo_nome}>{i.arquivo_nome}</td>
                <td className="px-2 py-2">{i.modo === 'mes' ? 'Mês' : 'Período'}</td>
                <td className="whitespace-nowrap px-2 py-2">{dataBr(i.periodo_inicio)} – {dataBr(i.periodo_fim)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{i.novos}</td>
                <td className="px-2 py-2 text-right tabular-nums">{i.atualizados}</td>
                <td className="px-2 py-2 text-right tabular-nums">{i.ignorados}</td>
                <td className="px-2 py-2">{i.importado_por_nome}</td>
                <td className="px-2 py-2 text-right">
                  {i.desfeita_em ? (
                    <span className="text-xs text-foreground/50">desfeita {i.desfeita_por_nome ? `por ${i.desfeita_por_nome}` : ''}</span>
                  ) : (
                    <Button size="sm" variant="ghost" leftIcon={<Undo2 className="h-3.5 w-3.5" />} disabled={desfazendo === i.id} onClick={() => void desfazer(i)}>Desfazer</Button>
                  )}
                </td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={9} className="px-2 py-6 text-center text-foreground/45">Nenhuma importação ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
