import * as React from 'react'
import { ChevronDown, ChevronRight, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { trafegoService, type FiltroPapel, type LinhaTrafego } from '@/services/trafego'
import { Estado, SeloBadge, brl, meses, num, seloDe, useCarregar, vezes } from '@/components/trafego/format'

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
            {/* No celular: uma linha por lead, sem colunas espremidas. */}
            <ul className="divide-y divide-line sm:hidden">
              {dados.leads.map((l) => (
                <li key={l.id} className="py-2">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">{l.nome || 'Sem nome'}</span>
                    <span className="shrink-0 text-xs text-foreground/50">{new Date(l.created_at).toLocaleDateString('pt-BR')}</span>
                  </div>
                  {l.empresa && <p className="text-xs text-foreground/40">{l.empresa}</p>}
                  <p className="mt-0.5 text-xs text-foreground/60">{l.status || '—'} · <span className="text-foreground/45">{l.quadro}</span></p>
                </li>
              ))}
            </ul>
            <table className="w-full text-left text-sm max-sm:hidden">
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

const COLS = ['Gasto', 'Leads', 'CPL', 'Agend.', 'Reun.', 'Custo/reun.', 'Vendas', 'CAC', 'MRR', 'ROAS', 'Payback']

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
      <td className="px-2 text-right tabular-nums">{brl(l.mrr)}</td>
      <td className="px-2 text-right tabular-nums">{vezes(l.roas)}</td>
      <td className="px-2 text-right tabular-nums">{meses(l.paybackMeses)}</td>
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
      className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-foreground/70 max-sm:h-8 max-sm:text-xs"
    >
      <option value="">sem papel</option>
      <option value="escala">escala</option>
      <option value="teste">teste</option>
    </select>
  )
}

/* ---------- Celular: a árvore campanha › conjunto › anúncio vira cartões ---------- */

/** Os números principais em grade (4 por linha); o resto numa linha miúda embaixo. */
function MetricasCartao({ l }: { l: LinhaTrafego }) {
  const itens: [string, string, boolean?][] = [
    ['Gasto', brl(l.gasto)], ['Leads', num(l.leads)], ['CPL', brl(l.cpl)], ['Reuniões', num(l.reunioes)],
    ['Custo/reun.', brl(l.custoReuniao), true], ['Vendas', num(l.vendas)], ['CAC', brl(l.cac)], ['ROAS', vezes(l.roas)],
  ]
  return (
    <>
      <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1.5 text-xs">
        {itens.map(([rotulo, valor, destaque]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="truncate text-[10px] text-foreground/40">{rotulo}</dt>
            <dd className={destaque ? 'font-semibold tabular-nums text-foreground' : 'font-medium tabular-nums text-foreground/85'}>{valor}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] tabular-nums text-foreground/45">
        Agend. {num(l.agendadas)} · MRR {brl(l.mrr)} · Payback {meses(l.paybackMeses)}
      </p>
    </>
  )
}

function BotaoLeads({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" title="Ver leads" aria-label="Ver leads" onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-foreground/40 hover:bg-elevate/[0.08] hover:text-foreground">
      <Users className="h-4 w-4" />
    </button>
  )
}

/** Cabeçalho tocável (abre/fecha o nível de baixo) + botão de leads ao lado. */
function CabecalhoCartao({ aberto, onAlternar, temFilhos, onLeads, children }: {
  aberto: boolean; onAlternar?: () => void; temFilhos: boolean; onLeads: () => void; children: React.ReactNode
}) {
  const Chevron = aberto ? ChevronDown : ChevronRight
  return (
    <div className="flex items-start gap-1">
      {temFilhos ? (
        <button type="button" onClick={onAlternar} aria-expanded={aberto} className="-ml-1 flex min-h-8 min-w-0 flex-1 items-start gap-1 rounded-md py-1 text-left">
          <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-foreground/50" />
          <span className="min-w-0 flex-1">{children}</span>
        </button>
      ) : (
        <div className="min-h-8 min-w-0 flex-1 py-1">{children}</div>
      )}
      <BotaoLeads onClick={onLeads} />
    </div>
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
      {/* Celular: um cartão por campanha (a tabela tem 12 colunas e não cabe); toque pra abrir conjuntos e anúncios. */}
      <div className="space-y-2 sm:hidden">
        <p className="px-1 text-[11px] text-foreground/45">Melhor custo por reunião primeiro. Toque na campanha pra ver os conjuntos e, no conjunto, os anúncios.</p>
        {(camp.dados?.linhas ?? []).length === 0 && (
          <p className="rounded-xl border border-line bg-card py-8 text-center text-sm text-foreground/40">Sem dados no período.</p>
        )}
        {(camp.dados?.linhas ?? []).map((c) => {
          const aberta = abertos.has(`c:${c.id}`)
          const conjuntos = conjuntosPorCampanha.get(c.id) ?? []
          return (
            <article key={c.id} className="rounded-xl border border-line bg-card p-3">
              <CabecalhoCartao aberto={aberta} onAlternar={() => alternar(`c:${c.id}`)} temFilhos={conjuntos.length > 0}
                onLeads={() => setLeadsDe({ chave: 'campaign_id', id: c.id, nome: c.nome })}>
                <span className="break-words text-sm font-medium leading-snug text-foreground">{c.nome}</span>
              </CabecalhoCartao>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <SeloBadge selo={seloDe(c)} />
                <PapelSelect id={c.id} valor={c.papel ?? ''} onSaved={camp.recarregar} />
                {c.status && c.status !== 'ACTIVE' && <span className="text-[11px] text-foreground/35">{c.status.toLowerCase()}</span>}
                {conjuntos.length > 0 && <span className="ml-auto text-[11px] text-foreground/40">{conjuntos.length} conjunto{conjuntos.length === 1 ? '' : 's'}</span>}
              </div>
              <MetricasCartao l={c} />
              {aberta && conjuntos.length > 0 && (
                <ul className="mt-3 space-y-2 border-t border-line pt-3">
                  {conjuntos.map((st) => {
                    const sAberto = abertos.has(`s:${st.id}`)
                    const anuncios = anunciosPorConjunto.get(st.id) ?? []
                    return (
                      <li key={st.id} className="rounded-lg bg-elevate/[0.03] p-2.5 border border-line">
                        <CabecalhoCartao aberto={sAberto} onAlternar={() => alternar(`s:${st.id}`)} temFilhos={anuncios.length > 0}
                          onLeads={() => setLeadsDe({ chave: 'adset_id', id: st.id, nome: st.nome })}>
                          <span className="break-words text-[13px] leading-snug text-foreground/85">{st.nome}</span>
                        </CabecalhoCartao>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <SeloBadge selo={seloDe(st)} />
                          {st.orcamentoDia != null && <span className="text-[11px] text-foreground/40">{brl(st.orcamentoDia)}/dia</span>}
                          {anuncios.length > 0 && <span className="ml-auto text-[11px] text-foreground/40">{anuncios.length} anúncio{anuncios.length === 1 ? '' : 's'}</span>}
                        </div>
                        <MetricasCartao l={st} />
                        {sAberto && anuncios.length > 0 && (
                          <ul className="mt-2.5 space-y-2 border-t border-line/60 pt-2.5">
                            {anuncios.map((a) => (
                              <li key={a.id} className="rounded-md bg-card p-2.5 border border-line">
                                <div className="flex items-start gap-2">
                                  {a.thumbnail && <img src={a.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" loading="lazy" />}
                                  <div className="min-w-0 flex-1 py-0.5">
                                    <p className="break-words text-[13px] leading-snug text-foreground/80">{a.nome}</p>
                                    {seloDe(a) && <div className="mt-1"><SeloBadge selo={seloDe(a)} /></div>}
                                  </div>
                                  <BotaoLeads onClick={() => setLeadsDe({ chave: 'ad_id', id: a.id, nome: a.nome })} />
                                </div>
                                <MetricasCartao l={a} />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </article>
          )
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-line bg-card sm:block">
        <table className="w-full min-w-[1150px] text-sm">
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
