import * as React from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  ETAPAS_SOCIAL,
  gestaoClientes,
  type GcChecklistSocialCliente,
  type GcEtapaSocial,
} from '@/services/gestaoClientes'
import { cn } from '@/lib/utils'

/** Quantas das 5 etapas estão feitas. */
export const etapasFeitas = (l: GcChecklistSocialCliente) => ETAPAS_SOCIAL.filter((e) => l.etapas[e.valor].feito).length

/** A primeira etapa que ainda falta (na ordem), ou null quando o mês está fechado. */
export const proximaEtapa = (l: GcChecklistSocialCliente) => ETAPAS_SOCIAL.find((e) => !l.etapas[e.valor].feito) ?? null

/** Uma frase curta do que as artes do mês dizem: "6 artes · 4 aprovadas · 2 agendadas". */
export function resumoDasArtes(l: GcChecklistSocialCliente): string {
  const a = l.artes
  if (a.total === 0) return 'Nenhuma arte no Social media neste mês'
  const partes = [`${a.total} arte${a.total === 1 ? '' : 's'}`]
  const comCliente = a.com_cliente
  const aprovadas = a.aprovado + a.trafego
  if (a.para_producao + a.em_producao + a.revisao > 0) partes.push(`${a.para_producao + a.em_producao + a.revisao} em criação`)
  if (comCliente > 0) partes.push(`${comCliente} com o cliente`)
  if (aprovadas > 0) partes.push(`${aprovadas} aprovada${aprovadas === 1 ? '' : 's'}`)
  if (a.agendadas > 0) partes.push(`${a.agendadas} agendada${a.agendadas === 1 ? '' : 's'}`)
  if (a.publicadas > 0) partes.push(`${a.publicadas} publicada${a.publicadas === 1 ? '' : 's'}`)
  return partes.join(' · ')
}

function dataCurta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/** Hook pra marcar/desmarcar uma etapa e devolver a linha atualizada pro pai. */
export function useSalvarEtapa(mes: string, onSalvo: (l: GcChecklistSocialCliente) => void) {
  const [salvando, setSalvando] = React.useState<string | null>(null)
  const salvar = async (
    clienteId: string,
    etapa: GcEtapaSocial,
    dados: { feito?: boolean; data?: string | null; obs?: string },
  ) => {
    setSalvando(`${clienteId}:${etapa}`)
    try {
      const l = await gestaoClientes.salvarEtapaSocial(clienteId, mes, etapa, dados)
      onSalvo(l)
      if (dados.feito === true && etapa === 'reuniao') toast.success('Reunião marcada e registrada no histórico do cliente')
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(null)
    }
  }
  return { salvar, salvando }
}

/**
 * A caixinha de uma etapa. Feita pelo Social media = verde com faísca, e não dá pra desmarcar à mão
 * (quem manda é o andamento das artes). Feita à mão = verde normal, clica pra desmarcar.
 */
export function CaixaDaEtapa({
  linha, etapa, salvando, onToggle, tamanho = 'md',
}: {
  linha: GcChecklistSocialCliente
  etapa: GcEtapaSocial
  salvando: boolean
  onToggle: () => void
  tamanho?: 'sm' | 'md'
}) {
  const e = linha.etapas[etapa]
  const def = ETAPAS_SOCIAL.find((x) => x.valor === etapa)!
  const travada = e.auto
  const titulo = e.auto
    ? `${def.ajuda}\nFeito automático: ${def.auto}`
    : e.manual
      ? `${def.ajuda}\nMarcado${e.feito_por_nome ? ` por ${e.feito_por_nome}` : ''}${e.feito_em ? ` em ${dataCurta(e.feito_em)}` : ''} — clique pra desmarcar`
      : `${def.ajuda}\nClique pra marcar como feito${def.auto ? ` (ou ${def.auto})` : ''}`
  return (
    <button
      type="button"
      title={titulo}
      aria-label={`${def.label}: ${e.feito ? 'feito' : 'pendente'}`}
      aria-pressed={e.feito}
      disabled={salvando || travada}
      onClick={onToggle}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-lg border transition-colors',
        tamanho === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
        e.feito ? 'border-success bg-success text-white' : 'border-line bg-surface text-transparent hover:border-success/60 hover:text-success/40',
        travada && 'cursor-default',
      )}
    >
      {salvando ? <Loader2 className="h-4 w-4 animate-spin text-foreground/50" /> : <Check className="h-4 w-4" strokeWidth={3} />}
      {e.auto && (
        <Sparkles className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full bg-surface p-[1px] text-accent" />
      )}
    </button>
  )
}

/** Barrinha de progresso das 5 etapas. */
export function BarraDoMes({ linha }: { linha: GcChecklistSocialCliente }) {
  const feitas = etapasFeitas(linha)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-full min-w-[60px] overflow-hidden rounded-full bg-foreground/10">
        <div
          className={cn('h-full rounded-full transition-all', feitas === 5 ? 'bg-success' : 'bg-accent')}
          style={{ width: `${(feitas / 5) * 100}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-foreground/60">{feitas}/5</span>
    </div>
  )
}

/**
 * O checklist do mês de UM cliente, em lista (com a data da reunião e observação por etapa).
 * Serve no detalhe da aba Demandas social e no Social media do cliente.
 */
export function EtapasDoMes({
  linha, mes, onSalvo,
}: {
  linha: GcChecklistSocialCliente
  mes: string
  onSalvo: (l: GcChecklistSocialCliente) => void
}) {
  const { salvar, salvando } = useSalvarEtapa(mes, onSalvo)
  return (
    <ol className="space-y-1.5">
      {ETAPAS_SOCIAL.map((def, i) => {
        const e = linha.etapas[def.valor]
        return (
          <li key={def.valor} className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2">
            <CaixaDaEtapa
              linha={linha}
              etapa={def.valor}
              salvando={salvando === `${linha.id}:${def.valor}`}
              onToggle={() => void salvar(linha.id, def.valor, { feito: !e.manual })}
            />
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-medium', e.feito ? 'text-foreground/55 line-through decoration-foreground/30' : 'text-foreground')}>
                {i + 1}. {def.ajuda}
              </p>
              <p className="text-xs text-foreground/50">
                {e.auto ? (
                  <span className="inline-flex items-center gap-1 text-accent"><Sparkles className="h-3 w-3" /> Feito automático pelo Social media</span>
                ) : e.manual ? (
                  `Feito${e.feito_por_nome ? ` por ${e.feito_por_nome}` : ''}${e.feito_em ? ` em ${dataCurta(e.feito_em)}` : ''}`
                ) : def.auto ? (
                  `Pendente — ${def.auto}`
                ) : (
                  'Pendente — marque quando a reunião acontecer'
                )}
              </p>
            </div>
            {def.valor === 'reuniao' && (
              <label className="flex items-center gap-1.5 text-xs text-foreground/55">
                Data
                <input
                  key={`data:${e.data ?? ''}`}
                  type="date"
                  defaultValue={e.data ?? ''}
                  onBlur={(ev) => {
                    const v = ev.target.value || null
                    if (v !== (e.data ?? null)) void salvar(linha.id, 'reuniao', { data: v })
                  }}
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
                />
              </label>
            )}
            <input
              key={`${def.valor}:${e.obs}`}
              defaultValue={e.obs}
              placeholder="Observação…"
              onBlur={(ev) => {
                const v = ev.target.value.trim()
                if (v !== e.obs) void salvar(linha.id, def.valor, { obs: v })
              }}
              className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-xs text-foreground outline-none placeholder:text-foreground/35 focus:border-accent sm:w-56"
            />
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Faixa compacta do checklist do mês, pra ficar dentro do Social media do cliente. `versao` muda quando as
 * artes mudam (mover de etapa, enviar pro cliente, agendar) e faz a faixa buscar de novo — é assim que
 * ela se atualiza sozinha.
 */
export function ChecklistSocialDoCliente({ clienteId, mes, versao }: { clienteId: string; mes: string; versao: string }) {
  const [linha, setLinha] = React.useState<GcChecklistSocialCliente | null>(null)
  const [aberto, setAberto] = React.useState(false)
  const { salvar, salvando } = useSalvarEtapa(mes, setLinha)

  React.useEffect(() => {
    let vivo = true
    gestaoClientes
      .checklistSocial(mes, clienteId)
      .then((l) => { if (vivo) setLinha(l[0] ?? null) })
      .catch(() => undefined)
    return () => { vivo = false }
  }, [clienteId, mes, versao])

  if (!linha) return null
  const prox = proximaEtapa(linha)
  return (
    <section className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={() => setAberto((a) => !a)} className="text-left">
          <span className="block text-sm font-semibold text-foreground">Demandas do mês</span>
          <span className="block text-xs text-foreground/50">
            {prox ? `Próxima: ${prox.ajuda}` : 'Mês fechado — todas as etapas feitas'} · {aberto ? 'esconder detalhes' : 'ver detalhes'}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {ETAPAS_SOCIAL.map((def) => (
            <span key={def.valor} className="flex items-center gap-1.5">
              <CaixaDaEtapa
                tamanho="sm"
                linha={linha}
                etapa={def.valor}
                salvando={salvando === `${linha.id}:${def.valor}`}
                onToggle={() => void salvar(linha.id, def.valor, { feito: !linha.etapas[def.valor].manual })}
              />
              <span className="text-xs text-foreground/60">{def.label}</span>
            </span>
          ))}
        </div>
        <div className="ml-auto w-28"><BarraDoMes linha={linha} /></div>
      </div>
      {aberto && (
        <div className="mt-3">
          <EtapasDoMes linha={linha} mes={mes} onSalvo={setLinha} />
        </div>
      )}
    </section>
  )
}
