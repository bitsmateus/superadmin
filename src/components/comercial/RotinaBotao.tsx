import * as React from 'react'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, ListChecks, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import {
  VISUAL_DO_TIPO, rotinaService, type BlocoBase, type BlocoDoDia, type RotinaDeHoje, type SemanaDaRotina, type TipoDeBloco,
} from '@/services/rotina'
import { cn } from '@/lib/utils'

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Botão "Rotina" no topo do CRM ARTHUR / CRM LUIS CLOSER (server/src/routes/rotina.ts). Pro dono do CRM, abre o
 * checklist de hoje (cada bloco: feito ou não). Pro admin, a semana do dono (o que ele marcou), as folgas e a edição dos
 * blocos. Pra mais ninguém aparece.
 */
export function BotaoRotina({ pagina }: { pagina: string }) {
  const [hoje, setHoje] = React.useState<RotinaDeHoje>({ tem: false })
  const [aberto, setAberto] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try { setHoje(await rotinaService.hoje(pagina)) } catch { /* sem rede: o botão só não aparece */ }
  }, [pagina])
  React.useEffect(() => { void carregar() }, [carregar])

  if (!hoje.tem) return null
  const doDia = hoje.dia_util && !hoje.folga
  const feitos = hoje.blocos.filter((b) => b.estado === 'feito').length

  return (
    <>
      <Button variant="secondary" size="sm" leftIcon={<ListChecks className="h-4 w-4" />} onClick={() => setAberto(true)}>
        Rotina{!hoje.somente_leitura && doDia && hoje.blocos.length ? ` ${feitos}/${hoje.blocos.length}` : ''}
      </Button>
      {aberto && (hoje.somente_leitura
        ? <RotinaDoAdmin pagina={hoje.pagina} onClose={() => setAberto(false)} />
        : <ChecklistDeHoje rotina={hoje} mudou={setHoje} onClose={() => { setAberto(false); void carregar() }} />)}
    </>
  )
}

function ChecklistDeHoje({ rotina, mudou, onClose }: {
  rotina: Extract<RotinaDeHoje, { tem: true }>; mudou: (r: RotinaDeHoje) => void; onClose: () => void
}) {
  const [salvando, setSalvando] = React.useState<string | null>(null)
  const doDia = rotina.dia_util && !rotina.folga
  const feitos = rotina.blocos.filter((b) => b.estado === 'feito').length

  const alternar = async (b: BlocoDoDia) => {
    const feito = b.estado !== 'feito'
    setSalvando(b.id)
    try {
      await rotinaService.marcar(b.id, feito)
      mudou(await rotinaService.hoje(rotina.pagina))
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra marcar.')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Rotina de hoje"
      description={doDia ? `${feitos} de ${rotina.blocos.length} feitos` : rotina.folga ? 'Hoje está como folga.' : 'Hoje não tem rotina (fim de semana).'}
    >
      {doDia && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {rotina.blocos.map((b) => {
            const feito = b.estado === 'feito'
            return (
              <li key={b.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={feito}
                  disabled={salvando === b.id}
                  onClick={() => void alternar(b)}
                  className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-elevate/[0.04] disabled:opacity-60', b.estado === 'agora' && 'bg-accent/[0.06]')}
                >
                  <span className={cn(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border',
                    feito ? 'border-success bg-success text-white' : 'border-line',
                  )}>
                    {salvando === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : feito && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className={cn('mt-0.5 h-4 w-1 shrink-0 rounded-full', VISUAL_DO_TIPO[b.tipo].barra)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="shrink-0 text-xs tabular-nums text-foreground/55">{b.inicio}–{b.fim}</span>
                      <span className={cn('text-sm font-medium text-foreground', feito && 'text-foreground/50 line-through')}>{b.titulo}</span>
                      {b.estado === 'agora' && <span className="text-[10px] font-semibold uppercase text-accent">agora</span>}
                    </span>
                    {b.itens.length > 0 && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-foreground/55">{b.itens.join(' · ')}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

function RotinaDoAdmin({ pagina, onClose }: { pagina: string; onClose: () => void }) {
  const [aba, setAba] = React.useState<'semana' | 'editar'>('semana')
  const [semana, setSemana] = React.useState<string | undefined>()
  const [dados, setDados] = React.useState<SemanaDaRotina | null>(null)
  const [erro, setErro] = React.useState('')

  const carregar = React.useCallback(async () => {
    try {
      setDados(await rotinaService.semana(pagina, semana))
      setErro('')
    } catch (err) {
      setErro((err as Error).message || 'Não deu pra carregar a rotina.')
    }
  }, [pagina, semana])
  React.useEffect(() => { void carregar() }, [carregar])

  return (
    <Modal open onClose={onClose} size="2xl" title="Rotina" description={dados?.dono ? `Quem marca: ${dados.dono}. Segunda a sexta.` : undefined}>
      <Tabs value={aba} onChange={(v) => setAba(v as 'semana' | 'editar')} items={[{ value: 'semana', label: 'Semana' }, { value: 'editar', label: 'Editar blocos' }]} />
      <div className="pt-4">
        {erro ? (
          <p className="text-sm text-danger">{erro}</p>
        ) : !dados ? (
          <div className="grid min-h-[20vh] place-items-center text-foreground/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : aba === 'semana' ? (
          <Semana dados={dados} mudarSemana={(n) => setSemana(somarDias(dados.dias[0].data, n * 7))} recarregar={carregar} />
        ) : (
          <EditarBlocos pagina={dados.pagina} blocos={dados.blocos} salvo={() => { void carregar(); setAba('semana') }} />
        )}
      </div>
    </Modal>
  )
}

function Semana({ dados, mudarSemana, recarregar }: { dados: SemanaDaRotina; mudarSemana: (n: number) => void; recarregar: () => Promise<void> }) {
  const [mudandoFolga, setMudandoFolga] = React.useState<string | null>(null)
  const celulas = dados.blocos.flatMap((b) => b.dias)
  const feitos = celulas.filter((c) => c.estado === 'feito').length
  const contam = feitos + celulas.filter((c) => c.estado === 'nao_feito').length

  const alternarFolga = async (data: string, folga: boolean) => {
    setMudandoFolga(data)
    try {
      await rotinaService.folga(dados.pagina, data, folga)
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra mudar a folga.')
    } finally {
      setMudandoFolga(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => mudarSemana(-1)} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="text-sm font-medium tabular-nums text-foreground">{ddmm(dados.dias[0].data)} a {ddmm(dados.dias[4].data)}</span>
          <Button variant="ghost" size="sm" onClick={() => mudarSemana(1)} aria-label="Próxima semana"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="text-sm text-foreground/70">
          <span className="text-base font-semibold text-foreground">{contam ? `${Math.round((feitos / contam) * 100)}%` : '—'}</span>
          {' '}feito · {feitos} de {contam} blocos
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[640px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-line bg-elevate/[0.03]">
              <th className="px-3 py-2 text-left font-medium text-foreground/60">Bloco</th>
              {dados.dias.map((d, i) => (
                <th key={d.data} className={cn('px-2 py-2 text-center font-medium text-foreground/60', d.data === dados.hoje && 'text-accent')}>
                  <div>{DIAS[i]} {ddmm(d.data)}</div>
                  <button
                    type="button"
                    disabled={mudandoFolga === d.data}
                    onClick={() => void alternarFolga(d.data, !d.folga)}
                    className={cn('mt-0.5 rounded px-1.5 text-[10px] font-normal', d.folga ? 'bg-foreground/10 text-foreground' : 'text-foreground/40 hover:text-foreground')}
                  >
                    {d.folga ? 'Folga · tirar' : 'Marcar folga'}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dados.blocos.map((b) => (
              <tr key={b.id} className="border-b border-line last:border-0">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-5 w-1 shrink-0 rounded-full', VISUAL_DO_TIPO[b.tipo].barra)} />
                    <span className="w-[74px] shrink-0 tabular-nums text-foreground/55">{b.inicio}–{b.fim}</span>
                    <span className="truncate text-foreground">{b.titulo}</span>
                  </div>
                </td>
                {b.dias.map((d) => (
                  <td key={d.data} className="px-2 py-1.5 text-center">
                    <span
                      title={d.estado === 'feito' ? `Feito às ${d.feito_em?.slice(11, 16)}` : d.estado === 'nao_feito' ? 'Não marcado' : d.estado === 'folga' ? 'Folga' : ''}
                      className={cn(
                        'mx-auto grid h-6 w-10 place-items-center rounded text-[11px] font-bold',
                        d.estado === 'feito' && 'bg-success text-white',
                        d.estado === 'nao_feito' && 'bg-danger/15 text-danger',
                        d.estado === 'folga' && 'bg-foreground/10',
                        (d.estado === 'futuro' || d.estado === 'agora') && 'border border-dashed border-line',
                      )}
                    >
                      {d.estado === 'feito' ? '✓' : d.estado === 'nao_feito' ? '✕' : ''}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type Rascunho = Omit<BlocoBase, 'id' | 'itens'> & { id?: string; chave: string; itens: string }
const novoRascunho = (b?: BlocoBase): Rascunho => ({
  id: b?.id, chave: b?.id ?? crypto.randomUUID(), inicio: b?.inicio ?? '', fim: b?.fim ?? '', titulo: b?.titulo ?? '',
  tipo: b?.tipo ?? 'tarefa', itens: (b?.itens ?? []).join('\n'),
})
const campo = 'rounded-md border border-line bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-accent/60'

function EditarBlocos({ pagina, blocos, salvo }: { pagina: string; blocos: BlocoBase[]; salvo: () => void }) {
  const [lista, setLista] = React.useState<Rascunho[]>(() => blocos.map(novoRascunho))
  const [salvando, setSalvando] = React.useState(false)
  const mudar = (chave: string, patch: Partial<Rascunho>) => setLista((l) => l.map((b) => (b.chave === chave ? { ...b, ...patch } : b)))

  const salvar = async () => {
    setSalvando(true)
    try {
      await rotinaService.salvarBlocos(pagina, lista.map((b) => ({
        id: b.id, inicio: b.inicio, fim: b.fim, titulo: b.titulo, tipo: b.tipo,
        itens: b.itens.split('\n').map((t) => t.trim()).filter(Boolean),
      })))
      toast.success('Rotina salva. Vale a partir de agora.')
      salvo()
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra salvar a rotina.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-foreground/55">Um item por linha. As marcações antigas continuam guardadas.</p>
      <div className="space-y-2">
        {lista.map((b) => (
          <div key={b.chave} className="grid grid-cols-[auto_auto_1fr_auto] items-start gap-2 rounded-lg border border-line p-2 sm:grid-cols-[auto_auto_auto_1fr_auto]">
            <input type="time" value={b.inicio} onChange={(e) => mudar(b.chave, { inicio: e.target.value })} className={campo} aria-label="Início" />
            <input type="time" value={b.fim} onChange={(e) => mudar(b.chave, { fim: e.target.value })} className={campo} aria-label="Fim" />
            <select value={b.tipo} onChange={(e) => mudar(b.chave, { tipo: e.target.value as TipoDeBloco })} className={cn(campo, 'col-span-2 sm:col-span-1')} aria-label="Tipo">
              {(Object.keys(VISUAL_DO_TIPO) as TipoDeBloco[]).map((t) => <option key={t} value={t}>{VISUAL_DO_TIPO[t].nome}</option>)}
            </select>
            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <input value={b.titulo} onChange={(e) => mudar(b.chave, { titulo: e.target.value })} placeholder="Título" className={cn(campo, 'w-full font-medium')} />
              <textarea value={b.itens} onChange={(e) => mudar(b.chave, { itens: e.target.value })} rows={Math.max(1, b.itens.split('\n').length)} placeholder="O que fazer (um por linha)" className={cn(campo, 'w-full resize-y')} />
            </div>
            <button type="button" onClick={() => setLista((l) => l.filter((x) => x.chave !== b.chave))} className="rounded p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger" aria-label="Remover bloco">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setLista((l) => [...l, novoRascunho()])}>
          Adicionar bloco
        </Button>
        <Button size="sm" loading={salvando} onClick={() => void salvar()}>Salvar rotina</Button>
      </div>
    </div>
  )
}
