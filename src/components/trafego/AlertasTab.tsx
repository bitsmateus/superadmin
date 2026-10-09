import * as React from 'react'
import { Check, Loader2, MessageCircle, Sparkles, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { trafegoService, type AcaoMeta, type AlertaTrafego, type CategoriaIa, type SugestaoIa } from '@/services/trafego'
import { ChatSugestao } from '@/components/trafego/ChatSugestao'
import { ConfirmarAcaoModal } from '@/components/trafego/ConfirmarAcaoModal'
import { Estado, Painel, Vazio, useCarregar } from '@/components/trafego/format'

const NIVEL: Record<AlertaTrafego['level'], { rotulo: string; classe: string }> = {
  critico: { rotulo: 'Crítico', classe: 'bg-danger/15 text-danger' },
  atencao: { rotulo: 'Atenção', classe: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  oportunidade: { rotulo: 'Oportunidade', classe: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
}

const CATEGORIA_IA: Record<CategoriaIa, string> = {
  verba: 'Verba', criativo: 'Criativo', publico: 'Público', nicho: 'Nicho', copy: 'Copy', operacao: 'Operação',
}

function rotuloAcao(a: AcaoMeta): string {
  const alvo = a.nivel === 'campanha' ? 'campanha' : a.nivel === 'conjunto' ? 'conjunto' : 'anúncio'
  if (a.tipo === 'pausar') return `Pausar ${alvo} no Meta`
  if (a.tipo === 'ativar') return `Reativar ${alvo} no Meta`
  return `Mudar orçamento no Meta`
}

/** Ação inversa pra "Reverter" a partir do que foi registrado ao aplicar. */
function acaoInversa(s: SugestaoIa): AcaoMeta | null {
  const ap = s.aplicada
  if (!ap) return null
  const a = ap.acao
  if (a.tipo === 'pausar') return { tipo: 'ativar', nivel: a.nivel, id: a.id }
  if (a.tipo === 'ativar') return { tipo: 'pausar', nivel: a.nivel, id: a.id }
  const antes = (ap.antes as { orcamentoDia?: number | null } | null)?.orcamentoDia
  return typeof antes === 'number' ? { tipo: 'orcamento', nivel: a.nivel, id: a.id, valor: antes } : null
}

function CartaoSugestao({ dia, s, onMudou, admin }: { dia: string; s: SugestaoIa; onMudou: () => void; admin: boolean }) {
  const [conversando, setConversando] = React.useState(false)
  const [confirmar, setConfirmar] = React.useState<{ acao: AcaoMeta; reversao: boolean } | null>(null)
  const marcar = async (status: 'aceita' | 'ignorada' | 'pendente') => {
    try { await trafegoService.marcarSugestao(dia, s.id, status); onMudou() }
    catch (e) { toast.error('Falha ao salvar: ' + (e as Error).message) }
  }
  const inversa = acaoInversa(s)
  return (
    <div className={cn('rounded-lg border border-line p-3', s.status !== 'pendente' && !conversando && 'opacity-70')}>
      <div className="flex items-start gap-2 max-sm:flex-wrap">
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">{CATEGORIA_IA[s.categoria]}</span>
        <h4 className="min-w-0 flex-1 text-sm font-medium text-foreground">{s.titulo}</h4>
        {s.status !== 'pendente' && (
          <button type="button" onClick={() => void marcar('pendente')} className="shrink-0 text-[11px] text-foreground/40 hover:text-foreground max-sm:order-last max-sm:min-h-8 max-sm:w-full max-sm:text-right">
            {s.status === 'aceita' ? 'aceita' : 'ignorada'} · desfazer
          </button>
        )}
      </div>
      {s.detalhe && <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground/80">{s.detalhe}</p>}
      {s.dado && <p className="mt-1.5 text-xs text-foreground/45">Dado: {s.dado}</p>}

      {s.aplicada && (
        <p className="mt-2 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          Aplicado no Meta por {s.aplicada.por} em {new Date(s.aplicada.em).toLocaleString('pt-BR')}: {s.aplicada.titulo}.
          {admin && inversa && (
            <button type="button" onClick={() => setConfirmar({ acao: inversa, reversao: true })} className="ml-2 font-medium underline max-sm:inline-block max-sm:py-1">Reverter</button>
          )}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s.acao && !s.aplicada && (admin ? (
          <button type="button" onClick={() => setConfirmar({ acao: s.acao as AcaoMeta, reversao: false })}
            className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 max-sm:py-2">
            <Zap className="h-3 w-3" />{rotuloAcao(s.acao)}
          </button>
        ) : (
          <span className="text-[11px] text-foreground/40" title="Só administrador aplica mudanças no Meta">Ação no Meta: só administrador</span>
        ))}
        {s.status === 'pendente' && (
          <>
            <button type="button" onClick={() => void marcar('aceita')} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20 max-sm:py-2"><Check className="h-3 w-3" />Aceitar</button>
            <button type="button" onClick={() => void marcar('ignorada')} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-foreground/50 hover:bg-elevate/[0.06] max-sm:py-2"><X className="h-3 w-3" />Ignorar</button>
          </>
        )}
        <button type="button" onClick={() => setConversando((v) => !v)}
          className={cn('ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:bg-elevate/[0.06] max-sm:py-2', conversando ? 'bg-elevate/[0.06] text-foreground' : 'text-foreground/60')}>
          <MessageCircle className="h-3 w-3" />Conversar com a IA
        </button>
      </div>
      {s.status === 'pendente' && s.acao && (
        <p className="mt-1.5 text-[11px] text-foreground/35">“Aceitar” e “Ignorar” só registram sua decisão. Só “{rotuloAcao(s.acao)}” altera o Meta, e antes mostra tudo para você confirmar.</p>
      )}

      {conversando && <ChatSugestao dia={dia} sugestaoId={s.id} />}
      <ConfirmarAcaoModal
        acao={confirmar?.acao ?? null}
        reversao={confirmar?.reversao}
        sugestao={{ dia, id: s.id }}
        onClose={() => setConfirmar(null)}
        onAplicada={onMudou}
      />
    </div>
  )
}

/** Alertas abertos (com "Resolver"), os últimos resolvidos e o histórico da varredura da IA. */
export function AlertasTab({ versao }: { versao: number }) {
  const { profile } = useAuth()
  const admin = profile?.role === 'admin'
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
              <li key={a.id} className="flex items-start gap-3 rounded-lg border border-line p-2.5 max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1">
                <span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', NIVEL[a.level].classe)}>{NIVEL[a.level].rotulo}</span>
                <div className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full">
                  <p className="text-sm text-foreground">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-foreground/35">{new Date(a.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <button type="button" onClick={() => void resolver(a.id)}
                  className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 max-sm:ml-auto max-sm:py-2">Resolver</button>
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
              className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs font-medium text-foreground/60 hover:bg-elevate/[0.04] disabled:opacity-50 max-sm:py-2">
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
              <div key={r.dia} className="rounded-lg border border-line p-3 max-sm:rounded-none max-sm:border-0 max-sm:p-0">
                <p className="text-xs font-medium text-foreground/50">{r.dia.split('-').reverse().join('/')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">{r.texto}</p>
                <div className="mt-2 space-y-2">
                  {r.sugestoes.map((s) => <CartaoSugestao key={s.id} dia={r.dia} s={s} onMudou={ia.recarregar} admin={admin} />)}
                </div>
              </div>
            ))}
          </div>
        </Painel>
      </Estado>
    </div>
  )
}
