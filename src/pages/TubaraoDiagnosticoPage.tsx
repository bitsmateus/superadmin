import * as React from 'react'
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'

interface Diagnostico {
  quadroTubarao: string
  colunas: { esperado: string; situacao: 'ok' | 'nome diferente' | 'falta'; nomeNoTubarao: string | null }[]
  colunasDoTubarao: string[]
  leads: {
    rotulo: string
    cards: {
      id: string; nome: string; empresa: string; telefone: string; tipo: string; sdr: string; status: string
      quadro: string; quadroId: string; coluna: string; agendamento: string; criadoEm: string; excluido: boolean
      atualizacoes: number; tipoDeCard: string; deTubarao: boolean
    }[]
  }[]
  foraDoTubarao?: {
    id: string; nome: string; empresa: string; telefone: string; tipo: string; sdr: string; quadro: string; coluna: string
    agendamento: string; criadoEm: string; atualizacoes: number; motivo: string
  }[]
}

/**
 * Conferência do CRM TUBARAO (só leitura, só admin) — /admin/tubarao. Mostra se as colunas que a automação da Luiza
 * usa existem no CRM TUBARAO e todos os cards dos leads que vão ser acertados, pra conferir antes de mexer.
 */
export function TubaraoDiagnosticoPage() {
  const [d, setD] = React.useState<Diagnostico | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  React.useEffect(() => {
    api.get<Diagnostico>('/api/admin/tubarao/diagnostico').then(setD).catch((e) => setErro((e as Error).message))
  }, [])

  return (
    <>
      <TopBar title="Conferência do CRM TUBARAO" subtitle="Só leitura · nada aqui muda nenhum card" />
      <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {erro && <p className="text-sm text-danger">{erro}</p>}
        {!d && !erro && (
          <p className="inline-flex items-center gap-2 text-sm text-foreground/50"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>
        )}
        {d && (
          <>
            <section className="rounded-2xl bg-card p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-foreground">Colunas que a automação da Luiza usa</h2>
              <p className="mb-3 text-xs text-foreground/50">Quadro <code>{d.quadroTubarao}</code> · colunas de hoje: {d.colunasDoTubarao.join(', ') || '—'}</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {d.colunas.map((c) => (
                  <li key={c.esperado} className="flex items-center gap-2 text-sm">
                    {c.situacao === 'ok' ? <CheckCircle2 className="h-4 w-4 text-success" />
                      : c.situacao === 'falta' ? <XCircle className="h-4 w-4 text-danger" />
                      : <AlertTriangle className="h-4 w-4 text-warning" />}
                    <span className="font-medium text-foreground">{c.esperado}</span>
                    {c.situacao === 'nome diferente' && <span className="text-xs text-warning">está como “{c.nomeNoTubarao}”</span>}
                    {c.situacao === 'falta' && <span className="text-xs text-danger">não existe</span>}
                  </li>
                ))}
              </ul>
            </section>

            {d.leads.map((l) => (
              <section key={l.rotulo} className="rounded-2xl bg-card p-4 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold text-foreground">{l.rotulo} <span className="font-normal text-foreground/45">· {l.cards.length} card(s)</span></h2>
                {l.cards.length === 0 ? (
                  <p className="text-xs text-foreground/45">Nenhum card encontrado (pelo nome, só leads de Tubarão: Tipo “tubarao…” ou DDD 48).</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-[11px] text-foreground/45">
                          {['Quadro', 'Coluna', 'SDR', 'Criado em', 'Nome', 'Telefone', 'Tipo', 'Agendamento', 'Atualizações', 'Card', 'id'].map((h) => (
                            <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {l.cards.map((c) => (
                          <tr key={c.id} className={cn('border-b border-line last:border-0', c.excluido && 'opacity-45')}>
                            <td className="px-2 py-1.5 font-medium text-foreground">{c.quadro}{c.excluido && ' (excluído)'}</td>
                            <td className="px-2 py-1.5">{c.coluna}</td>
                            <td className="px-2 py-1.5">{c.sdr || '—'}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{new Date(c.criadoEm).toLocaleString('pt-BR')}</td>
                            <td className="px-2 py-1.5">{c.nome}{c.empresa && c.empresa !== c.nome ? ` · ${c.empresa}` : ''}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{c.telefone}</td>
                            <td className="px-2 py-1.5">{c.tipo || '—'}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{c.agendamento || '—'}</td>
                            <td className="px-2 py-1.5 text-center">{c.atualizacoes}</td>
                            <td className="px-2 py-1.5">{c.tipoDeCard}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-foreground/45">{c.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            ))}

            {d.foraDoTubarao && (
              <section className="rounded-2xl bg-card p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-foreground">
                  Outros leads de Tubarão fora do CRM TUBARAO <span className="font-normal text-foreground/45">· {d.foraDoTubarao.length}</span>
                </h2>
                <p className="mb-3 text-xs text-foreground/50">
                  Cards originais no CRM ARTHUR e no CRM IA LUIZA com Tipo “tubarao…” ou DDD 48. Nada aqui é movido sozinho.
                </p>
                {d.foraDoTubarao.length === 0 ? (
                  <p className="text-xs text-foreground/45">Nenhum.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-xs">
                      <thead>
                        <tr className="border-b border-line text-[11px] text-foreground/45">
                          {['Quadro', 'Coluna', 'SDR', 'Criado em', 'Nome', 'Telefone', 'Por quê', 'Agendamento', 'Atualizações', 'id'].map((h) => (
                            <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.foraDoTubarao.map((c) => (
                          <tr key={c.id} className="border-b border-line last:border-0">
                            <td className="px-2 py-1.5 font-medium text-foreground">{c.quadro}</td>
                            <td className="px-2 py-1.5">{c.coluna}</td>
                            <td className="px-2 py-1.5">{c.sdr || '—'}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{new Date(c.criadoEm).toLocaleString('pt-BR')}</td>
                            <td className="px-2 py-1.5">{c.nome}{c.empresa && c.empresa !== c.nome ? ` · ${c.empresa}` : ''}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{c.telefone}</td>
                            <td className="px-2 py-1.5">{c.motivo}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">{c.agendamento || '—'}</td>
                            <td className="px-2 py-1.5 text-center">{c.atualizacoes}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] text-foreground/45">{c.id}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
