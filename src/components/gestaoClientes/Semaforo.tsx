import * as React from 'react'
import {
  AlertTriangle, Check, ChevronRight, CircleDot, HelpCircle, Loader2, ShieldAlert, TrendingDown,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ROTULO_ESTADO, destinoDoSinal, type Destino, type Estado, type Saude, type Sinal,
} from '@/lib/gcSaude'
import {
  NIVEIS_AVALIACAO, gestaoClientes,
  type GcAvaliacao, type GcNivelAvaliacao,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/**
 * O semáforo de saúde do cliente, em três formatos: a pastilha (lista), o painel com todos os
 * sinais (detalhe) e o selo de risco de churn.
 *
 * As cores seguem os tokens do painel (success/warning/danger/accent) e NUNCA aparecem sozinhas:
 * toda pastilha leva ícone e texto. Quem não distingue verde de vermelho continua lendo a tela.
 */

const ESTILO: Record<Estado, { chip: string; ponto: string; icone: React.ElementType }> = {
  otimo: {
    chip: 'border-success/25 bg-success/10 text-success',
    ponto: 'bg-success',
    icone: Check,
  },
  bom: {
    chip: 'border-accent/25 bg-accent/10 text-accent',
    ponto: 'bg-accent',
    icone: CircleDot,
  },
  atencao: {
    chip: 'border-warning/25 bg-warning/10 text-warning',
    ponto: 'bg-warning',
    icone: AlertTriangle,
  },
  risco: {
    chip: 'border-danger/25 bg-danger/10 text-danger',
    ponto: 'bg-danger',
    icone: ShieldAlert,
  },
  neutro: {
    chip: 'border-line bg-elevate/[0.04] text-foreground/55',
    ponto: 'bg-foreground/30',
    icone: HelpCircle,
  },
}

/** Pastilha compacta — cabe numa coluna de tabela. */
export function PastilhaSaude({
  estado,
  texto,
  className,
}: {
  estado: Estado
  texto?: string
  className?: string
}) {
  const { chip, icone: Icone } = ESTILO[estado]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        chip,
        className,
      )}
    >
      <Icone className="h-3 w-3" />
      {texto ?? ROTULO_ESTADO[estado]}
    </span>
  )
}

/** Barra de três faixas que mostra, de relance, quantos sinais estão em cada estado. */
export function FaixaDeSinais({ saude }: { saude: Saude }) {
  const total = saude.sinais.length || 1
  const ordem: Estado[] = ['otimo', 'bom', 'atencao', 'risco', 'neutro']
  const fatias = ordem
    .map((estado) => ({ estado, qtd: saude.contagem[estado] }))
    .filter((f) => f.qtd > 0)
  return (
    <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-elevate/[0.08]">
      {fatias.map((f) => (
        <span
          key={f.estado}
          className={ESTILO[f.estado].ponto}
          style={{ width: `${(f.qtd / total) * 100}%` }}
          title={`${f.qtd} ${ROTULO_ESTADO[f.estado].toLowerCase()}`}
        />
      ))}
    </span>
  )
}

const CORES_NOTA: Record<GcNivelAvaliacao, string> = {
  otimo: 'border-success/40 bg-success/15 text-success',
  bom: 'border-accent/40 bg-accent/15 text-accent',
  regular: 'border-warning/40 bg-warning/15 text-warning',
  ruim: 'border-danger/40 bg-danger/15 text-danger',
}

/**
 * A nota que VOCÊ dá pro resultado do mês.
 *
 * O semáforo automático só enxerga número e prazo. Quem acompanha o cliente sabe coisas que não
 * estão em lugar nenhum: que ele sumiu, que o resultado veio mas não era o combinado, que o mês
 * foi ruim por um motivo já resolvido. Esta nota é esse julgamento, e ela PUXA o semáforo pra
 * baixo quando é pior que o automático — marcar "ótimo" não apaga um prazo vencido.
 *
 * É por mês: dizer "esse cliente está ruim" sem dizer quando apagaria a história de quem estava
 * mal em agosto e virou o jogo em outubro.
 */
export function AvaliacaoDoResultado({
  clienteId,
  avaliacao,
  periodoRotulo,
  onMudou,
}: {
  clienteId: string
  avaliacao: GcAvaliacao | null
  /** "Outubro de 2026" — deixa claro que a nota é daquele mês, não do cliente pra sempre. */
  periodoRotulo: string
  onMudou: () => Promise<void> | void
}) {
  const [comentario, setComentario] = React.useState(avaliacao?.comentario ?? '')
  const [salvando, setSalvando] = React.useState<GcNivelAvaliacao | null>(null)
  const [escrevendo, setEscrevendo] = React.useState(false)

  // Trocar de cliente (ou recarregar depois de salvar) tem que trazer o comentário do servidor.
  React.useEffect(() => {
    setComentario(avaliacao?.comentario ?? '')
    setEscrevendo(false)
  }, [avaliacao?.comentario, avaliacao?.periodo_inicio, clienteId])

  const salvar = async (nivel: GcNivelAvaliacao, texto = comentario) => {
    setSalvando(nivel)
    try {
      await gestaoClientes.avaliar(clienteId, { nivel, comentario: texto })
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar a avaliação: ' + (err as Error).message)
    } finally {
      setSalvando(null)
    }
  }

  const limpar = async () => {
    try {
      await gestaoClientes.limparAvaliacao(clienteId)
      await onMudou()
    } catch (err) {
      toast.error('Falha ao limpar: ' + (err as Error).message)
    }
  }

  return (
    <div id="gc-avaliacao" className="rounded-xl border border-line bg-elevate/[0.02] p-3 transition-shadow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Como está o resultado?</p>
          <p className="text-xs text-foreground/50">
            Sua avaliação de {periodoRotulo.toLowerCase()} — é ela que manda no semáforo
          </p>
        </div>
        {avaliacao?.atualizado_em && (
          <p className="text-xs text-foreground/40">
            {avaliacao.autor_nome ? `${avaliacao.autor_nome} · ` : ''}
            {new Date(avaliacao.atualizado_em).toLocaleDateString('pt-BR')}
          </p>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {NIVEIS_AVALIACAO.map((n) => {
          const escolhido = avaliacao?.nivel === n.valor
          return (
            <button
              key={n.valor}
              type="button"
              title={n.ajuda}
              disabled={salvando !== null}
              onClick={() => void salvar(n.valor)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                escolhido
                  ? CORES_NOTA[n.valor]
                  : 'border-line text-foreground/55 hover:border-foreground/25 hover:text-foreground',
              )}
            >
              {salvando === n.valor && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {n.label}
            </button>
          )
        })}
        {avaliacao && (
          <button type="button" onClick={() => void limpar()} className="px-2 text-xs text-foreground/40 hover:text-danger">
            limpar
          </button>
        )}
      </div>

      {avaliacao && (escrevendo || avaliacao.comentario) && (
        <textarea
          rows={2}
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          onFocus={() => setEscrevendo(true)}
          onBlur={() => {
            // Salva ao sair do campo: um botão "salvar comentário" só pra isso seria um clique a
            // mais em algo que a pessoa já terminou de escrever.
            if (comentario !== (avaliacao.comentario ?? '')) void salvar(avaliacao.nivel, comentario)
          }}
          placeholder="Por que está assim? (fica junto da avaliação e no histórico do cliente)"
          className="mt-2.5 w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:border-accent/60"
        />
      )}
      {avaliacao && !escrevendo && !avaliacao.comentario && (
        <button
          type="button"
          onClick={() => setEscrevendo(true)}
          className="mt-2 text-xs text-foreground/45 hover:text-accent"
        >
          + escrever o porquê
        </button>
      )}
    </div>
  )
}

/**
 * Uma linha do semáforo. Quando a tela sabe pra onde levar, a linha inteira é clicável e mostra
 * "ir pra…" ao passar o mouse: ver "Nenhum relatório publicado" e ter que adivinhar em qual aba
 * se publica é exatamente o atrito que o painel existe pra tirar.
 */
function LinhaSinal({ sinal, onIr }: { sinal: Sinal; onIr?: (d: Destino) => void }) {
  const { ponto, icone: Icone } = ESTILO[sinal.estado]
  const alvo = onIr ? destinoDoSinal(sinal.chave) : null

  const conteudo = (
    <>
      <span
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white',
          ponto,
        )}
      >
        <Icone className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">{sinal.titulo}</span>
        <span className="block text-xs text-foreground/60">{sinal.detalhe}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        {alvo && (
          <span className="hidden items-center gap-0.5 text-xs text-accent opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
            {alvo.rotulo} <ChevronRight className="h-3 w-3" />
          </span>
        )}
        <PastilhaSaude estado={sinal.estado} />
      </span>
    </>
  )

  if (!alvo || !onIr) {
    return <li className="flex items-start gap-3 border-b border-line py-2 last:border-b-0">{conteudo}</li>
  }
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onIr(alvo.destino)}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-elevate/[0.04]"
      >
        {conteudo}
      </button>
    </li>
  )
}

/**
 * Painel com TODOS os passos — é o que a pessoa que cuida da conta abre pra saber o que fazer.
 * Os sinais ruins vêm primeiro: a tela é pra agir, não pra arquivar.
 */
export function PainelSaude({
  saude,
  children,
  onIr,
}: {
  saude: Saude
  children?: React.ReactNode
  /** Leva pra onde o sinal se resolve. Sem isso as linhas ficam só de leitura. */
  onIr?: (d: Destino) => void
}) {
  const ordem: Estado[] = ['risco', 'atencao', 'neutro', 'bom', 'otimo']
  const sinais = [...saude.sinais].sort((a, b) => ordem.indexOf(a.estado) - ordem.indexOf(b.estado))

  const tomChurn: Estado =
    saude.churn.nivel === 'alto' ? 'risco' : saude.churn.nivel === 'medio' ? 'atencao' : 'otimo'

  return (
    <section className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Como está esse cliente
        </h2>
        <div className="flex items-center gap-2">
          <PastilhaSaude estado={saude.nivel} />
          <PastilhaSaude estado={tomChurn} texto={`Risco de churn: ${saude.churn.nivel}`} />
        </div>
      </div>

      {children && <div className="mt-3">{children}</div>}

      <div className="mt-3">
        <FaixaDeSinais saude={saude} />
        <p className="mt-1.5 text-xs text-foreground/45">
          {saude.contagem.otimo} ótimo · {saude.contagem.bom} bom · {saude.contagem.atencao} atenção
          · {saude.contagem.risco} risco
          {saude.contagem.neutro > 0 ? ` · ${saude.contagem.neutro} sem dados` : ''}
        </p>
      </div>

      {saude.churn.motivos.length > 0 && (
        <div className="mt-3 rounded-lg border border-danger/20 bg-danger/[0.04] px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <TrendingDown className="h-3.5 w-3.5" /> O que puxa esse cliente pra saída
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-foreground/70">
            {saude.churn.motivos.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-3">
        {sinais.map((s) => (
          <LinhaSinal key={s.chave} sinal={s} onIr={onIr} />
        ))}
      </ul>
    </section>
  )
}
