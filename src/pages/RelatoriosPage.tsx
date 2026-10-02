import * as React from 'react'
import { ChevronLeft, ChevronRight, Download, FileBarChart } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useClients } from '@/hooks/useClients'
import { currentMonthId, addMonthsToId, monthLabelPt, monthIdBounds, withinBounds } from '@/hooks/useMonthFilter'
import { downloadCsv } from '@/lib/csv'
import { formatDate } from '@/lib/utils'
import type { Client, AutomationType } from '@/types/client'

/**
 * RELATÓRIOS — menu único pra tirar relatórios por mês. Pensado pra crescer: cada relatório novo é
 * só mais uma entrada em TIPOS_RELATORIO + um componente de corpo, sem mexer no resto da tela.
 */
type TipoRelatorio = 'entregas'

const TIPOS_RELATORIO: { value: TipoRelatorio; label: string; descricao: string }[] = [
  {
    value: 'entregas',
    label: 'Entregas feitas',
    descricao: 'Clientes com a entrega concluída no mês — nome, empresa e tipo de conexão (chatbot/IA).',
  },
]

const AUTOMATION_LABEL: Record<AutomationType, string> = {
  chatbot: 'Chatbot',
  ia_basica: 'IA Básica',
  ia_avancada: 'IA Avançada',
  site: 'Site',
}

/** "Chatbot", "IA Básica", "IA Avançada" — na ordem que o briefing guarda; pode ter mais de um
 *  (ex.: IA + Site). "Site" sozinho não é bem um "tipo de conexão" mas entra se for o caso. */
function tiposConexao(client: Client): string {
  const tipos = client.briefingConfig?.automationTypes ?? []
  if (tipos.length === 0) return '—'
  return tipos.map((t) => AUTOMATION_LABEL[t] ?? t).join(' + ')
}

export function RelatoriosPage() {
  const clients = useClients()
  const [tipo, setTipo] = React.useState<TipoRelatorio>('entregas')
  const [mes, setMes] = React.useState(currentMonthId())
  const bounds = React.useMemo(() => monthIdBounds(mes), [mes])
  const tipoAtual = TIPOS_RELATORIO.find((t) => t.value === tipo)!

  // Entrega concluída = deliveryCompletedAt preenchido (não depende do stage atual: um cliente
  // entregue em janeiro pode já estar "Ativo" hoje, e continua contando como entrega de janeiro).
  const entregas = React.useMemo(
    () =>
      clients
        .filter((c) => withinBounds(c.deliveryCompletedAt, bounds))
        .sort((a, b) => (a.deliveryCompletedAt ?? '').localeCompare(b.deliveryCompletedAt ?? '')),
    [clients, bounds],
  )

  const linhas = tipo === 'entregas' ? entregas : []

  const exportar = () => {
    if (tipo === 'entregas') {
      downloadCsv(
        `entregas-${mes}.csv`,
        ['Cliente', 'Empresa', 'Tipo de conexão', 'Data da entrega', 'Responsável'],
        entregas.map((c) => [
          c.name ?? '',
          c.company ?? '',
          tiposConexao(c),
          formatDate(c.deliveryCompletedAt),
          c.responsavelEntrega ?? '',
        ]),
      )
    }
  }

  return (
    <>
      <TopBar
        title="Relatórios"
        subtitle={tipoAtual.label}
        rightSlot={
          linhas.length > 0 ? (
            <Button variant="secondary" onClick={exportar} leftIcon={<Download className="h-4 w-4" />}>
              Exportar CSV
            </Button>
          ) : undefined
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoRelatorio)}
            className="h-9 rounded-lg border border-line bg-card px-3 text-sm text-foreground outline-none focus:border-accent/40"
          >
            {TIPOS_RELATORIO.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMes((m) => addMonthsToId(m, -1))}
              className="grid h-8 w-8 place-items-center rounded-lg text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
              title="Mês anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[110px] text-center text-sm font-semibold text-foreground">{monthLabelPt(mes)}</span>
            <button
              type="button"
              onClick={() => setMes((m) => addMonthsToId(m, 1))}
              className="grid h-8 w-8 place-items-center rounded-lg text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
              title="Próximo mês"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            {mes !== currentMonthId() && (
              <button
                type="button"
                onClick={() => setMes(currentMonthId())}
                className="ml-1 rounded-lg px-2 py-1 text-xs text-accent hover:bg-accent/10"
              >
                Voltar pro mês atual
              </button>
            )}
          </div>
        </div>

        <p className="mb-4 text-xs text-foreground/45">{tipoAtual.descricao}</p>

        {tipo === 'entregas' && (
          entregas.length === 0 ? (
            <EmptyState
              icon={<FileBarChart className="h-8 w-8" />}
              title="Nenhuma entrega concluída nesse mês"
              description="Mude o mês acima ou confira se a entrega foi marcada como '100% finalizado' no cliente."
            />
          ) : (
            <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Empresa</th>
                      <th className="px-4 py-3">Tipo de conexão</th>
                      <th className="w-36 px-4 py-3">Data da entrega</th>
                      <th className="w-48 px-4 py-3">Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entregas.map((c) => (
                      <tr key={c.id} className="border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                        <td className="px-4 py-2.5 text-sm font-medium text-foreground">{c.name || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-foreground/70">{c.company || '—'}</td>
                        <td className="px-4 py-2.5 text-sm text-foreground/70">{tiposConexao(c)}</td>
                        <td className="px-4 py-2.5 text-sm tabular-nums text-foreground/60">{formatDate(c.deliveryCompletedAt)}</td>
                        <td className="px-4 py-2.5 text-sm text-foreground/60">{c.responsavelEntrega || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                      <td className="px-4 py-3" colSpan={5}>
                        Total: {entregas.length} entrega(s) em {monthLabelPt(mes)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )
        )}
      </div>
    </>
  )
}
