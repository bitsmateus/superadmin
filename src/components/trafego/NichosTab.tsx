import * as React from 'react'
import { toast } from 'sonner'
import { trafegoService } from '@/services/trafego'
import { Estado, Painel, SeloBadge, Vazio, brl, num, seloDe, useCarregar } from '@/components/trafego/format'

const SEM_NICHO = '(sem nicho)'

function MarcarNicho({ id, nome, onSaved }: { id: string; nome: string; onSaved: () => void }) {
  const [valor, setValor] = React.useState('')
  const salvar = async () => {
    if (!valor.trim()) return
    try { await trafegoService.marcarCampanha(id, { nicho: valor }); setValor(''); onSaved() }
    catch (e) { toast.error('Falha ao salvar: ' + (e as Error).message) }
  }
  return (
    <li className="flex items-center gap-2 border-t border-line py-2 first:border-t-0 max-sm:flex-wrap">
      {/* No celular o nome vai inteiro numa linha e o campo + botão ficam embaixo. */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80 max-sm:basis-full max-sm:whitespace-normal max-sm:break-words" title={nome}>{nome}</span>
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') void salvar() }}
        placeholder="Nicho (ex.: lavanderia)"
        className="h-8 w-48 rounded-md border border-line bg-surface px-2 text-sm placeholder:text-foreground/30 focus:border-accent focus:outline-none max-sm:h-9 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
      />
      <button type="button" disabled={!valor.trim()} onClick={() => void salvar()}
        className="rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-40 max-sm:h-9 max-sm:shrink-0 max-sm:px-3">Marcar</button>
    </li>
  )
}

/** Ranking por nicho (campanhas agrupadas pelo nicho marcado) + lista "sem nicho" pra marcar. */
export function NichosTab({ de, ate, versao }: { de: string; ate: string; versao: number }) {
  const nichos = useCarregar(() => trafegoService.ranking('nicho', de, ate), [de, ate, versao])
  const camps = useCarregar(() => trafegoService.ranking('campanha', de, ate), [de, ate, versao])
  const semNicho = (camps.dados?.linhas ?? []).filter((c) => !(c.nicho ?? '').trim() && c.gasto > 0)
  const real = useCarregar(() => trafegoService.nichosReal(de, ate), [de, ate, versao])
  const recarregar = () => { nichos.recarregar(); camps.recarregar() }

  return (
    <Estado carregando={nichos.carregando} erro={nichos.erro}>
      <div className="space-y-4">
        {/* Celular: um cartão por nicho no lugar da tabela de 8 colunas. (O invólucro deixa o espaçamento do
         * space-y igual ao de antes no desktop.) */}
        <div>
          <ul className="divide-y divide-line rounded-xl border border-line bg-card sm:hidden">
            {(nichos.dados?.linhas ?? []).length === 0 && <li className="py-8 text-center text-sm text-foreground/40">Sem dados no período.</li>}
            {(nichos.dados?.linhas ?? []).map((n) => (
              <li key={n.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={n.id === SEM_NICHO ? 'text-sm text-foreground/45' : 'text-sm font-medium text-foreground'}>{n.nome}</span>
                  {n.id !== SEM_NICHO && <SeloBadge selo={seloDe(n)} />}
                </div>
                <dl className="mt-1.5 grid grid-cols-4 gap-x-2 gap-y-1.5 text-xs">
                  {([
                    ['Gasto', brl(n.gasto)], ['Leads', num(n.leads)], ['CPL', brl(n.cpl)], ['Reuniões', num(n.reunioes)],
                    ['Custo/reun.', brl(n.custoReuniao)], ['Vendas', num(n.vendas)], ['CAC', brl(n.cac)],
                  ] as const).map(([rotulo, valor]) => (
                    <div key={rotulo} className="min-w-0">
                      <dt className="truncate text-[10px] text-foreground/40">{rotulo}</dt>
                      <dd className={rotulo === 'Custo/reun.' ? 'font-semibold tabular-nums text-foreground' : 'font-medium tabular-nums text-foreground/85'}>{valor}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-card sm:block">
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
        </div>
        <p className="text-[11px] text-foreground/35">
          O veredito só vale com pelo menos R$ 300 gastos e 15 leads — antes disso o nicho aparece como "em teste".
          Este é o nicho que a campanha MIRA; o nicho real do lead entra quando o formulário perguntar o segmento.
        </p>
        <Painel title="Nicho mirado x nicho real do lead">
          {(real.dados?.linhas ?? []).length === 0 ? (
            <Vazio>Sem leads do Meta no período.</Vazio>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-foreground/50">
                <tr><th className="py-1.5">Campanha mira</th><th>Lead informou</th><th className="text-right">Leads</th></tr>
              </thead>
              <tbody>
                {(real.dados?.linhas ?? []).map((l, i) => {
                  const igual = l.mirado.trim().toLowerCase() === l.real.trim().toLowerCase()
                  return (
                    <tr key={i} className="border-t border-line">
                      <td className="py-1.5 text-foreground/80">{l.mirado}</td>
                      <td className={igual ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground/70'}>{l.real}</td>
                      <td className="text-right tabular-nums">{num(l.leads)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-foreground/35">
            O nicho real vem da pergunta de segmento do formulário do Meta (ou do que o SDR marcar no card do lead). Verde = a campanha acertou o público.
          </p>
        </Painel>
        {semNicho.length > 0 && (
          <Painel title={`Campanhas sem nicho (${semNicho.length})`}>
            <ul>{semNicho.map((c) => <MarcarNicho key={c.id} id={c.id} nome={c.nome} onSaved={recarregar} />)}</ul>
          </Painel>
        )}
      </div>
    </Estado>
  )
}
