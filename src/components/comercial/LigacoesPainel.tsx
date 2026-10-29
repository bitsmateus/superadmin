import * as React from 'react'
import { Download, Pause, Phone, PhoneCall, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { api } from '@/services/api'
import { downloadCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'

/**
 * LIGAÇÕES (3C Plus) dentro do CRM de cada pessoa — botão "Ligações" no CRM ARTHUR e no CRM LUIS CLOSER.
 * Cada aba mostra só as ligações do dono dela (o servidor filtra pelo nome do agente na 3C).
 * Só leitura: os dados vêm de /api/ligacoes-3c/*, que guarda o token da 3C — o navegador nunca vê o token.
 */

/** Abas que têm o botão "Ligações" (as de quem liga pela 3C). */
export const PAGINAS_COM_LIGACOES = new Set(['crm-arthur', 'crm-luis-closer'])

interface Ligacao {
  id: string
  dia: string
  hhmm: string
  agente: string
  campanha: string
  numero: string
  status: string
  qualificacao: string
  modo: string
  tempoFalado: number
  atendida: boolean
}

interface Relatorio {
  pessoa: string
  periodo: { inicio: string; fim: string }
  atualizadoEm: string
  cortado: boolean
  totais: { chamadas: number; atendidas: number; taxaAtendimento: number; tempoFalado: number; tempoMedio: number }
  porAgente: { primeira: string | null; ultima: string | null; manuais: number; discador: number; diasComLigacao: number }[]
  porHora: { hora: number; chamadas: number; atendidas: number }[]
  porDia: { dia: string; chamadas: number; atendidas: number; tempoFalado: number }[]
  porQualificacao: { nome: string; qtd: number }[]
  ultimas: Ligacao[]
}

interface AgenteAgora {
  nome: string
  status: string
  situacao: 'ligando' | 'livre' | 'pausa' | 'pos' | 'offline' | 'outro'
  campanha: string
}

type Preset = 'hoje' | 'ontem' | '7dias' | 'mes' | 'mes_passado' | 'custom'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7dias', label: '7 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'custom', label: 'Escolher datas' },
]

function hoje(): string {
  // Dia de Brasília (-03:00), igual ao servidor.
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function periodoDoPreset(p: Preset): { inicio: string; fim: string } | null {
  const h = hoje()
  const [ano, mes] = h.split('-').map(Number)
  switch (p) {
    case 'hoje':
      return { inicio: h, fim: h }
    case 'ontem': {
      const o = somarDias(h, -1)
      return { inicio: o, fim: o }
    }
    case '7dias':
      return { inicio: somarDias(h, -6), fim: h }
    case 'mes':
      return { inicio: `${h.slice(0, 7)}-01`, fim: h }
    case 'mes_passado': {
      const primeiro = new Date(Date.UTC(ano, mes - 2, 1))
      const ultimo = new Date(Date.UTC(ano, mes - 1, 0))
      return { inicio: primeiro.toISOString().slice(0, 10), fim: ultimo.toISOString().slice(0, 10) }
    }
    default:
      return null
  }
}

function duracao(s: number): string {
  if (!s) return '0s'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  if (h) return `${h}h${String(m).padStart(2, '0')}`
  if (m) return `${m}min${seg ? ` ${String(seg).padStart(2, '0')}s` : ''}`
  return `${seg}s`
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const diaBr = (d: string) => d.split('-').reverse().join('/')
/** "2026-10-29T09:31" → "09:31" no mesmo dia, "29/10 09:31" em período longo. */
function horario(v: string | null | undefined, umDia: boolean): string {
  if (!v) return '—'
  const [d, h] = v.split('T')
  return umDia ? h : `${d.slice(8, 10)}/${d.slice(5, 7)} ${h}`
}

const COR_SITUACAO: Record<AgenteAgora['situacao'], string> = {
  ligando: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  livre: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  pos: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  pausa: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  offline: 'bg-elevate/[0.06] text-foreground/50',
  outro: 'bg-elevate/[0.06] text-foreground/70',
}

function Card({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-foreground/45">{detalhe}</p>}
    </div>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <h3 className="border-b border-line px-4 py-3 text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function Barras({ itens }: { itens: { rotulo: string; total: number; atendidas: number; extra?: string }[] }) {
  const max = Math.max(1, ...itens.map((i) => i.total))
  return (
    <div className="space-y-1.5 p-4">
      {itens.map((i) => (
        <div key={i.rotulo} className="flex items-center gap-3 text-xs">
          <span className="w-12 tabular-nums text-foreground/55">{i.rotulo}</span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-elevate/[0.05]">
            <div className="absolute inset-y-0 left-0 rounded bg-accent/30" style={{ width: `${(i.total / max) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 rounded bg-accent" style={{ width: `${(i.atendidas / max) * 100}%` }} />
          </div>
          <span className="min-w-[64px] text-right tabular-nums text-foreground/70">
            {i.total} <span className="text-foreground/40">/ {i.atendidas}</span>
            {i.extra && <span className="ml-1 text-foreground/45">· {i.extra}</span>}
          </span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-foreground/45">Barra clara = ligações · barra forte = atendidas</p>
    </div>
  )
}

/** Toca a gravação: busca o áudio pelo servidor (com o login do painel) e solta num <audio>. */
function BotaoGravacao({ id, pagina }: { id: string; pagina: string }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(false)
  const [erro, setErro] = React.useState(false)
  const [tocando, setTocando] = React.useState(false)
  const audio = React.useRef<HTMLAudioElement>(null)

  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const alternar = async () => {
    if (url && audio.current) {
      if (tocando) audio.current.pause()
      else void audio.current.play()
      return
    }
    setCarregando(true)
    setErro(false)
    try {
      const q = new URLSearchParams({ pagina })
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/ligacoes-3c/gravacao/${encodeURIComponent(id)}?${q}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` },
      })
      if (!res.ok) throw new Error()
      setUrl(URL.createObjectURL(await res.blob()))
    } catch {
      setErro(true)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={alternar}
        disabled={carregando}
        title={erro ? 'Gravação indisponível' : 'Ouvir gravação'}
        className={cn(
          'grid h-7 w-7 place-items-center rounded-lg hover:bg-elevate/[0.06]',
          erro ? 'text-danger' : 'text-foreground/60 hover:text-foreground',
        )}
      >
        {carregando ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : tocando ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      {url && (
        <audio
          ref={audio}
          src={url}
          autoPlay
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onEnded={() => setTocando(false)}
        />
      )}
    </span>
  )
}

export function LigacoesPainel({ pagina, pessoa }: { pagina: string; pessoa?: string }) {
  const [preset, setPreset] = React.useState<Preset>('hoje')
  const [custom, setCustom] = React.useState(() => ({ inicio: hoje(), fim: hoje() }))
  const periodo = preset === 'custom' ? custom : periodoDoPreset(preset)!
  const umDia = periodo.inicio === periodo.fim
  const incluiHoje = periodo.fim >= hoje()

  const [dados, setDados] = React.useState<Relatorio | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<{ status?: number; message: string } | null>(null)
  const [agora, setAgora] = React.useState<AgenteAgora | null | undefined>(undefined)

  const carregar = React.useCallback(
    async (forcar = false) => {
      setCarregando(true)
      setErro(null)
      try {
        const q = new URLSearchParams({ pagina, inicio: periodo.inicio, fim: periodo.fim, ...(forcar ? { atualizar: '1' } : {}) })
        setDados(await api.get<Relatorio>(`/api/ligacoes-3c/relatorio?${q}`))
      } catch (e) {
        const err = e as Error & { status?: number }
        setErro({ status: err.status, message: err.message })
        setDados(null)
      } finally {
        setCarregando(false)
      }
    },
    [pagina, periodo.inicio, periodo.fim],
  )

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  // Status ao vivo da pessoa, a cada 30s, só quando o período olhado inclui hoje.
  React.useEffect(() => {
    if (!incluiHoje || erro) return
    let vivo = true
    const buscar = () =>
      api
        .get<{ agente: AgenteAgora | null }>(`/api/ligacoes-3c/agora?${new URLSearchParams({ pagina })}`)
        .then((r) => vivo && setAgora(r.agente))
        .catch(() => vivo && setAgora(undefined))
    void buscar()
    const t = window.setInterval(buscar, 30_000)
    return () => {
      vivo = false
      window.clearInterval(t)
    }
  }, [pagina, incluiHoje, erro])

  const nome = dados?.pessoa || pessoa || ''
  const resumo = dados?.porAgente[0]

  const exportar = () => {
    if (!dados) return
    downloadCsv(
      `ligacoes-${nome.toLowerCase() || pagina}-${periodo.inicio}_${periodo.fim}.csv`,
      ['Dia', 'Hora', 'Número', 'Campanha', 'Status', 'Qualificação', 'Modo', 'Tempo falado'],
      dados.ultimas.map((l) => [diaBr(l.dia), l.hhmm, l.numero, l.campanha, l.status || (l.atendida ? 'Atendida' : 'Não atendida'), l.qualificacao, l.modo, duracao(l.tempoFalado)]),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
          <Phone className="h-4 w-4 text-accent" />
          Ligações{nome ? ` de ${nome}` : ''}
        </span>
        {incluiHoje && agora !== undefined && (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', agora ? COR_SITUACAO[agora.situacao] : COR_SITUACAO.offline)}>
            {agora ? `Agora: ${agora.status}` : 'Agora: fora do discador'}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={cn(
                'h-8 rounded-lg px-3 text-xs font-medium',
                preset === p.value ? 'bg-accent/15 text-accent' : 'text-foreground/60 hover:bg-elevate/[0.05] hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5 text-xs text-foreground/60">
              <input
                type="date"
                value={custom.inicio}
                max={hoje()}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, inicio: e.target.value }))}
                className="h-8 rounded-lg border border-line bg-card px-2 text-foreground"
              />
              até
              <input
                type="date"
                value={custom.fim}
                max={hoje()}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, fim: e.target.value }))}
                className="h-8 rounded-lg border border-line bg-card px-2 text-foreground"
              />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => void carregar(true)} loading={carregando} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
            Atualizar
          </Button>
          {dados && dados.totais.chamadas > 0 && (
            <Button variant="secondary" size="sm" onClick={exportar} leftIcon={<Download className="h-3.5 w-3.5" />}>
              CSV
            </Button>
          )}
        </div>
      </div>

      {erro ? (
        <EmptyState
          icon={<Phone className="h-8 w-8" />}
          title={
            erro.status === 503
              ? 'Integração com a 3C ainda não configurada'
              : erro.status === 403
                ? 'Sem acesso às ligações desta aba'
                : 'Não deu pra puxar as ligações da 3C'
          }
          description={erro.message}
          action={erro.status !== 403 && erro.status !== 503 ? <Button variant="secondary" onClick={() => void carregar(true)}>Tentar de novo</Button> : undefined}
        />
      ) : carregando && !dados ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : dados ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card
              titulo="Ligações"
              valor={String(dados.totais.chamadas)}
              detalhe={resumo && (resumo.manuais || resumo.discador) ? `${resumo.discador} discador · ${resumo.manuais} manual` : umDia ? diaBr(periodo.inicio) : `${diaBr(periodo.inicio)} a ${diaBr(periodo.fim)}`}
            />
            <Card titulo="Atendidas" valor={String(dados.totais.atendidas)} detalhe={`${pct(dados.totais.taxaAtendimento)} das ligações`} />
            <Card titulo="Tempo falado" valor={duracao(dados.totais.tempoFalado)} />
            <Card titulo="Média por conversa" valor={duracao(dados.totais.tempoMedio)} detalhe="só ligações atendidas" />
            <Card
              titulo={umDia ? 'Primeira → última' : 'Dias com ligação'}
              valor={umDia ? `${horario(resumo?.primeira, true)} → ${horario(resumo?.ultima, true)}` : String(resumo?.diasComLigacao ?? 0)}
            />
          </div>

          {dados.cortado && (
            <p className="rounded-xl bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
              Período com ligações demais na 3C: o resultado pode estar incompleto. Diminua o período pra ver tudo.
            </p>
          )}

          {dados.totais.chamadas === 0 ? (
            <EmptyState
              icon={<PhoneCall className="h-8 w-8" />}
              title={`Nenhuma ligação${nome ? ` de ${nome}` : ''} nesse período`}
              description="Nada registrado na 3C nas datas escolhidas. Mude o período acima."
            />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <Bloco titulo="Ligações por hora">
                  <Barras itens={dados.porHora.map((h) => ({ rotulo: `${String(h.hora).padStart(2, '0')}h`, total: h.chamadas, atendidas: h.atendidas }))} />
                </Bloco>

                <Bloco titulo="Qualificações">
                  {dados.porQualificacao.length === 0 ? (
                    <p className="p-4 text-sm text-foreground/50">Nenhuma ligação qualificada no período.</p>
                  ) : (
                    <ul className="divide-y divide-lineSoft">
                      {dados.porQualificacao.map((q) => (
                        <li key={q.nome} className="flex items-center justify-between px-4 py-2 text-sm">
                          <span className="text-foreground/80">{q.nome}</span>
                          <span className="font-medium tabular-nums text-foreground">{q.qtd}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Bloco>
              </div>

              {dados.porDia.length > 1 && (
                <Bloco titulo="Por dia">
                  <Barras
                    itens={dados.porDia.map((d) => ({
                      rotulo: `${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`,
                      total: d.chamadas,
                      atendidas: d.atendidas,
                      extra: duracao(d.tempoFalado),
                    }))}
                  />
                </Bloco>
              )}

              <Bloco titulo="Ligações">
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full min-w-[720px]">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                        <th className="px-4 py-2.5">Quando</th>
                        <th className="px-4 py-2.5">Número</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Qualificação</th>
                        <th className="px-4 py-2.5 text-right">Falou</th>
                        <th className="w-10 px-2 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {dados.ultimas.map((l, i) => (
                        <tr key={`${l.id}-${i}`} className="border-b border-lineSoft text-sm last:border-0">
                          <td className="px-4 py-2 tabular-nums text-foreground/70">{umDia ? l.hhmm : `${l.dia.slice(8, 10)}/${l.dia.slice(5, 7)} ${l.hhmm}`}</td>
                          <td className="px-4 py-2 tabular-nums text-foreground/70">{l.numero || '—'}</td>
                          <td className="px-4 py-2">
                            <span className={cn('rounded-md px-2 py-0.5 text-xs', l.atendida ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-elevate/[0.06] text-foreground/60')}>
                              {l.status || (l.atendida ? 'Atendida' : 'Não atendida')}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-foreground/70">{l.qualificacao || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-foreground/70">{l.tempoFalado ? duracao(l.tempoFalado) : '—'}</td>
                          <td className="px-2 py-2">{l.atendida && l.id && <BotaoGravacao id={l.id} pagina={pagina} />}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {dados.ultimas.length >= 300 && (
                  <p className="border-t border-line px-4 py-2 text-[11px] text-foreground/45">Mostrando as 300 mais recentes do período.</p>
                )}
              </Bloco>
            </>
          )}

          <p className="text-right text-[11px] text-foreground/40">
            Dados da 3C Plus · atualizado às {new Date(dados.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </>
      ) : null}
    </div>
  )
}
