import * as React from 'react'
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, EyeOff, ExternalLink, Handshake, Inbox, Loader2, MessageCircleReply,
  Moon, RefreshCw, Search, Send, Settings2, Siren, Users, CalendarClock, Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Tabs } from '@/components/ui/Tabs'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/hooks/useAuth'
import { cn, formatDateTimeShort } from '@/lib/utils'
import {
  ROTULO_SITUACAO, formatarDuracao, monitorAtendimentoApi,
  type ConfigMonitor, type EventoMonitor, type FilaNx, type LinhaRanking, type PainelMonitor, type Situacao, type TicketMonitor,
  type UsuarioNx,
} from '@/api/monitorAtendimento'

/**
 * Monitor de Atendimento: os tickets abertos do atendimento da NX (app.nxsystems.com.br/atendimento),
 * quem está esperando quem e há quanto tempo. O servidor recalcula a cada 3 min e avisa no grupo do
 * suporte o que estourou o prazo (ver server/src/lib/atendimento/).
 */

const erroMsg = (e: unknown, padrao = 'Algo deu errado') => (e instanceof Error && e.message ? e.message : padrao)

const CARDS: { situacao: Situacao | 'aberto_longo'; icone: React.ReactNode; dica: string }[] = [
  { situacao: 'sem_resposta', icone: <Clock className="h-4 w-4" />, dica: 'O cliente falou por último e ninguém respondeu' },
  { situacao: 'promessa', icone: <Handshake className="h-4 w-4" />, dica: 'O atendente prometeu retorno e não voltou' },
  { situacao: 'fila', icone: <Inbox className="h-4 w-4" />, dica: 'Pendente, sem atendente' },
  { situacao: 'cliente_parou', icone: <Moon className="h-4 w-4" />, dica: 'Respondido; o cliente não voltou' },
  { situacao: 'aberto_longo', icone: <CalendarClock className="h-4 w-4" />, dica: 'Aberto há muitos dias' },
]

const TOM_SITUACAO: Record<Situacao, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  sem_resposta: 'danger',
  promessa: 'warning',
  fila: 'danger',
  cliente_parou: 'info',
  ok: 'success',
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const ROTULO_EVENTO: Record<string, string> = {
  alerta: 'Alerta',
  escalado: 'Escalado',
  aberto_longo: 'Aberto há dias',
  finalizado: 'Finalizado na NX',
  finalizado_painel: 'Finalizado pelo painel',
  auto_encerrado: 'Finalizado automático',
  followup: 'Follow-up enviado',
  transferido: 'Transferido',
  reaberto: 'Reaberto',
  ignorado: 'Ignorado',
  monitorado: 'Voltou a ser monitorado',
}

type AcaoTicket = { tipo: 'finalizar' | 'followup' | 'transferir'; ticket: TicketMonitor } | null

export function MonitorAtendimentoPage() {
  const { profile } = useAuth()
  const podeConfigurar = profile?.role === 'admin' || profile?.role === 'supervisor'
  const [dados, setDados] = React.useState<PainelMonitor | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)
  const [rodando, setRodando] = React.useState(false)
  const [aba, setAba] = React.useState('tickets')
  const [filtroSituacao, setFiltroSituacao] = React.useState<Situacao | 'aberto_longo' | 'todas'>('todas')
  const [filtroAtendente, setFiltroAtendente] = React.useState('todos')
  const [soForaDoPrazo, setSoForaDoPrazo] = React.useState(false)
  const [verIgnorados, setVerIgnorados] = React.useState(false)
  const [busca, setBusca] = React.useState('')
  const [acao, setAcao] = React.useState<AcaoTicket>(null)
  const [configAberta, setConfigAberta] = React.useState(false)

  const carregar = React.useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true)
    try {
      setDados(await monitorAtendimentoApi.painel())
      setErro(null)
    } catch (e) {
      setErro(erroMsg(e, 'Não consegui carregar o monitor'))
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    carregar()
    const t = window.setInterval(() => carregar(true), 60_000)
    return () => window.clearInterval(t)
  }, [carregar])

  const rodarAgora = async () => {
    setRodando(true)
    try {
      const c = await monitorAtendimentoApi.rodar()
      if (c.ok) toast.success(`Atualizado: ${c.tickets} tickets, ${c.lidos} conversas lidas${c.alertas ? `, ${c.alertas} alertas no grupo` : ''}`)
      else toast.error(c.erro ?? 'Falhou')
      await carregar(true)
    } catch (e) {
      toast.error(erroMsg(e))
    } finally {
      setRodando(false)
    }
  }

  const ignorar = async (t: TicketMonitor, valor: boolean) => {
    try {
      await monitorAtendimentoApi.ignorar(t.id, valor)
      toast.success(valor ? `${t.contato ?? 'Contato'} não será mais monitorado` : 'Voltou a ser monitorado')
      carregar(true)
    } catch (e) {
      toast.error(erroMsg(e))
    }
  }

  const tickets = dados?.tickets ?? []
  const atendentes = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tickets) m.set(t.atendenteId ? String(t.atendenteId) : 'sem', t.atendente ?? 'Sem atendente')
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [tickets])

  const filtrados = tickets.filter((t) => {
    if (t.ignorado !== verIgnorados) return false
    if (filtroSituacao === 'aberto_longo' ? !t.abertoLongo : filtroSituacao !== 'todas' && t.situacao !== filtroSituacao) return false
    if (filtroAtendente !== 'todos' && (t.atendenteId ? String(t.atendenteId) : 'sem') !== filtroAtendente) return false
    if (soForaDoPrazo && t.nivel < 1) return false
    if (busca.trim()) {
      const q = busca.trim().toLowerCase()
      const alvo = `${t.contato ?? ''} ${t.cliente ?? ''} ${t.atendente ?? ''} ${t.fila ?? ''} ${t.id} ${t.textoCliente ?? ''} ${t.textoAtendente ?? ''}`.toLowerCase()
      if (!alvo.includes(q)) return false
    }
    return true
  })

  const ignoradosTotal = tickets.filter((t) => t.ignorado).length

  return (
    <>
      <TopBar
        title="Monitor de Atendimento"
        subtitle="Quem está esperando quem, e há quanto tempo"
        rightSlot={
          <div className="flex items-center gap-2">
            {dados?.ciclo.em && (
              <span className="hidden text-xs text-foreground/50 md:inline">
                Atualizado {formatDateTimeShort(dados.ciclo.em)}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={rodarAgora} loading={rodando} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
              Atualizar agora
            </Button>
            {podeConfigurar && (
              <Button variant="secondary" size="sm" onClick={() => setConfigAberta(true)} leftIcon={<Settings2 className="h-3.5 w-3.5" />}>
                Configurar
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-5 p-4 md:p-6">
        {erro && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{erro}</div>
        )}
        {dados && <Avisos dados={dados} />}

        {carregando && !dados ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : dados ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {CARDS.map((c) => {
                const ativo = filtroSituacao === c.situacao
                const contagem =
                  c.situacao === 'aberto_longo'
                    ? { total: dados.abertoLongo, foraDoPrazo: dados.abertoLongo, escalados: 0 }
                    : dados.contagens[c.situacao] ?? { total: 0, foraDoPrazo: 0, escalados: 0 }
                const rotulo = c.situacao === 'aberto_longo' ? `Aberto há +${dados.config.prazos.abertoDias} dias` : ROTULO_SITUACAO[c.situacao]
                const alerta = contagem.foraDoPrazo > 0 && c.situacao !== 'cliente_parou' && c.situacao !== 'aberto_longo'
                return (
                  <button
                    key={c.situacao}
                    type="button"
                    title={c.dica}
                    onClick={() => {
                      setAba('tickets')
                      setFiltroSituacao(ativo ? 'todas' : c.situacao)
                    }}
                    className={cn(
                      'rounded-xl border bg-card p-4 text-left transition-colors hover:border-accent/40',
                      ativo ? 'border-accent ring-1 ring-accent/40' : alerta ? 'border-danger/40' : 'border-line',
                    )}
                  >
                    <div className={cn('flex items-center gap-2 text-xs font-medium', alerta ? 'text-danger' : 'text-foreground/60')}>
                      {c.icone}
                      <span className="truncate">{rotulo}</span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className={cn('text-2xl font-semibold', alerta && 'text-danger')}>{contagem.foraDoPrazo}</span>
                      {c.situacao !== 'aberto_longo' && <span className="text-xs text-foreground/50">fora do prazo · {contagem.total} no total</span>}
                    </div>
                    {contagem.escalados > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-danger">
                        <Siren className="h-3 w-3" /> {contagem.escalados} escalados
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <Tabs
              value={aba}
              onChange={setAba}
              items={[
                { value: 'tickets', label: `Tickets (${tickets.filter((t) => !t.ignorado).length})` },
                { value: 'ranking', label: 'Por atendente' },
                { value: 'historico', label: 'Histórico' },
              ]}
            />

            {aba === 'tickets' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-full sm:w-64">
                    <Input placeholder="Buscar contato, cliente, mensagem…" value={busca} onChange={(e) => setBusca(e.target.value)} leftIcon={<Search className="h-3.5 w-3.5" />} />
                  </div>
                  <div className="w-44">
                    <Select
                      value={filtroSituacao}
                      onChange={(e) => setFiltroSituacao(e.target.value as Situacao | 'todas' | 'aberto_longo')}
                      options={[
                        { value: 'todas', label: 'Todas as situações' },
                        ...(['sem_resposta', 'promessa', 'fila', 'cliente_parou', 'ok'] as Situacao[]).map((s) => ({ value: s, label: ROTULO_SITUACAO[s] })),
                        { value: 'aberto_longo', label: `Aberto há +${dados.config.prazos.abertoDias} dias` },
                      ]}
                    />
                  </div>
                  <div className="w-44">
                    <Select
                      value={filtroAtendente}
                      onChange={(e) => setFiltroAtendente(e.target.value)}
                      options={[{ value: 'todos', label: 'Todos os atendentes' }, ...atendentes.map(([v, l]) => ({ value: v, label: l }))]}
                    />
                  </div>
                  <label className="flex h-9 items-center gap-2 text-sm text-foreground/70">
                    <input type="checkbox" checked={soForaDoPrazo} onChange={(e) => setSoForaDoPrazo(e.target.checked)} />
                    Só fora do prazo
                  </label>
                  {ignoradosTotal > 0 && (
                    <label className="flex h-9 items-center gap-2 text-sm text-foreground/70">
                      <input type="checkbox" checked={verIgnorados} onChange={(e) => setVerIgnorados(e.target.checked)} />
                      Ver ignorados ({ignoradosTotal})
                    </label>
                  )}
                </div>

                {filtrados.length === 0 ? (
                  <EmptyState
                    icon={<CheckCircle2 className="h-6 w-6" />}
                    title={tickets.length ? 'Nada com esse filtro' : 'Nenhum ticket aberto lido ainda'}
                    description={tickets.length ? 'Tente outra situação ou atendente.' : 'Clique em "Atualizar agora" para ler o atendimento da NX.'}
                  />
                ) : (
                  <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
                    {filtrados.map((t) => (
                      <LinhaTicket
                        key={t.id}
                        t={t}
                        podeConfigurar={podeConfigurar}
                        onAcao={(tipo) => setAcao({ tipo, ticket: t })}
                        onIgnorar={(v) => ignorar(t, v)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {aba === 'ranking' && <Ranking dados={dados} />}
            {aba === 'historico' && <Historico />}
          </>
        ) : null}
      </div>

      {acao && dados && (
        <ModalAcao
          acao={acao}
          config={dados.config}
          onClose={() => setAcao(null)}
          onFeito={() => {
            setAcao(null)
            carregar(true)
          }}
        />
      )}
      {configAberta && dados && (
        <ModalConfig
          dados={dados}
          onClose={() => setConfigAberta(false)}
          onSalvo={() => {
            setConfigAberta(false)
            carregar(true)
          }}
        />
      )}
    </>
  )
}

function Avisos({ dados }: { dados: PainelMonitor }) {
  const avisos: { tom: 'danger' | 'warning'; texto: string }[] = []
  if (!dados.credencialOk) avisos.push({ tom: 'danger', texto: 'Sem credencial da NX: configure o grupo de suporte em Configurações (ou a credencial própria em "Configurar").' })
  if (!dados.config.ativo) avisos.push({ tom: 'warning', texto: 'Monitor desligado: os tickets não são atualizados sozinhos e nenhum alerta vai para o grupo.' })
  if (dados.ciclo.em && !dados.ciclo.ok && dados.ciclo.erro) avisos.push({ tom: 'danger', texto: `Última leitura falhou: ${dados.ciclo.erro}` })
  if (!dados.grupoDestino) avisos.push({ tom: 'warning', texto: 'Nenhum grupo de WhatsApp para os alertas: configure o grupo do suporte.' })
  if (!avisos.length) return null
  return (
    <div className="space-y-2">
      {avisos.map((a) => (
        <div
          key={a.texto}
          className={cn(
            'flex items-start gap-2 rounded-xl border p-3 text-sm',
            a.tom === 'danger' ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/30 bg-warning/5 text-warning',
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {a.texto}
        </div>
      ))}
    </div>
  )
}

function BarraDePrazo({ t }: { t: TicketMonitor }) {
  if (t.situacao === 'ok' || !t.prazoMin) return null
  const pct = Math.min(100, (t.decorridoMin / t.prazoMin) * 100)
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-elevate/[0.06]">
      <div className={cn('h-full rounded-full', t.nivel >= 2 ? 'bg-danger' : t.nivel >= 1 ? 'bg-warning' : 'bg-success')} style={{ width: `${pct}%` }} />
    </div>
  )
}

function LinhaTicket({
  t,
  podeConfigurar,
  onAcao,
  onIgnorar,
}: {
  t: TicketMonitor
  podeConfigurar: boolean
  onAcao: (tipo: 'finalizar' | 'followup' | 'transferir') => void
  onIgnorar: (valor: boolean) => void
}) {
  const trecho = t.situacao === 'sem_resposta' || t.situacao === 'fila' ? t.textoCliente : t.textoAtendente || t.textoCliente
  const quemFalou = t.situacao === 'sem_resposta' || t.situacao === 'fila' ? 'Cliente' : t.textoAtendente ? t.atendente || 'Atendente' : 'Cliente'
  return (
    <div className={cn('grid gap-3 p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center', t.nivel >= 2 && 'bg-danger/[0.04]')}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{t.contato || `Ticket #${t.id}`}</span>
          {t.grupo && <Badge>grupo</Badge>}
          {t.cliente && <Badge tone="info">{t.cliente}</Badge>}
          {t.abertoLongo && <Badge tone="warning">aberto há {formatarDuracao(t.abertoEm ? (Date.now() - Date.parse(t.abertoEm)) / 60000 : 0)}</Badge>}
        </div>
        <div className="text-xs text-foreground/50">
          #{t.id} · {t.atendente || 'sem atendente'}
          {t.fila ? ` · ${t.fila}` : ''}
          {t.status === 'pending' ? ' · pendente' : ''}
          {t.followupEm ? ` · follow-up ${formatDateTimeShort(t.followupEm)}` : ''}
        </div>
        {trecho && (
          <p className="line-clamp-2 text-sm text-foreground/70">
            <span className="text-foreground/40">{quemFalou}: </span>
            {trecho}
          </p>
        )}
        {t.erro && <p className="text-xs text-danger">Erro ao ler a conversa: {t.erro}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={t.nivel >= 1 ? TOM_SITUACAO[t.situacao] : t.situacao === 'ok' ? 'success' : 'neutral'} dot>
            {t.situacaoRotulo}
          </Badge>
          {t.nivel >= 2 && (
            <Badge tone="danger">
              <Siren className="h-3 w-3" /> escalado
            </Badge>
          )}
          {t.classeIa && <span className="text-[11px] text-foreground/40" title="Leitura da IA sobre a última mensagem do atendente">IA: {t.classeIa}</span>}
        </div>
        {t.situacao !== 'ok' && (
          <>
            <div className={cn('text-xs', t.nivel >= 1 ? 'font-medium text-foreground' : 'text-foreground/60')}>
              há {formatarDuracao(t.decorridoMin)} · prazo {formatarDuracao(t.prazoMin)}
              {t.situacao !== 'cliente_parou' && <span className="text-foreground/40"> (horário comercial)</span>}
            </div>
            <BarraDePrazo t={t} />
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <a href={t.link} target="_blank" rel="noreferrer">
          <Button variant="outline" size="sm" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
            Abrir
          </Button>
        </a>
        {!t.ignorado && (
          <>
            <Button variant="ghost" size="sm" title="Mandar uma mensagem de acompanhamento ao cliente" onClick={() => onAcao('followup')} leftIcon={<MessageCircleReply className="h-3.5 w-3.5" />}>
              Follow-up
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onAcao('transferir')} leftIcon={<ArrowRightLeft className="h-3.5 w-3.5" />}>
              Transferir
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onAcao('finalizar')} leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}>
              Finalizar
            </Button>
          </>
        )}
        {podeConfigurar && (
          <Button
            variant="ghost"
            size="sm"
            title={t.ignorado ? 'Voltar a monitorar este contato' : 'Parar de monitorar este contato (ex.: grupo interno)'}
            onClick={() => onIgnorar(!t.ignorado)}
            leftIcon={t.ignorado ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          >
            {t.ignorado ? 'Monitorar' : 'Ignorar'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Ranking({ dados }: { dados: PainelMonitor }) {
  const [periodo, setPeriodo] = React.useState<'hoje' | 'semana'>('hoje')
  const linhas: LinhaRanking[] = dados.ranking[periodo]
  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg border border-line bg-card p-1 text-sm">
        {(['hoje', 'semana'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriodo(p)}
            className={cn('rounded-md px-3 py-1', periodo === p ? 'bg-accent/15 text-foreground' : 'text-foreground/60')}
          >
            {p === 'hoje' ? 'Hoje' : 'Últimos 7 dias'}
          </button>
        ))}
      </div>
      {linhas.length === 0 ? (
        <EmptyState icon={<Users className="h-6 w-6" />} title="Sem dados ainda" description="Os números aparecem conforme o monitor lê o atendimento." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-foreground/50">
              <tr>
                <th className="px-4 py-2.5 font-medium">Atendente</th>
                <th className="px-4 py-2.5 font-medium">Abertos agora</th>
                <th className="px-4 py-2.5 font-medium">Fora do prazo agora</th>
                <th className="px-4 py-2.5 font-medium">Alertas</th>
                <th className="px-4 py-2.5 font-medium">Escalados</th>
                <th className="px-4 py-2.5 font-medium">Finalizados</th>
                <th className="px-4 py-2.5 font-medium" title="Tempo útil entre a 1ª mensagem do cliente e a 1ª resposta humana, nos tickets novos do período">
                  1ª resposta média
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {linhas.map((l) => (
                <tr key={l.user_id ?? 'sem'}>
                  <td className="px-4 py-2.5 font-medium">{l.user_name}</td>
                  <td className="px-4 py-2.5">{l.abertos}</td>
                  <td className={cn('px-4 py-2.5', l.em_alerta > 0 && 'font-medium text-danger')}>{l.em_alerta}</td>
                  <td className="px-4 py-2.5">{l.alertas}</td>
                  <td className={cn('px-4 py-2.5', l.escalados > 0 && 'text-danger')}>{l.escalados}</td>
                  <td className="px-4 py-2.5">{l.finalizados}</td>
                  <td className="px-4 py-2.5">{l.primeira_resposta_media === null ? '—' : formatarDuracao(l.primeira_resposta_media)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Historico() {
  const [dias, setDias] = React.useState(7)
  const [eventos, setEventos] = React.useState<EventoMonitor[] | null>(null)
  React.useEffect(() => {
    setEventos(null)
    monitorAtendimentoApi
      .historico(dias)
      .then(setEventos)
      .catch((e) => {
        toast.error(erroMsg(e))
        setEventos([])
      })
  }, [dias])
  return (
    <div className="space-y-3">
      <div className="w-44">
        <Select
          value={String(dias)}
          onChange={(e) => setDias(Number(e.target.value))}
          options={[
            { value: '1', label: 'Últimas 24h' },
            { value: '7', label: 'Últimos 7 dias' },
            { value: '30', label: 'Últimos 30 dias' },
          ]}
        />
      </div>
      {!eventos ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : eventos.length === 0 ? (
        <EmptyState icon={<Clock className="h-6 w-6" />} title="Nada no período" />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {eventos.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <span className="w-28 shrink-0 text-xs text-foreground/50">{formatDateTimeShort(e.created_at)}</span>
              <Badge tone={e.tipo === 'escalado' ? 'danger' : e.tipo === 'alerta' ? 'warning' : e.tipo.startsWith('finalizado') || e.tipo === 'auto_encerrado' ? 'success' : 'neutral'}>
                {ROTULO_EVENTO[e.tipo] ?? e.tipo}
              </Badge>
              <span className="font-medium">{e.contato_nome || `Ticket #${e.ticket_id}`}</span>
              {e.situacao && e.situacao !== 'ok' && <span className="text-foreground/60">{ROTULO_SITUACAO[e.situacao]}</span>}
              {e.detalhe && <span className="truncate text-foreground/50">{e.detalhe}</span>}
              <span className="ml-auto text-xs text-foreground/40">
                {e.user_name ? `${e.user_name}` : ''}
                {e.autor && e.autor !== 'monitor' && e.autor !== 'nx' ? ` · por ${e.autor}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ModalAcao({ acao, config, onClose, onFeito }: { acao: NonNullable<AcaoTicket>; config: ConfigMonitor; onClose: () => void; onFeito: () => void }) {
  const t = acao.ticket
  const [mensagem, setMensagem] = React.useState(acao.tipo === 'followup' ? config.followupMensagem : '')
  const [enviando, setEnviando] = React.useState(false)
  const [usuarios, setUsuarios] = React.useState<UsuarioNx[] | null>(null)
  const [filas, setFilas] = React.useState<FilaNx[]>([])
  const [userId, setUserId] = React.useState('')
  const [queueId, setQueueId] = React.useState('')

  React.useEffect(() => {
    if (acao.tipo !== 'transferir') return
    monitorAtendimentoApi.usuarios().then(setUsuarios).catch((e) => {
      toast.error(erroMsg(e))
      setUsuarios([])
    })
    monitorAtendimentoApi.filas().then(setFilas).catch(() => setFilas([]))
  }, [acao.tipo])

  const confirmar = async () => {
    setEnviando(true)
    try {
      if (acao.tipo === 'followup') {
        await monitorAtendimentoApi.followup(t.id, mensagem)
        toast.success('Follow-up enviado ao cliente')
      } else if (acao.tipo === 'finalizar') {
        await monitorAtendimentoApi.finalizar(t.id, mensagem.trim() || undefined)
        toast.success('Atendimento finalizado')
      } else {
        await monitorAtendimentoApi.transferir(t.id, { userId: userId ? Number(userId) : null, queueId: queueId ? Number(queueId) : null })
        toast.success('Transferido')
      }
      onFeito()
    } catch (e) {
      toast.error(erroMsg(e))
    } finally {
      setEnviando(false)
    }
  }

  const titulo = { followup: 'Mandar follow-up', finalizar: 'Finalizar atendimento', transferir: 'Transferir atendimento' }[acao.tipo]
  return (
    <Modal
      open
      onClose={onClose}
      title={titulo}
      description={`${t.contato || `Ticket #${t.id}`}${t.grupo ? ' (grupo)' : ''} · ${t.atendente || 'sem atendente'}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            loading={enviando}
            disabled={(acao.tipo === 'followup' && !mensagem.trim()) || (acao.tipo === 'transferir' && !userId && !queueId)}
            leftIcon={acao.tipo === 'finalizar' ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          >
            {acao.tipo === 'followup' ? 'Enviar ao cliente' : acao.tipo === 'finalizar' ? (mensagem.trim() ? 'Enviar e finalizar' : 'Finalizar') : 'Transferir'}
          </Button>
        </div>
      }
    >
      {acao.tipo === 'followup' && (
        <Textarea label="Mensagem que vai para o cliente" rows={4} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
      )}
      {acao.tipo === 'finalizar' && (
        <div className="space-y-3">
          <p className="text-sm text-foreground/70">O ticket será finalizado na NX. Se quiser, mande uma mensagem de despedida antes (opcional).</p>
          <Textarea label="Mensagem de encerramento (opcional)" rows={3} value={mensagem} onChange={(e) => setMensagem(e.target.value)} placeholder={config.autoEncerrar.mensagem} />
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setMensagem(config.autoEncerrar.mensagem)}>
            Usar a mensagem padrão de encerramento
          </button>
        </div>
      )}
      {acao.tipo === 'transferir' && (
        <div className="space-y-3">
          {!usuarios ? (
            <div className="flex items-center gap-2 text-sm text-foreground/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando atendentes…
            </div>
          ) : (
            <Select
              label="Para o atendente"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              options={[{ value: '', label: '— manter —' }, ...usuarios.map((u) => ({ value: String(u.id), label: u.name }))]}
            />
          )}
          {filas.length > 0 && (
            <Select
              label="Para a fila"
              value={queueId}
              onChange={(e) => setQueueId(e.target.value)}
              options={[{ value: '', label: '— manter —' }, ...filas.map((f) => ({ value: String(f.id), label: f.nome }))]}
            />
          )}
        </div>
      )}
    </Modal>
  )
}

function Campo({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-foreground/70">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-foreground/45">{hint}</div>}
    </div>
  )
}

function Chave({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-foreground">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-foreground/50">{hint}</span>}
      </span>
    </label>
  )
}

function ModalConfig({ dados, onClose, onSalvo }: { dados: PainelMonitor; onClose: () => void; onSalvo: () => void }) {
  const [c, setC] = React.useState<ConfigMonitor>(() => JSON.parse(JSON.stringify(dados.config)))
  const [ignorarTexto, setIgnorarTexto] = React.useState(dados.config.ignorar.join('\n'))
  const [salvando, setSalvando] = React.useState(false)
  const [filas, setFilas] = React.useState<FilaNx[] | null>(null)
  const [resumo, setResumo] = React.useState<string | null>(null)
  const [ocupado, setOcupado] = React.useState<string | null>(null)

  React.useEffect(() => {
    monitorAtendimentoApi.filas().then(setFilas).catch(() => setFilas([]))
  }, [])

  const set = <K extends keyof ConfigMonitor>(k: K, v: ConfigMonitor[K]) => setC((x) => ({ ...x, [k]: v }))
  const setPrazo = (k: keyof ConfigMonitor['prazos'], v: string) => setC((x) => ({ ...x, prazos: { ...x.prazos, [k]: Number(v) } }))

  const salvar = async () => {
    setSalvando(true)
    try {
      await monitorAtendimentoApi.salvarConfig({
        ...c,
        ignorar: ignorarTexto.split('\n').map((s) => s.trim()).filter(Boolean),
      })
      toast.success('Configuração salva')
      onSalvo()
    } catch (e) {
      toast.error(erroMsg(e))
    } finally {
      setSalvando(false)
    }
  }

  const testarGrupo = async () => {
    setOcupado('grupo')
    try {
      await monitorAtendimentoApi.testarGrupo()
      toast.success('Mensagem de teste enviada no grupo')
    } catch (e) {
      toast.error(erroMsg(e))
    } finally {
      setOcupado(null)
    }
  }

  const verResumo = async (enviar: boolean) => {
    setOcupado(enviar ? 'resumo-enviar' : 'resumo')
    try {
      const r = await monitorAtendimentoApi.resumo(enviar)
      setResumo(r.texto)
      if (enviar) toast.success('Resumo enviado no grupo')
    } catch (e) {
      toast.error(erroMsg(e))
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title="Configurar o monitor"
      description="Os prazos, o horário do suporte e o que vai para o grupo do WhatsApp."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={testarGrupo} loading={ocupado === 'grupo'} leftIcon={<Send className="h-3.5 w-3.5" />}>
              Testar grupo
            </Button>
            <Button variant="outline" size="sm" onClick={() => verResumo(false)} loading={ocupado === 'resumo'}>
              Ver resumo de agora
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={salvar} loading={salvando}>
              Salvar
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1 text-foreground">
        <Chave checked={c.ativo} onChange={(v) => set('ativo', v)} label="Monitor ligado" hint="Lê o atendimento a cada 3 minutos e manda os alertas no grupo." />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Prazos</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Cliente sem resposta (min)" hint="Horário comercial">
              <Input type="number" min={1} value={c.prazos.semRespostaMin} onChange={(e) => setPrazo('semRespostaMin', e.target.value)} />
            </Campo>
            <Campo label='"Vou verificar" e sumiu (min)' hint="Horário comercial">
              <Input type="number" min={1} value={c.prazos.promessaMin} onChange={(e) => setPrazo('promessaMin', e.target.value)} />
            </Campo>
            <Campo label="Na fila sem dono (min)" hint="Horário comercial">
              <Input type="number" min={1} value={c.prazos.filaMin} onChange={(e) => setPrazo('filaMin', e.target.value)} />
            </Campo>
            <Campo label="Cliente parou de falar (horas)" hint="Horas corridas">
              <Input type="number" min={1} value={c.prazos.clienteParouHoras} onChange={(e) => setPrazo('clienteParouHoras', e.target.value)} />
            </Campo>
            <Campo label="Aberto há (dias)" hint="Dias corridos">
              <Input type="number" min={1} value={c.prazos.abertoDias} onChange={(e) => setPrazo('abertoDias', e.target.value)} />
            </Campo>
            <Campo label="Escalar em (× o prazo)" hint="2 = escala no dobro do prazo">
              <Input type="number" min={1.1} step={0.1} value={c.escalarEm} onChange={(e) => set('escalarEm', Number(e.target.value))} />
            </Campo>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Horário do suporte</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Abre">
              <Input type="time" value={c.horario.inicio} onChange={(e) => set('horario', { ...c.horario, inicio: e.target.value })} />
            </Campo>
            <Campo label="Fecha">
              <Input type="time" value={c.horario.fim} onChange={(e) => set('horario', { ...c.horario, fim: e.target.value })} />
            </Campo>
            <Campo label="Resumo diário no grupo" hint="Vazio = sem resumo">
              <Input type="time" value={c.resumoHora} onChange={(e) => set('resumoHora', e.target.value)} />
            </Campo>
          </div>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((d, i) => {
              const marcado = c.horario.dias.includes(i)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set('horario', { ...c.horario, dias: marcado ? c.horario.dias.filter((x) => x !== i) : [...c.horario.dias, i].sort() })}
                  className={cn('rounded-md border px-3 py-1 text-sm', marcado ? 'border-accent bg-accent/15 text-foreground' : 'border-line text-foreground/50')}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-foreground/50">Fora do horário o relógio pausa e os alertas esperam até a abertura.</p>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Para onde vão os avisos</h3>
          <Campo label="ID do grupo do WhatsApp" hint={dados.grupoDestino ? `Vazio = grupo do suporte (${dados.grupoDestino})` : 'Vazio = grupo do suporte em Configurações'}>
            <Input value={c.grupoId} onChange={(e) => set('grupoId', e.target.value)} placeholder="Grupo do suporte" />
          </Campo>
          <div className="space-y-2">
            <p className="text-sm font-medium">O que avisa no grupo</p>
            <p className="text-xs text-foreground/50">Desmarcado = fica só no painel, sem notificação.</p>
            {(['promessa', 'sem_resposta', 'fila', 'cliente_parou'] as const).map((s) => (
              <Chave
                key={s}
                checked={c.avisos.situacoes.includes(s)}
                onChange={(v) =>
                  set('avisos', { ...c.avisos, situacoes: v ? [...c.avisos.situacoes, s] : c.avisos.situacoes.filter((x) => x !== s) })
                }
                label={ROTULO_SITUACAO[s]}
              />
            ))}
            <Chave
              checked={c.avisos.abertoLongo}
              onChange={(v) => set('avisos', { ...c.avisos, abertoLongo: v })}
              label={`Abertos há mais de ${c.prazos.abertoDias} dias`}
            />
            <Chave checked={c.avisos.resumo} onChange={(v) => set('avisos', { ...c.avisos, resumo: v })} label="Resumo diário" />
            <Chave
              checked={c.avisos.carga.ativo}
              onChange={(v) => set('avisos', { ...c.avisos, carga: { ...c.avisos.carga, ativo: v } })}
              label="Abertos e pendentes de cada atendente, quando tiver muitos"
              hint="Conversas privadas (grupos não contam)."
            />
            {c.avisos.carga.ativo && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Avisar a partir de (atendimentos)" hint="Total de abertos + pendentes">
                  <Input
                    type="number"
                    min={1}
                    value={c.avisos.carga.limite}
                    onChange={(e) => set('avisos', { ...c.avisos, carga: { ...c.avisos.carga, limite: Number(e.target.value) } })}
                  />
                </Campo>
                <Campo label="No máximo 1 aviso a cada (horas)">
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={c.avisos.carga.intervaloHoras}
                    onChange={(e) => set('avisos', { ...c.avisos, carga: { ...c.avisos.carga, intervaloHoras: Number(e.target.value) } })}
                  />
                </Campo>
              </div>
            )}
          </div>
          <Chave
            checked={c.notaNoTicket}
            onChange={(v) => set('notaNoTicket', v)}
            label="Também escrever uma nota interna no ticket"
            hint="O atendente vê o aviso dentro da conversa na NX. O cliente não vê."
          />
          <Chave
            checked={c.ia}
            onChange={(v) => set('ia', v)}
            label="Usar IA para ler a última mensagem do atendente"
            hint={dados.iaDisponivel ? 'Separa "vou verificar" (promessa) de "resolvido" com mais precisão que as palavras-chave.' : 'Sem ANTHROPIC_API_KEY no servidor: hoje valem só as palavras-chave.'}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Follow-up e encerramento</h3>
          <Campo label="Mensagem padrão de follow-up">
            <Textarea rows={2} value={c.followupMensagem} onChange={(e) => set('followupMensagem', e.target.value)} />
          </Campo>
          <Chave
            checked={c.autoEncerrar.ativo}
            onChange={(v) => set('autoEncerrar', { ...c.autoEncerrar, ativo: v })}
            label="Finalizar sozinho quando o cliente não responde"
            hint="Só conversas privadas (grupos nunca). Conta a partir do alerta de “cliente parou de falar”."
          />
          {c.autoEncerrar.ativo && (
            <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
              <Campo label="Horas depois do alerta">
                <Input
                  type="number"
                  min={1}
                  value={c.autoEncerrar.horasDepoisDoAlerta}
                  onChange={(e) => set('autoEncerrar', { ...c.autoEncerrar, horasDepoisDoAlerta: Number(e.target.value) })}
                />
              </Campo>
              <Campo label="Mensagem de encerramento">
                <Textarea rows={2} value={c.autoEncerrar.mensagem} onChange={(e) => set('autoEncerrar', { ...c.autoEncerrar, mensagem: e.target.value })} />
              </Campo>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">O que monitorar</h3>
          {filas === null ? (
            <div className="text-xs text-foreground/50">Carregando filas…</div>
          ) : filas.length > 0 ? (
            <Campo label="Filas" hint="Nenhuma marcada = todas">
              <div className="flex flex-wrap gap-2">
                {filas.map((f) => {
                  const marcado = c.filas.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => set('filas', marcado ? c.filas.filter((x) => x !== f.id) : [...c.filas, f.id])}
                      className={cn('rounded-md border px-3 py-1 text-sm', marcado ? 'border-accent bg-accent/15 text-foreground' : 'border-line text-foreground/60')}
                    >
                      {f.nome}
                    </button>
                  )
                })}
              </div>
            </Campo>
          ) : null}
          <Campo label="Ignorar estes contatos ou grupos" hint="Um por linha: número, ID do grupo ou parte do nome, sem se preocupar com acento ou maiúscula (ex.: “suporte geral” pega “SUPORTE GERAL NX”).">
            <Textarea rows={3} value={ignorarTexto} onChange={(e) => setIgnorarTexto(e.target.value)} />
          </Campo>
        </section>

        <details className="rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Avançado</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Link do atendimento" hint="Vai no fim de cada alerta e no botão Abrir. Se a NX passar a abrir o ticket direto, use {id} (ex.: …/atendimento/{id}).">
              <Input value={c.linkTicket} onChange={(e) => set('linkTicket', e.target.value)} />
            </Campo>
            <Campo label="URL da API" hint="Vazio = a do grupo de suporte">
              <Input value={c.credencial.baseUrl} onChange={(e) => set('credencial', { ...c.credencial, baseUrl: e.target.value })} placeholder="https://appapi.nxsystems.com.br" />
            </Campo>
            <Campo label="API ID" hint="Vazio = a mesma credencial do grupo de suporte">
              <Input value={c.credencial.apiId} onChange={(e) => set('credencial', { ...c.credencial, apiId: e.target.value })} />
            </Campo>
            <Campo label="Token" hint={c.credencial.tokenSalvo ? 'Já tem um salvo; deixe vazio para manter' : undefined}>
              <Input type="password" value={c.credencial.token} onChange={(e) => set('credencial', { ...c.credencial, token: e.target.value })} />
            </Campo>
          </div>
        </details>

        {resumo !== null && (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Prévia do resumo</h3>
              <Button size="sm" variant="outline" onClick={() => verResumo(true)} loading={ocupado === 'resumo-enviar'} leftIcon={<Send className="h-3.5 w-3.5" />}>
                Mandar no grupo agora
              </Button>
            </div>
            <pre className="whitespace-pre-wrap rounded-xl border border-line bg-elevate/[0.03] p-3 text-xs">{resumo}</pre>
          </section>
        )}
      </div>
    </Modal>
  )
}
