import * as React from 'react'
import { toast } from 'sonner'
import { CalendarClock, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import {
  ESTADOS_ENCERRADOS, PESO_NA_ADERENCIA, VISUAL_DO_ESTADO, VISUAL_DO_TIPO, rotinaService,
  type BlocoBase, type EstadoDoBloco, type SemanaDaRotina, type TipoDeBloco,
} from '@/services/rotina'
import { cn } from '@/lib/utils'

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex']
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Botão "Rotina" do admin dentro do CRM ARTHUR / CRM LUIS CLOSER: a semana do dono da aba, folgas e os blocos. */
export function BotaoRotinaAdmin({ pagina }: { pagina: string }) {
  const [aberto, setAberto] = React.useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" leftIcon={<CalendarClock className="h-4 w-4" />} onClick={() => setAberto(true)}>
        Rotina
      </Button>
      {aberto && <RotinaAdminModal pagina={pagina} onClose={() => setAberto(false)} />}
    </>
  )
}

function RotinaAdminModal({ pagina, onClose }: { pagina: string; onClose: () => void }) {
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
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={dados ? `Rotina · ${dados.nome_da_pagina}` : 'Rotina'}
      description={dados?.dono ? `Quem marca: ${dados.dono}. Segunda a sexta.` : undefined}
    >
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
  const [sel, setSel] = React.useState<{ bloco: string; data: string } | null>(null)
  const [mudandoFolga, setMudandoFolga] = React.useState<string | null>(null)

  const celulas = dados.blocos.flatMap((b) => b.dias.map((d) => ({ bloco: b, ...d })))
  const avaliados = celulas.filter((c) => ESTADOS_ENCERRADOS.includes(c.estado) && c.estado !== 'pendente')
  const pontos = avaliados.reduce((s, c) => s + (PESO_NA_ADERENCIA[c.estado] ?? 0), 0)
  const contar = (e: EstadoDoBloco) => avaliados.filter((c) => c.estado === e).length
  const motivos = celulas
    .filter((c) => c.marcacao && c.marcacao.status !== 'feito')
    .sort((a, b) => `${a.data}${a.bloco.inicio}`.localeCompare(`${b.data}${b.bloco.inicio}`))
  const atrasados = celulas.filter((c) => c.marcacao?.atrasado).length
  const escolhida = sel && celulas.find((c) => c.bloco.id === sel.bloco && c.data === sel.data)

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
        <div className="flex flex-wrap items-center gap-4 text-xs text-foreground/70">
          <span className="text-base font-semibold text-foreground">
            {avaliados.length ? `${Math.round((pontos / avaliados.length) * 100)}%` : '—'}
            <span className="ml-1 text-xs font-normal text-foreground/55">de aderência</span>
          </span>
          {(['feito', 'reuniao', 'parcial', 'nao_deu', 'sem_resposta'] as EstadoDoBloco[]).map((e) => (
            <span key={e} className="inline-flex items-center gap-1">
              <span className={cn('h-2.5 w-2.5 rounded-full', VISUAL_DO_ESTADO[e].bolinha)} />{VISUAL_DO_ESTADO[e].nome}: {contar(e)}
            </span>
          ))}
          {atrasados > 0 && <span>Marcados depois do horário: {atrasados}</span>}
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
                {b.dias.map((d) => {
                  const v = VISUAL_DO_ESTADO[d.estado]
                  const ativo = sel?.bloco === b.id && sel.data === d.data
                  return (
                    <td key={d.data} className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => setSel(ativo ? null : { bloco: b.id, data: d.data })}
                        title={v.nome}
                        className={cn(
                          'mx-auto grid h-6 w-10 place-items-center rounded text-[10px] font-bold text-white',
                          d.estado === 'futuro' ? 'border border-dashed border-line' : v.bolinha.replace('animate-pulse', ''),
                          ativo && 'outline outline-2 outline-offset-1 outline-accent',
                        )}
                      >
                        {v.icone}{d.marcacao?.atrasado ? '·' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {escolhida && (
        <div className="rounded-lg border border-line p-3 text-xs text-foreground/80">
          <div className="font-semibold text-foreground">
            {DIAS[dados.dias.findIndex((d) => d.data === escolhida.data)]} {ddmm(escolhida.data)} · {escolhida.bloco.inicio}–{escolhida.bloco.fim} · {escolhida.bloco.titulo}
          </div>
          <div className="mt-1">{VISUAL_DO_ESTADO[escolhida.estado].nome}
            {escolhida.marcacao && <> · marcado às {escolhida.marcacao.marcado_em.slice(11, 16)}{escolhida.marcacao.atrasado ? ' (depois do horário)' : ''}</>}
          </div>
          {escolhida.marcacao?.motivo && <div className="mt-1">Motivo: {escolhida.marcacao.motivo}</div>}
          {escolhida.reunioes.length > 0 && (
            <div className="mt-1">Reuniões no horário: {escolhida.reunioes.map((r) => `${r.agendamento.slice(11, 16)} ${r.nome || r.empresa}`).join(' · ')}</div>
          )}
        </div>
      )}

      {motivos.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Parcial e não deu</div>
          <ul className="space-y-1 text-xs text-foreground/80">
            {motivos.map((c) => (
              <li key={`${c.bloco.id}-${c.data}`} className="flex gap-2">
                <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', VISUAL_DO_ESTADO[c.estado].bolinha)} />
                <span><b className="tabular-nums">{ddmm(c.data)} {c.bloco.inicio}</b> {c.bloco.titulo}: {c.marcacao?.motivo}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
      <p className="text-xs text-foreground/55">
        Um item por linha. Em "Reunião", os itens são o que fazer quando não tem reunião no horário. As marcações antigas continuam guardadas.
      </p>
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
