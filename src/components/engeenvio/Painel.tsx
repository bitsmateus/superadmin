import * as React from 'react'
import { Badge } from '@/components/ui/Badge'
import type { EngeTudo } from '@/api/engeEnvio'
import { dataBr, dataHoraBr, diasAte, hoje, statusGarantia, textoDias } from '@/lib/engeEnvio'
import { Cartao, Kpi, Vazio, td, th, useIndices } from './shared'

/** Visão do dia: o que vence nos próximos 90 dias e quais avisos saem nas próximas 3 semanas. */
export function Painel({ dados, onAbrirEmpreendimento }: { dados: EngeTudo; onAbrirEmpreendimento: (id: string) => void }) {
  const { empPorId, garPorId, enviosPorGar } = useIndices(dados)

  const vencidas = dados.garantias.filter((g) => statusGarantia(g).chave === 'vencida')
  const breve = dados.garantias.filter((g) => statusGarantia(g).chave === 'breve')
  const chamados = dados.garantias.filter((g) => g.chamadoEm && diasAte(g.vencimento) > -60)
  const limite = Date.now() + 21 * 86_400_000
  const proximos = dados.envios
    .filter((e) => e.status === 'agendado' && new Date(e.enviarEm).getTime() <= limite)
    .sort((a, b) => a.enviarEm.localeCompare(b.enviarEm))
  const erros = dados.envios.filter((e) => e.status === 'erro')

  const atencao = dados.garantias
    .filter((g) => {
      const s = statusGarantia(g).chave
      return s === 'vencida' || s === 'breve' || (s !== 'encerrada' && diasAte(g.vencimento) <= 90)
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Vencidas sem chamado" valor={vencidas.length} detalhe="Precisam de ação" tom="danger" />
        <Kpi rotulo="Vencem em 30 dias" valor={breve.length} detalhe="Sem chamado aberto" tom="warning" />
        <Kpi rotulo="Chamados abertos" valor={chamados.length} detalhe="Aguardando a construtora" tom="info" />
        <Kpi rotulo="Avisos nos próx. 21 dias" valor={proximos.length} detalhe="Saem automaticamente" tom="success" />
      </div>

      {erros.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-sm text-danger">
          {erros.length === 1 ? '1 aviso não saiu' : `${erros.length} avisos não saíram`} por erro no envio. Veja na aba Avisos.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Cartao titulo="Garantias que vencem nos próximos 90 dias">
          {atencao.length === 0 ? (
            <Vazio>Nenhuma garantia vence nos próximos 90 dias.</Vazio>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line bg-elevate/[0.02]">
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Empreendimento</th>
                    <th className={th}>Vencimento</th>
                    <th className={th}>Avisos</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {atencao.map((g) => {
                    const s = statusGarantia(g)
                    const envs = enviosPorGar.get(g.id) ?? []
                    const enviados = envs.filter((e) => e.status === 'enviado').length
                    const agendados = envs.filter((e) => e.status === 'agendado').length
                    return (
                      <tr
                        key={g.id}
                        className="cursor-pointer hover:bg-elevate/[0.03]"
                        onClick={() => onAbrirEmpreendimento(g.empreendimentoId)}
                      >
                        <td className={td}>
                          <span className="font-medium">{g.item}</span>
                          {g.prazo && <span className="block text-xs text-foreground/50">{g.prazo}</span>}
                        </td>
                        <td className={td}>{empPorId.get(g.empreendimentoId)?.nome ?? '—'}</td>
                        <td className={td}>
                          <span className="tabular-nums">{dataBr(g.vencimento)}</span>
                          <span className="block text-xs text-foreground/50">{textoDias(diasAte(g.vencimento))}</span>
                        </td>
                        <td className={`${td} whitespace-nowrap text-xs text-foreground/70`}>
                          {enviados} enviado{enviados === 1 ? '' : 's'} · {agendados} agendado{agendados === 1 ? '' : 's'}
                        </td>
                        <td className={td}>
                          <Badge tone={s.tom} dot>
                            {s.label}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>

        <Cartao titulo="Próximos envios automáticos">
          {proximos.length === 0 ? (
            <Vazio>Nenhum aviso agendado para as próximas 3 semanas.</Vazio>
          ) : (
            <ul className="divide-y divide-line">
              {proximos.slice(0, 12).map((e) => {
                const g = garPorId.get(e.garantiaId)
                const emp = g ? empPorId.get(g.empreendimentoId) : undefined
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-elevate/[0.03]"
                      onClick={() => g && onAbrirEmpreendimento(g.empreendimentoId)}
                    >
                      <span className="w-24 shrink-0 text-xs tabular-nums text-foreground/70">{dataHoraBr(e.enviarEm)}</span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{g?.item ?? '—'}</span>
                        <span className="block break-words text-xs text-foreground/50">
                          {emp?.nome} · {[e.canalEmail && 'e-mail', e.canalWhatsapp && 'WhatsApp'].filter(Boolean).join(' + ')}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Cartao>
      </div>
      <p className="text-xs text-foreground/40">Hoje: {dataBr(hoje())}. Horários no fuso de Brasília.</p>
    </div>
  )
}
