import * as React from 'react'
import { AlertTriangle, Check, CircleDot, HelpCircle, ShieldAlert, TrendingDown } from 'lucide-react'
import { ROTULO_ESTADO, type Estado, type Saude, type Sinal } from '@/lib/gcSaude'
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

function LinhaSinal({ sinal }: { sinal: Sinal }) {
  const { ponto, icone: Icone } = ESTILO[sinal.estado]
  return (
    <li className="flex items-start gap-3 border-b border-line py-2 last:border-b-0">
      <span
        className={cn(
          'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white',
          ponto,
        )}
      >
        <Icone className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{sinal.titulo}</span>
        <span className="block text-xs text-foreground/60">{sinal.detalhe}</span>
      </span>
      <span className="shrink-0 pt-0.5">
        <PastilhaSaude estado={sinal.estado} />
      </span>
    </li>
  )
}

/**
 * Painel com TODOS os passos — é o que a pessoa que cuida da conta abre pra saber o que fazer.
 * Os sinais ruins vêm primeiro: a tela é pra agir, não pra arquivar.
 */
export function PainelSaude({ saude }: { saude: Saude }) {
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
          <LinhaSinal key={s.chave} sinal={s} />
        ))}
      </ul>
    </section>
  )
}
