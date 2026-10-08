import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { trafegoService, type AlertaTrafego } from '@/services/trafego'
import { Estado, Painel, Vazio, useCarregar } from '@/components/trafego/format'

const NIVEL: Record<AlertaTrafego['level'], { rotulo: string; classe: string }> = {
  critico: { rotulo: 'Crítico', classe: 'bg-danger/15 text-danger' },
  atencao: { rotulo: 'Atenção', classe: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  oportunidade: { rotulo: 'Oportunidade', classe: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
}

/** Alertas abertos (com "Resolver"), os últimos resolvidos e o histórico da varredura da IA. */
export function AlertasTab({ versao }: { versao: number }) {
  const alertas = useCarregar(() => trafegoService.alertas(), [versao])
  const ia = useCarregar(() => trafegoService.ia(), [versao])

  const resolver = async (id: string) => {
    try { await trafegoService.resolverAlerta(id); alertas.recarregar() }
    catch (e) { toast.error('Falha ao resolver: ' + (e as Error).message) }
  }

  return (
    <div className="space-y-4">
      <Estado carregando={alertas.carregando} erro={alertas.erro}>
        <Painel title={`Alertas abertos (${alertas.dados?.abertos.length ?? 0})`}>
          {alertas.dados?.abertos.length === 0 && <Vazio>Nenhum alerta aberto. Tudo dentro dos limites.</Vazio>}
          <ul className="space-y-2">
            {alertas.dados?.abertos.map((a) => (
              <li key={a.id} className="flex items-start gap-3 rounded-lg border border-line p-2.5">
                <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', NIVEL[a.level].classe)}>{NIVEL[a.level].rotulo}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-foreground/35">{new Date(a.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <button type="button" onClick={() => void resolver(a.id)}
                  className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10">Resolver</button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-foreground/35">
            Os alertas se resolvem sozinhos quando a condição some. Se você resolver à mão e a condição continuar valendo, ele reabre na próxima rodada.
          </p>
        </Painel>
        {(alertas.dados?.resolvidos.length ?? 0) > 0 && (
          <Painel title="Resolvidos recentemente">
            <ul className="space-y-1.5">
              {alertas.dados?.resolvidos.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-sm text-foreground/55">
                  <span className="shrink-0 text-[11px] text-foreground/35">{a.resolved_at ? new Date(a.resolved_at).toLocaleDateString('pt-BR') : ''}</span>
                  <span className="min-w-0 flex-1">{a.message}</span>
                </li>
              ))}
            </ul>
          </Painel>
        )}
      </Estado>

      <Estado carregando={ia.carregando} erro={ia.erro}>
        <Painel title="Varredura diária com IA">
          {ia.dados?.revisoes.length === 0 && (
            <Vazio>Ainda sem varreduras — a revisão diária com IA entra na próxima fase.</Vazio>
          )}
          <div className="space-y-3">
            {ia.dados?.revisoes.map((r) => (
              <div key={r.dia} className="rounded-lg border border-line p-3">
                <p className="text-xs font-medium text-foreground/50">{r.dia.split('-').reverse().join('/')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">{r.texto}</p>
              </div>
            ))}
          </div>
        </Painel>
      </Estado>
    </div>
  )
}
