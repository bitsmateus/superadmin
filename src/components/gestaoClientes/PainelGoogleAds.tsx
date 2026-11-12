import * as React from 'react'
import { Link2, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { brlExato, num, useCarregar, Estado, Painel, Vazio } from '@/components/trafego/format'
import { GraficoDiario, Kpi, quandoFoi } from '@/components/gestaoClientes/trafegoBlocos'
import { gcTrafego, type GcContaGoogle, type GcTotaisGoogle } from '@/services/gcTrafego'

/** CTR em fração → "1,23%". */
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(2).replace('.', ',')}%`)

const CANAL: Record<string, string> = {
  SEARCH: 'Pesquisa', DISPLAY: 'Display', VIDEO: 'YouTube', SHOPPING: 'Shopping', PERFORMANCE_MAX: 'Performance Max',
  DEMAND_GEN: 'Demand Gen', DISCOVERY: 'Discovery', LOCAL: 'Local', SMART: 'Inteligente', MULTI_CHANNEL: 'App', LOCAL_SERVICES: 'Serviços locais',
}
const STATUS: Record<string, { label: string; classe: string }> = {
  ENABLED: { label: 'Ativa', classe: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  PAUSED: { label: 'Pausada', classe: 'bg-elevate/[0.08] text-foreground/60' },
  REMOVED: { label: 'Removida', classe: 'bg-danger/10 text-danger' },
}

function KpisGoogle({ atual, anterior }: { atual: GcTotaisGoogle; anterior: GcTotaisGoogle }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi titulo="Investimento" valor={brlExato(atual.gasto)} atual={atual.gasto} anterior={anterior.gasto} detalhe={`antes: ${brlExato(anterior.gasto)}`} />
      <Kpi titulo="Conversões" valor={num(Math.round(atual.conversoes))} atual={atual.conversoes} anterior={anterior.conversoes} detalhe="como marcadas no Google Ads" />
      <Kpi titulo="Custo por conversão" valor={brlExato(atual.custoConversao)} atual={atual.custoConversao} anterior={anterior.custoConversao} menorMelhor detalhe={`antes: ${brlExato(anterior.custoConversao)}`} />
      <Kpi titulo="Cliques" valor={num(atual.cliques)} atual={atual.cliques} anterior={anterior.cliques} detalhe={`CTR ${pct(atual.ctr)}`} />
      <Kpi titulo="CPC médio" valor={brlExato(atual.cpc)} atual={atual.cpc} anterior={anterior.cpc} menorMelhor detalhe={`${num(atual.impressoes)} impressões`} />
      {atual.roas != null || anterior.roas != null ? (
        <Kpi titulo="ROAS" valor={atual.roas == null ? '—' : `${atual.roas.toFixed(1).replace('.', ',')}x`} atual={atual.roas} anterior={anterior.roas} detalhe={`${brlExato(atual.valorConversoes)} em valor`} />
      ) : (
        <Kpi titulo="Impressões" valor={num(atual.impressoes)} atual={atual.impressoes} anterior={anterior.impressoes} />
      )}
    </div>
  )
}

function ModalContasGoogle({ aberto, onFechar, clienteId, contas, onMudou }: {
  aberto: boolean; onFechar: () => void; clienteId: string; contas: GcContaGoogle[]; onMudou: () => void
}) {
  const [id, setId] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const vincular = async () => {
    setSalvando(true)
    try {
      const c = await gcTrafego.vincularGoogle(clienteId, id)
      toast.success(`Conta ${c.nome || c.customer_id} vinculada. A primeira coleta (90 dias) roda em segundo plano.`)
      setId('')
      onMudou()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const desvincular = async (c: GcContaGoogle) => {
    if (!window.confirm(`Desvincular a conta ${c.nome || c.customer_id_formatado}? Os números já coletados ficam.`)) return
    try {
      await gcTrafego.desvincularGoogle(c.id)
      onMudou()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  return (
    <Modal open={aberto} onClose={onFechar} title="Contas do Google Ads" description="Vincule pelo ID de cliente que aparece no topo do Google Ads (123-456-7890).">
      <div className="space-y-4">
        {contas.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {contas.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{c.nome || c.customer_id_formatado}</p>
                  <p className="text-xs text-foreground/50">{c.customer_id_formatado} · {c.moeda || '—'} · atualizado {quandoFoi(c.ultimo_sync_em)}</p>
                  {c.ultimo_erro && <p className="mt-0.5 text-xs text-danger">{c.ultimo_erro}</p>}
                </div>
                <button type="button" onClick={() => void desvincular(c)} title="Desvincular" className="text-foreground/35 hover:text-danger">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Input label="ID de cliente do Google Ads" placeholder="123-456-7890" value={id} onChange={(e) => setId(e.target.value)} containerClassName="flex-1" />
          <Button loading={salvando} disabled={id.replace(/\D/g, '').length !== 10} onClick={() => void vincular()}>Vincular</Button>
        </div>
        <p className="text-xs text-foreground/50">A conta precisa estar vinculada à conta de administrador (MCC) da NX no Google Ads. Só leitura: nada é alterado no Google.</p>
      </div>
    </Modal>
  )
}

/**
 * Google Ads do cliente na aba Tráfego: números do período (com comparação), gasto por dia e as
 * campanhas. Coletado junto com o Meta (07h, 11h, 15h e 19h) e no "Atualizar agora".
 */
export function PainelGoogleAds({ clienteId, de, ate }: { clienteId: string; de: string; ate: string }) {
  const { dados, erro, carregando, recarregar } = useCarregar(() => gcTrafego.google(clienteId, de, ate), [clienteId, de, ate])
  const [contasAbertas, setContasAbertas] = React.useState(false)
  const [sincronizando, setSincronizando] = React.useState(false)
  const contas = dados?.contas ?? []
  const ultimoSync = contas.map((c) => c.ultimo_sync_em).filter(Boolean).sort().pop() ?? null

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await gcTrafego.sincronizar(clienteId)
      const falhas = r.resultados.filter((x) => !x.ok)
      if (falhas.length) toast.error(falhas.map((f) => `${f.conta}: ${f.erro}`).join('\n'))
      else toast.success('Números atualizados')
      recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {contas.length > 0 && <span className="hidden text-xs text-foreground/45 sm:inline">Google atualizado {quandoFoi(ultimoSync)}</span>}
        {contas.length > 0 && (
          <Button variant="secondary" size="sm" loading={sincronizando} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void sincronizar()}>
            Atualizar agora
          </Button>
        )}
        <Button variant="ghost" size="sm" leftIcon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setContasAbertas(true)}>
          {contas.length ? `Contas Google (${contas.length})` : 'Vincular conta Google'}
        </Button>
      </div>

      <Estado carregando={carregando && !dados} erro={erro}>
        {dados && !dados.configurado && contas.length === 0 ? (
          <Painel>
            <p className="text-sm text-foreground/70">
              O Google Ads ainda não está configurado no servidor. Falta o token de desenvolvedor e o acesso da conta de
              administrador (MCC) da NX. O passo a passo está no <code>server/.env.example</code> (GOOGLE_ADS_…).
            </p>
          </Painel>
        ) : dados && contas.length === 0 ? (
          <Painel>
            <div className="mx-auto max-w-md py-6 text-center">
              <Link2 className="mx-auto h-8 w-8 text-foreground/30" />
              <p className="mt-3 text-sm font-medium text-foreground">Nenhuma conta do Google Ads vinculada</p>
              <p className="mt-1 text-sm text-foreground/55">Vincule pelo ID de cliente do Google Ads pra ver investimento, cliques, conversões e campanhas aqui.</p>
              <Button className="mt-4" leftIcon={<Link2 className="h-4 w-4" />} onClick={() => setContasAbertas(true)}>Vincular conta Google</Button>
            </div>
          </Painel>
        ) : dados ? (
          <>
            {contas.some((c) => c.ultimo_erro) && (
              <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">Erro ao ler o Google Ads: {contas.find((c) => c.ultimo_erro)?.ultimo_erro}</p>
            )}
            {!ultimoSync && !contas.some((c) => c.ultimo_erro) && (
              <p className="flex items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm text-foreground/75">
                <Loader2 className="h-4 w-4 animate-spin" /> Puxando o histórico do Google Ads pela primeira vez. Clique em “Atualizar agora” em alguns minutos.
              </p>
            )}
            <KpisGoogle atual={dados.totais.atual} anterior={dados.totais.anterior} />
            <Painel title="Investimento por dia">
              <GraficoDiario serie={dados.serie} />
              <p className="mt-2 text-[11px] text-foreground/40">Número em cima da barra = conversões do dia.</p>
            </Painel>
            <Painel title="Campanhas no período">
              {dados.campanhas.length === 0 ? (
                <Vazio>Nenhuma campanha teve impressão no período.</Vazio>
              ) : (
                <div className="-mx-4 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-foreground/45">
                        <th className="px-4 py-2 font-medium">Campanha</th>
                        <th className="px-2 py-2 font-medium">Tipo</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 text-right font-medium">Investido</th>
                        <th className="px-2 py-2 text-right font-medium">Impressões</th>
                        <th className="px-2 py-2 text-right font-medium">Cliques</th>
                        <th className="px-2 py-2 text-right font-medium">CTR</th>
                        <th className="px-2 py-2 text-right font-medium">CPC</th>
                        <th className="px-2 py-2 text-right font-medium">Conversões</th>
                        <th className="px-2 py-2 text-right font-medium">Custo/conv.</th>
                        <th className="px-4 py-2 text-right font-medium">Orç./dia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.campanhas.map((c) => {
                        const st = STATUS[c.status] ?? { label: c.status || '—', classe: 'bg-elevate/[0.08] text-foreground/60' }
                        return (
                          <tr key={c.id} className="border-b border-line/60 last:border-0">
                            <td className="max-w-[300px] truncate px-4 py-2 text-foreground" title={`${c.nome} · ${c.conta}`}>{c.nome}</td>
                            <td className="px-2 py-2 text-xs text-foreground/70">{CANAL[c.canal] ?? c.canal}</td>
                            <td className="px-2 py-2"><span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', st.classe)}>{st.label}</span></td>
                            <td className="px-2 py-2 text-right tabular-nums">{brlExato(c.gasto)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{num(c.impressoes)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{num(c.cliques)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{pct(c.ctr)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{brlExato(c.cpc)}</td>
                            <td className="px-2 py-2 text-right font-medium tabular-nums">{num(Math.round(c.conversoes))}</td>
                            <td className="px-2 py-2 text-right tabular-nums">{brlExato(c.custoConversao)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-foreground/60">{brlExato(c.orcamentoDia)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Painel>
          </>
        ) : null}
      </Estado>

      <ModalContasGoogle aberto={contasAbertas} onFechar={() => setContasAbertas(false)} clienteId={clienteId} contas={contas} onMudou={recarregar} />
    </div>
  )
}
