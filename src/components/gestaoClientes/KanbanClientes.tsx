import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { PastilhaSaude } from '@/components/gestaoClientes/Semaforo'
import { PRIORIDADES, progressoDoCliente, type GcClienteLista, type GcPrioridade } from '@/services/gestaoClientes'
import { DIAS_AVISO_RENOVACAO, type Saude } from '@/lib/gcSaude'
import { cn } from '@/lib/utils'

export interface ColunaKanban {
  /** Id do modelo da etapa, ou 'fim' pra "jornada concluída". */
  id: string
  nome: string
}

const ESTILO_PRIORIDADE: Record<GcPrioridade, string> = {
  alta: 'border-danger/30 bg-danger/10 text-danger',
  media: 'border-line bg-elevate/[0.04] text-foreground/55',
  baixa: 'border-line text-foreground/40',
}

/** Em que coluna o cliente está: o modelo da etapa atual, ou o fim se a jornada acabou. */
function colunaDo(c: GcClienteLista, colunas: ColunaKanban[]): string | null {
  if (!c.etapa_atual) return 'fim'
  if (c.etapa_atual_modelo_id && colunas.some((x) => x.id === c.etapa_atual_modelo_id)) {
    return c.etapa_atual_modelo_id
  }
  // Etapa cujo modelo foi desativado/removido: acha pelo nome, que a jornada do cliente copia.
  return colunas.find((x) => x.nome === c.etapa_atual)?.id ?? null
}

function diasAteData(data: string | null): number | null {
  if (!data) return null
  const quando = new Date(`${String(data).slice(0, 10)}T12:00:00`).getTime()
  return Number.isNaN(quando) ? null : Math.round((quando - Date.now()) / 86400000)
}

/**
 * Kanban por etapa da jornada: uma coluna por etapa, o cliente no card da etapa em que está.
 *
 * Arrastar o card pra outra coluna MOVE o cliente de etapa — e isso mexe no checklist (pra frente,
 * conclui as etapas que ficam pra trás; pra trás, reabre e desmarca). Por isso arrastar não executa
 * nada direto: pede a prévia ao servidor e a página mostra uma janela de confirmação com o que vai
 * acontecer.
 *
 * Arrastar não funciona em tela de toque, então todo card também tem um seletor "mover pra…", que
 * passa pela mesma confirmação.
 */
export function KanbanClientes({
  itens,
  colunas,
  onAbrir,
  onMover,
}: {
  itens: { cliente: GcClienteLista; saude: Saude }[]
  colunas: ColunaKanban[]
  onAbrir: (id: string) => void
  onMover: (cliente: GcClienteLista, destinoId: string) => void
}) {
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [sobre, setSobre] = React.useState<string | null>(null)

  const todas: ColunaKanban[] = [...colunas, { id: 'fim', nome: 'Jornada concluída' }]
  const porColuna = new Map<string, { cliente: GcClienteLista; saude: Saude }[]>()
  for (const col of todas) porColuna.set(col.id, [])
  const sem: { cliente: GcClienteLista; saude: Saude }[] = []
  for (const item of itens) {
    const alvo = colunaDo(item.cliente, colunas)
    if (alvo && porColuna.has(alvo)) porColuna.get(alvo)!.push(item)
    else sem.push(item)
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
      <div className="flex gap-3">
        {todas.map((col) => {
          const doGrupo = porColuna.get(col.id) ?? []
          const ativa = sobre === col.id && arrastando !== null
          return (
            <section
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                if (sobre !== col.id) setSobre(col.id)
              }}
              onDragLeave={() => setSobre((atual) => (atual === col.id ? null : atual))}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain') || arrastando
                setSobre(null)
                setArrastando(null)
                const cliente = itens.find((x) => x.cliente.id === id)?.cliente
                if (cliente) onMover(cliente, col.id)
              }}
              className={cn(
                'flex w-[270px] shrink-0 flex-col rounded-xl border bg-elevate/[0.02] transition-colors',
                ativa ? 'border-accent/60 bg-accent/[0.05]' : 'border-line',
              )}
            >
              <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <h3 className="truncate text-sm font-semibold text-foreground" title={col.nome}>
                  {col.nome}
                </h3>
                <span className="rounded-full bg-elevate/[0.06] px-2 text-xs tabular-nums text-foreground/55">
                  {doGrupo.length}
                </span>
              </header>

              <div className="flex min-h-[120px] flex-col gap-2 p-2">
                {doGrupo.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-foreground/30">
                    {arrastando ? 'solte aqui' : 'nenhum cliente'}
                  </p>
                )}
                {doGrupo.map(({ cliente: c, saude }) => {
                  const renov = diasAteData(c.proxima_renovacao)
                  return (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', c.id)
                        e.dataTransfer.effectAllowed = 'move'
                        setArrastando(c.id)
                      }}
                      onDragEnd={() => {
                        setArrastando(null)
                        setSobre(null)
                      }}
                      onClick={() => onAbrir(c.id)}
                      className={cn(
                        'group cursor-pointer rounded-lg border border-line bg-surface p-2.5 transition-shadow hover:shadow-md',
                        arrastando === c.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-start gap-1.5">
                        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-foreground/25" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {c.nome_empresa}
                            {c.fora_dos_totais && (
                              <span className="ml-1.5 rounded border border-line px-1 text-[10px] font-normal uppercase text-foreground/45">
                                teste
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-foreground/45">
                            {c.responsavel_nome ?? 'sem responsável'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <PastilhaSaude estado={saude.nivel} />
                        <span
                          className={cn(
                            'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                            ESTILO_PRIORIDADE[c.prioridade ?? 'media'],
                          )}
                        >
                          {PRIORIDADES.find((p) => p.valor === (c.prioridade ?? 'media'))?.label}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-elevate/[0.08]">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${progressoDoCliente(c)}%` }}
                          />
                        </span>
                        <span className="text-[10px] tabular-nums text-foreground/45">
                          {progressoDoCliente(c)}%
                        </span>
                      </div>

                      {(Number(c.itens_atrasados) > 0 || (renov !== null && renov <= DIAS_AVISO_RENOVACAO)) && (
                        <p className="mt-1.5 text-[11px] text-danger">
                          {Number(c.itens_atrasados) > 0 && `${Number(c.itens_atrasados)} atrasado(s)`}
                          {Number(c.itens_atrasados) > 0 && renov !== null && renov <= DIAS_AVISO_RENOVACAO && ' · '}
                          {renov !== null && renov <= DIAS_AVISO_RENOVACAO &&
                            (renov < 0 ? `renovação venceu há ${Math.abs(renov)}d` : `renova em ${renov}d`)}
                        </p>
                      )}

                      {/* Alternativa ao arrastar, pra tela de toque. Mesma confirmação. */}
                      <select
                        value=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          if (e.target.value) onMover(c, e.target.value)
                        }}
                        className="mt-2 h-6 w-full rounded border border-line bg-transparent px-1 text-[11px] text-foreground/45 outline-none focus:border-accent/60"
                        aria-label="Mover pra outra etapa"
                      >
                        <option value="">mover pra…</option>
                        {todas
                          .filter((x) => x.id !== col.id)
                          .map((x) => (
                            <option key={x.id} value={x.id} className="bg-surface text-foreground">
                              {x.nome}
                            </option>
                          ))}
                      </select>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {sem.length > 0 && (
        <p className="mt-2 text-xs text-foreground/45">
          {sem.length} cliente(s) com etapa que não bate com nenhuma coluna:{' '}
          {sem.map((x) => x.cliente.nome_empresa).join(', ')} — aparecem na tabela.
        </p>
      )}
    </div>
  )
}
