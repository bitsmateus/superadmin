import * as React from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { EngeTudo } from '@/api/engeEnvio'
import { cn } from '@/lib/utils'
import { dataHoraBr, statusEnvio } from '@/lib/engeEnvio'
import { Cartao, Vazio, td, th, useIndices } from './shared'
import { EmailModal } from './EmailModal'

const FILTROS = [
  { id: 'enviado', label: 'Enviados' },
  { id: 'agendado', label: 'Agendados' },
  { id: 'erro', label: 'Com erro' },
  { id: 'cancelado', label: 'Cancelados' },
]

/** Todos os avisos: o histórico de enviados (comprovante) e a fila do que ainda vai sair. */
export function Avisos({ dados, onAbrirEmpreendimento }: { dados: EngeTudo; onAbrirEmpreendimento: (id: string) => void }) {
  const { empPorId, garPorId } = useIndices(dados)
  const [filtro, setFiltro] = React.useState('enviado')
  const [verEmail, setVerEmail] = React.useState<string | null>(null)

  const lista = dados.envios
    .filter((e) => e.status === filtro)
    .sort((a, b) =>
      filtro === 'agendado' ? a.enviarEm.localeCompare(b.enviarEm) : (b.enviadoEm ?? b.enviarEm).localeCompare(a.enviadoEm ?? a.enviarEm),
    )
  const conta = (s: string) => dados.envios.filter((e) => e.status === s).length

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/60">
        Cada aviso fica registrado com data, hora, destinatário e o texto exato que saiu, por e-mail e por WhatsApp. É a prova de que o cliente foi avisado.
      </p>
      <Cartao
        titulo={
          <div className="flex flex-wrap gap-1">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFiltro(f.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  filtro === f.id ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:bg-elevate/[0.05] hover:text-foreground',
                )}
              >
                {f.label} <span className="tabular-nums opacity-70">{conta(f.id)}</span>
              </button>
            ))}
          </div>
        }
      >
        {lista.length === 0 ? (
          <Vazio>Nada aqui.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-line bg-elevate/[0.02]">
                <tr>
                  <th className={th}>{filtro === 'enviado' ? 'Enviado em' : 'Envio marcado para'}</th>
                  <th className={th}>Garantia</th>
                  <th className={th}>Destinatário</th>
                  <th className={th}>Canais</th>
                  <th className={th}>Situação</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((e) => {
                  const g = garPorId.get(e.garantiaId)
                  const emp = g ? empPorId.get(g.empreendimentoId) : undefined
                  const s = statusEnvio(e)
                  return (
                    <tr key={e.id}>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>{dataHoraBr(e.enviadoEm ?? e.whatsappEnviadoEm ?? e.enviarEm)}</td>
                      <td className={td}>
                        <span className="font-medium">{g?.item ?? '—'}</span>
                        <span className="block text-xs text-foreground/50">{emp?.nome}</span>
                      </td>
                      <td className={`${td} break-words text-xs text-foreground/70`}>
                        {emp?.sindico && <span className="block text-sm text-foreground">{emp.sindico}</span>}
                        {e.canalEmail && <span className="block">{e.destinatarios ?? emp?.emails ?? 'sem e-mail'}</span>}
                        {e.canalWhatsapp && <span className="block">{e.whatsappPara ?? emp?.telefone ?? 'sem WhatsApp'}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap text-xs`}>
                        {e.canalEmail && (
                          <span className={cn('block', e.enviadoEm ? 'text-success' : e.erro ? 'text-danger' : 'text-foreground/60')}>
                            E-mail {e.enviadoEm ? '✓' : e.erro ? '✗' : ''}
                          </span>
                        )}
                        {e.canalWhatsapp && (
                          <span
                            className={cn(
                              'block',
                              e.whatsappEnviadoEm ? 'text-success' : e.whatsappErro ? 'text-danger' : 'text-foreground/60',
                            )}
                          >
                            WhatsApp {e.whatsappEnviadoEm ? '✓' : e.whatsappErro ? '✗' : ''}
                          </span>
                        )}
                      </td>
                      <td className={td}>
                        <Badge tone={s.tom} dot>
                          {s.label}
                        </Badge>
                        {e.cienteEm && <span className="block text-xs text-foreground/50">{e.cienteNome} · {dataHoraBr(e.cienteEm)}</span>}
                        {e.erro && <span className="block max-w-xs text-xs text-danger">E-mail: {e.erro}</span>}
                        {e.whatsappErro && (
                          <span className={cn('block max-w-xs break-words text-xs', e.whatsappEnviadoEm ? 'text-warning' : 'text-danger')}>
                            WhatsApp: {e.whatsappErro}
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {e.enviadoEm || e.whatsappEnviadoEm ? (
                          <Button size="sm" variant="ghost" onClick={() => setVerEmail(e.id)}>
                            Ver enviado
                          </Button>
                        ) : (
                          g && (
                            <Button size="sm" variant="ghost" onClick={() => onAbrirEmpreendimento(g.empreendimentoId)}>
                              Abrir
                            </Button>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
      <EmailModal envioId={verEmail} onFechar={() => setVerEmail(null)} />
    </div>
  )
}
