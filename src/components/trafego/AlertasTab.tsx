import * as React from 'react'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { trafegoService, type AlertaTrafego, type CategoriaIa, type SugestaoIa } from '@/services/trafego'
import { Estado, Painel, Vazio, useCarregar } from '@/components/trafego/format'

const NIVEL: Record<AlertaTrafego['level'], { rotulo: string; classe: string }> = {
  critico: { rotulo: 'Crítico', classe: 'bg-danger/15 text-danger' },
  atencao: { rotulo: 'Atenção', classe: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  oportunidade: { rotulo: 'Oportunidade', classe: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
}

const CATEGORIA_IA: Record<CategoriaIa, string> = {
  verba: 'Verba', criativo: 'Criativo', publico: 'Público', nicho: 'Nicho', copy: 'Copy', operacao: 'Operação',
}

function CartaoSugestao({ dia, s, onMudou }: { dia: string; s: SugestaoIa; onMudou: () => void }) {
  const marcar = async (status: 'aceita' | 'ignorada' | 'pendente') => {
    try { await trafegoService.marcarSugestao(dia, s.id, status); onMudou() }
    catch (e) { toast.error('Falha ao salvar: ' + (e as Error).message) }
  }
  return (
    <div className={cn('rounded-lg border border-line p-3', s.status !== 'pendente' && 'opacity-60')}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{CATEGORIA_IA[s.categoria]}</span>
        <h4 className="min-w-0 flex-1 text-sm font-medium text-foreground">{s.titulo}</h4>
        {s.status !== 'pendente' && (
          <button type="button" onClick={() => void marcar('pendente')} className="shrink-0 text-[11px] text-foreground/40 hover:text-foreground">
            {s.status === 'aceita' ? 'aceita' : 'ignorada'} · desfazer
          </button>
        )}
      </div>
      {s.detalhe && <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/80">{s.detalhe}</p>}
      {s.dado && <p className="mt-1.5 text-xs text-foreground/45">Dado: {s.dado}</p>}
      {s.status === 'pendente' && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void marcar('aceita')} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"><Check className="h-3 w-3" />Aceitar</button>
          <button type="button" onClick={() => void marcar('ignorada')} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-foreground/50 hover:bg-elevate/[0.06]"><X className="h-3 w-3" />Ignorar</button>
        </div>
      )}
    </div>
  )
}

/** Alertas abertos (com "Resolver"), os últimos resolvidos e o histórico da varredura da IA. */
export function AlertasTab({ versao }: { versao: number }) {
  const alertas = useCarregar(() => trafegoService.alertas(), [versao])
  const ia = useCarregar(() => trafegoService.ia(), [versao])
  const [rodando, setRodando] = React.useState(false)
  const rodarIa = async () => {
    setRodando(true)
    try {
      await trafegoService.rodarIa()
      // A IA leva de 20s a alguns minutos: acompanha o status em vez de segurar a conexão aberta.
      for (let i = 0; i < 100; i++) {
        await new Promise((ok) => setTimeout(ok, 3000))
        const s = await trafegoService.statusIa()
        if (!s.rodando) {
          if (s.erro) toast.error('Varredura falhou: ' + s.erro)
          else {
            const res = s.resultado
            if (!res) toast.message('Varredura terminou, mas o servidor não devolveu o resultado — recarregue a página.')
            else if (!res.gravado) toast.error('A IA respondeu, mas a varredura não ficou gravada no banco.')
            else toast.success(`Varredura pronta: ${res.sugestoes} sugestão(ões) gravada(s) em ${res.dia.split('-').reverse().join('/')}`)
            ia.recarregar()
          }
          return
        }
      }
      toast.error('A varredura está demorando mais que o normal — volte e atualize em instantes.')
    } catch (e) { toast.error((e as Error).message) }
    finally { setRodando(false) }
  }

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
        <Painel
          title="Varredura diária com IA"
          action={(
            <button type="button" onClick={() => void rodarIa()} disabled={rodando}
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-foreground/60 hover:bg-elevate/[0.04] disabled:opacity-50">
              {rodando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Rodar agora
            </button>
          )}
        >
          {ia.dados?.revisoes.length === 0 && (
            <Vazio>Ainda sem varreduras. Ela roda sozinha todo dia às 08h05 (precisa de ANTHROPIC_API_KEY no servidor) — ou clique em "Rodar agora".</Vazio>
          )}
          <div className="space-y-3">
            {ia.dados?.revisoes.map((r) => (
              <div key={r.dia} className="rounded-lg border border-line p-3">
                <p className="text-xs font-medium text-foreground/50">{r.dia.split('-').reverse().join('/')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">{r.texto}</p>
                <div className="mt-2 space-y-2">
                  {r.sugestoes.map((s) => <CartaoSugestao key={s.id} dia={r.dia} s={s} onMudou={ia.recarregar} />)}
                </div>
              </div>
            ))}
          </div>
        </Painel>
      </Estado>
    </div>
  )
}
