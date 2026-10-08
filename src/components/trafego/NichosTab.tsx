import * as React from 'react'
import { toast } from 'sonner'
import { trafegoService } from '@/services/trafego'
import { Estado, Painel, SeloBadge, brl, num, seloDe, useCarregar } from '@/components/trafego/format'

const SEM_NICHO = '(sem nicho)'

function MarcarNicho({ id, nome, onSaved }: { id: string; nome: string; onSaved: () => void }) {
  const [valor, setValor] = React.useState('')
  const salvar = async () => {
    if (!valor.trim()) return
    try { await trafegoService.marcarCampanha(id, { nicho: valor }); setValor(''); onSaved() }
    catch (e) { toast.error('Falha ao salvar: ' + (e as Error).message) }
  }
  return (
    <li className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80" title={nome}>{nome}</span>
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void salvar() }}
        placeholder="Nicho (ex.: lavanderia)"
        className="h-8 w-48 rounded-md border border-line bg-surface px-2 text-sm placeholder:text-foreground/30 focus:border-accent focus:outline-none"
      />
      <button type="button" disabled={!valor.trim()} onClick={() => void salvar()}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40">Marcar</button>
    </li>
  )
}

/** Ranking por nicho (campanhas agrupadas pelo nicho marcado) + lista "sem nicho" pra marcar. */
export function NichosTab({ de, ate, versao }: { de: string; ate: string; versao: number }) {
  const nichos = useCarregar(() => trafegoService.ranking('nicho', de, ate), [de, ate, versao])
  const camps = useCarregar(() => trafegoService.ranking('campanha', de, ate), [de, ate, versao])
  const semNicho = (camps.dados?.linhas ?? []).filter((c) => !(c.nicho ?? '').trim() && c.gasto > 0)
  const recarregar = () => { nichos.recarregar(); camps.recarregar() }

  return (
    <Estado carregando={nichos.carregando} erro={nichos.erro}>
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line text-left text-xs text-foreground/50">
              <tr>
                <th className="px-3 py-2">Nicho (mirado)</th>
                {['Gasto', 'Leads', 'CPL', 'Reun.', 'Custo/reun.', 'Vendas', 'CAC'].map((c) => <th key={c} className="px-2 text-right">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {(nichos.dados?.linhas ?? []).length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-foreground/40">Sem dados no período.</td></tr>
              )}
              {(nichos.dados?.linhas ?? []).map((n) => (
                <tr key={n.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className={n.id === SEM_NICHO ? 'text-foreground/45' : 'font-medium text-foreground'}>{n.nome}</span>
                    {n.id !== SEM_NICHO && <span className="ml-2"><SeloBadge selo={seloDe(n)} /></span>}
                  </td>
                  <td className="px-2 text-right tabular-nums">{brl(n.gasto)}</td>
                  <td className="px-2 text-right tabular-nums">{num(n.leads)}</td>
                  <td className="px-2 text-right tabular-nums">{brl(n.cpl)}</td>
                  <td className="px-2 text-right tabular-nums">{num(n.reunioes)}</td>
                  <td className="px-2 text-right font-medium tabular-nums">{brl(n.custoReuniao)}</td>
                  <td className="px-2 text-right tabular-nums">{num(n.vendas)}</td>
                  <td className="px-2 text-right tabular-nums">{brl(n.cac)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-foreground/35">
          O veredito só vale com pelo menos R$ 300 gastos e 15 leads — antes disso o nicho aparece como "em teste".
          Este é o nicho que a campanha MIRA; o nicho real do lead entra quando o formulário perguntar o segmento.
        </p>
        {semNicho.length > 0 && (
          <Painel title={`Campanhas sem nicho (${semNicho.length})`}>
            <ul>{semNicho.map((c) => <MarcarNicho key={c.id} id={c.id} nome={c.nome} onSaved={recarregar} />)}</ul>
          </Painel>
        )}
      </div>
    </Estado>
  )
}
