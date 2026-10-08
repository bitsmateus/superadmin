import * as React from 'react'
import { ChevronDown, ChevronRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { trafegoService, type FiltroPapel, type LinhaTrafego } from '@/services/trafego'
import { Estado, SeloBadge, brl, num, seloDe, useCarregar } from '@/components/trafego/format'

type Alvo = { chave: 'ad_id' | 'adset_id' | 'campaign_id'; id: string; nome: string }

/** Lista dos leads de um anúncio/conjunto/campanha com o status atual. */
export function LeadsModal({ alvo, onClose }: { alvo: Alvo | null; onClose: () => void }) {
  const { dados, erro, carregando } = useCarregar(
    () => (alvo ? trafegoService.leads(alvo.chave, alvo.id) : Promise.resolve(null)),
    [alvo?.chave, alvo?.id],
  )
  return (
    <Modal open={!!alvo} onClose={onClose} title={alvo ? `Leads — ${alvo.nome}` : ''} size="lg">
      <Estado carregando={carregando} erro={erro}>
        {dados && dados.leads.length === 0 && <p className="py-6 text-center text-sm text-foreground/40">Nenhum lead.</p>}
        {dados && dados.leads.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-foreground/50">
                <tr><th className="py-1.5">Lead</th><th>Status</th><th>Quadro</th><th className="text-right">Entrou</th></tr>
              </thead>
              <tbody>
                {dados.leads.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-1.5"><span className="font-medium text-foreground">{l.nome || 'Sem nome'}</span>
                      {l.empresa && <span className="ml-1.5 text-xs text-foreground/40">{l.empresa}</span>}</td>
                    <td className="text-foreground/70">{l.status || '—'}</td>
                    <td className="text-foreground/50">{l.quadro}</td>
                    <td className="text-right text-xs text-foreground/50">{new Date(l.created_at).toLocaleDateString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Estado>
    </Modal>
  )
}

const COLS = ['Gasto', 'Leads', 'CPL', 'Agend.', 'Reun.', 'Custo/reun.', 'Vendas', 'CAC']

function Celulas({ l }: { l: LinhaTrafego }) {
  return (
    <>
      <td className="px-2 text-right tabular-nums">{brl(l.gasto)}</td>
      <td className="px-2 text-right tabular-nums">{num(l.leads)}</td>
      <td className="px-2 text-right tabular-nums">{brl(l.cpl)}</td>
      <td className="px-2 text-right tabular-nums">{num(l.agendadas)}</td>
      <td className="px-2 text-right tabular-nums">{num(l.reunioes)}</td>
      <td className="px-2 text-right font-medium tabular-nums">{brl(l.custoReuniao)}</td>
      <td className="px-2 text-right tabular-nums">{num(l.vendas)}</td>
      <td className="px-2 text-right tabular-nums">{brl(l.cac)}</td>
    </>
  )
}

/** Seletor de papel (escala/teste) da campanha — grava na hora. */
function PapelSelect({ id, valor, onSaved }: { id: string; valor: string; onSaved: () => void }) {
  return (
    <select
      value={valor}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        try { await trafegoService.marcarCampanha(id, { papel: e.target.value }); onSaved() }
        catch (err) { toast.error('Falha ao salvar: ' + (err as Error).message) }
      }}
      className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-foreground/70"
    >
      <option value="">sem papel</option>
      <option value="escala">escala</option>
      <option value="teste">teste</option>
    </select>
  )
}

export function CampanhasTab({ de, ate, papel, versao }: { de: string; ate: string; papel: FiltroPapel; versao: number }) {
  const camp = useCarregar(() => trafegoService.ranking('campanha', de, ate, papel), [de, ate, papel, versao])
  const conj = useCarregar(() => trafegoService.ranking('conjunto', de, ate, 'todos'), [de, ate, versao])
  const anun = useCarregar(() => trafegoService.ranking('anuncio', de, ate, 'todos'), [de, ate, versao])
  const [abertos, setAbertos] = React.useState<Set<string>>(new Set())
  const [leadsDe, setLeadsDe] = React.useState<Alvo | null>(null)
  const alternar = (k: string) => setAbertos((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const conjuntosPorCampanha = React.useMemo(() => {
    const m = new Map<string, LinhaTrafego[]>()
    for (const l of conj.dados?.linhas ?? []) m.set(l.campaignId ?? '', [...(m.get(l.campaignId ?? '') ?? []), l])
    return m
  }, [conj.dados])
  const anunciosPorConjunto = React.useMemo(() => {
    const m = new Map<string, LinhaTrafego[]>()
    for (const l of anun.dados?.linhas ?? []) m.set(l.adsetId ?? '', [...(m.get(l.adsetId ?? '') ?? []), l])
    return m
  }, [anun.dados])

  return (
    <Estado carregando={camp.carregando} erro={camp.erro}>
      <div className="overflow-x-auto rounded-xl border border-line bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-line text-left text-xs text-foreground/50">
            <tr>
              <th className="px-3 py-2">Campanha › conjunto › anúncio (melhor custo por reunião primeiro)</th>
              {COLS.map((c) => <th key={c} className="px-2 text-right">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {(camp.dados?.linhas ?? []).length === 0 && (
              <tr><td colSpan={COLS.length + 1} className="py-8 text-center text-foreground/40">Sem dados no período.</td></tr>
            )}
            {(camp.dados?.linhas ?? []).map((c) => {
              const aberta = abertos.has(`c:${c.id}`)
              return (
                <React.Fragment key={c.id}>
                  <tr className="cursor-pointer border-t border-line hover:bg-elevate/[0.03]" onClick={() => alternar(`c:${c.id}`)}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {aberta ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                        <span className="font-medium text-foreground">{c.nome}</span>
                        <SeloBadge selo={seloDe(c)} />
                        <PapelSelect id={c.id} valor={c.papel ?? ''} onSaved={camp.recarregar} />
                        {c.status && c.status !== 'ACTIVE' && <span className="text-[11px] text-foreground/35">{c.status.toLowerCase()}</span>}
                        <button type="button" title="Ver leads" onClick={(e) => { e.stopPropagation(); setLeadsDe({ chave: 'campaign_id', id: c.id, nome: c.nome }) }}
                          className="ml-auto rounded p-1 text-foreground/35 hover:bg-elevate/[0.08] hover:text-foreground"><Users className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                    <Celulas l={c} />
                  </tr>
                  {aberta && (conjuntosPorCampanha.get(c.id) ?? []).map((s) => {
                    const sAberto = abertos.has(`s:${s.id}`)
                    return (
                      <React.Fragment key={s.id}>
                        <tr className="cursor-pointer border-t border-line/60 bg-elevate/[0.02] hover:bg-elevate/[0.04]" onClick={() => alternar(`s:${s.id}`)}>
                          <td className="py-1.5 pl-9 pr-3">
                            <div className="flex items-center gap-1.5">
                              {sAberto ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                              <span className="text-foreground/85">{s.nome}</span>
                              <SeloBadge selo={seloDe(s)} />
                              {s.orcamentoDia != null && <span className="text-[11px] text-foreground/35">{brl(s.orcamentoDia)}/dia</span>}
                              <button type="button" title="Ver leads" onClick={(e) => { e.stopPropagation(); setLeadsDe({ chave: 'adset_id', id: s.id, nome: s.nome }) }}
                                className="ml-auto rounded p-1 text-foreground/35 hover:bg-elevate/[0.08] hover:text-foreground"><Users className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                          <Celulas l={s} />
                        </tr>
                        {sAberto && (anunciosPorConjunto.get(s.id) ?? []).map((a) => (
                          <tr key={a.id} className="border-t border-line/40 text-[13px]">
                            <td className="py-1.5 pl-16 pr-3">
                              <div className="flex items-center gap-2">
                                {a.thumbnail && <img src={a.thumbnail} alt="" className="h-7 w-7 rounded object-cover" loading="lazy" />}
                                <span className="text-foreground/80">{a.nome}</span>
                                <SeloBadge selo={seloDe(a)} />
                                <button type="button" title="Ver leads" onClick={() => setLeadsDe({ chave: 'ad_id', id: a.id, nome: a.nome })}
                                  className="ml-auto rounded p-1 text-foreground/35 hover:bg-elevate/[0.08] hover:text-foreground"><Users className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                            <Celulas l={a} />
                          </tr>
                        ))}
                      </React.Fragment>
                    )
                  })}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-foreground/35">
        Selo "em teste": menos de R$ 300 gastos ou menos de 15 leads — ainda sem veredito. "Cansando": frequência de 3 ou mais.
      </p>
      <LeadsModal alvo={leadsDe} onClose={() => setLeadsDe(null)} />
    </Estado>
  )
}
