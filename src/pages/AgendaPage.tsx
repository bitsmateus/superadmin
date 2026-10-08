import * as React from 'react'
import {
  Building2,
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  List,
  Loader2,
  MessageSquareText,
  Pencil,
  PlusCircle,
  Search,
  Settings,
  Trash2,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useAgendaEvents, useAgendaSlots, useCreateMeeting, useDeleteMeeting, useRescheduleMeeting, useUpdateMeeting,
} from '@/hooks/useAgenda'
import { useTeamProfiles, profileOptions } from '@/hooks/useTeamProfiles'
import { useClients } from '@/hooks/useClients'
import { useAuth } from '@/hooks/useAuth'
import { resolveArea } from '@/services/supabase'
import { SUPPORT_SUBTYPES, type CalendarEvent, type MeetingType, type SupportSubtype } from '@/api/agenda'
import { asText, cn } from '@/lib/utils'
import { isSameDay } from '@/lib/time'

/** Cada colaborador tem sua própria cor (hash estável do nome), pra diferenciar reuniões de
 * pessoas diferentes num piscar de olhos — independente do tipo (Comercial/Suporte), que já tem
 * a etiqueta própria. */
const COR_COLABORADOR_PALETA = [
  '#3B82F6', '#A855F7', '#EC4899', '#F97316', '#10B981',
  '#14B8A6', '#EAB308', '#EF4444', '#6366F1', '#84CC16',
]
function corDoColaborador(nome: string | null | undefined): string {
  const texto = (nome ?? '').trim() || '—'
  let hash = 0
  for (let i = 0; i < texto.length; i++) hash = (hash * 31 + texto.charCodeAt(i)) >>> 0
  return COR_COLABORADOR_PALETA[hash % COR_COLABORADOR_PALETA.length]
}

/** Separação Comercial/Suporte é por profile.area — ninguém escolhe à toa quem vê o quê. 'ambos'
 * (padrão de admin/supervisor) é quem pode alternar livremente entre os dois e ver todos juntos. */
function tipoTravado(area: ReturnType<typeof resolveArea>): MeetingType | null {
  if (area === 'comercial') return 'comercial'
  if (area === 'entrega') return 'suporte'
  return null
}

interface AgendaFiltro {
  tipo: MeetingType | null
  responsavel: string
}

function lerFiltroSalvo(storageKey: string | null): AgendaFiltro {
  if (!storageKey) return { tipo: null, responsavel: '' }
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return { tipo: null, responsavel: '' }
    const parsed = JSON.parse(raw) as Partial<AgendaFiltro>
    return {
      tipo: parsed.tipo === 'comercial' || parsed.tipo === 'suporte' ? parsed.tipo : null,
      responsavel: typeof parsed.responsavel === 'string' ? parsed.responsavel : '',
    }
  } catch {
    return { tipo: null, responsavel: '' }
  }
}

/** Mensagem pronta de convite — cola o essencial (quem, quando, link) pra mandar no WhatsApp sem
 * reescrever nada toda vez. */
function buildInviteMessage(e: CalendarEvent): string {
  const dia = new Date(e.start).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  const quem = asText(e.clienteNome, e.title)
  const linha = [
    `Olá${quem ? `, ${quem}` : ''}! Confirmando nossa reunião para o dia ${dia}, às ${fmtHour(e.start)}.`,
    e.meetLink ? `Link da videochamada: ${e.meetLink}` : null,
  ].filter(Boolean)
  return linha.join('\n')
}

const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const DURATION_OPTIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hora' },
  { value: '90', label: '1h30' },
  { value: '120', label: '2 horas' },
]

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtHour(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function fmtDayMonth(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** Data (YYYY-MM-DD) e hora (HH:mm) no fuso de São Paulo — o que o formulário de edição mostra. */
function spDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
function spTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
}

/** "Suporte · Alinhamento" quando a reunião de suporte tem tipo; senão só Comercial/Suporte. */
function tipoBadge(e: CalendarEvent): string {
  const sub = e.subtipo ? SUPPORT_SUBTYPES.find((s) => s.value === e.subtipo)?.label : null
  return sub ? `${tipoLabel(e.tipo)} · ${sub}` : tipoLabel(e.tipo)
}

function tipoLabel(tipo: MeetingType | null): string {
  if (tipo === 'comercial') return 'Comercial'
  if (tipo === 'suporte') return 'Suporte'
  return 'Reunião'
}

/** Erro de request de services/api.ts anexa o corpo em `.body` — ver services/api.ts. */
function isNotConfiguredError(err: unknown): boolean {
  const body = (err as { body?: { code?: string } } | undefined)?.body
  return body?.code === 'not_configured'
}

type Visao = 'lista' | 'calendario'
const VISAO_KEY = 'agenda-visao'

function lerVisao(): Visao {
  try {
    return window.localStorage.getItem(VISAO_KEY) === 'calendario' ? 'calendario' : 'lista'
  } catch {
    return 'lista'
  }
}

/** Diferença em dias de calendário (local) entre duas datas — arredonda pra não tropeçar em horário de verão. */
function diffDias(a: Date, b: Date): number {
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((dia(a) - dia(b)) / 86_400_000)
}

export function AgendaPage() {
  const { profile } = useAuth()
  const area = resolveArea(profile?.area)
  const travado = tipoTravado(area)
  const storageKey = profile?.id ? `agenda-filtro:${profile.id}` : null

  const [filtro, setFiltroState] = React.useState<AgendaFiltro>(() => {
    const salvo = lerFiltroSalvo(storageKey)
    return travado ? { ...salvo, tipo: travado } : salvo
  })
  const setFiltro = (next: AgendaFiltro) => {
    setFiltroState(next)
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* ignore */ }
    }
  }

  const { data: profiles } = useTeamProfiles()
  const responsavelOptionsFiltro = profileOptions(
    profiles,
    filtro.tipo === 'comercial' ? 'comercial' : filtro.tipo === 'suporte' ? 'entrega' : undefined,
  )

  const [visao, setVisaoState] = React.useState<Visao>(lerVisao)
  const setVisao = (v: Visao) => {
    setVisaoState(v)
    try { window.localStorage.setItem(VISAO_KEY, v) } catch { /* ignore */ }
  }
  // `anchor` é qualquer dia do período mostrado: a semana (lista) ou o mês (calendário) sai dele.
  const [anchor, setAnchor] = React.useState(() => new Date())
  const weekStart = React.useMemo(() => startOfWeek(anchor), [anchor])
  // Grade do mês: começa na segunda da semana do dia 1º e tem 6 semanas (42 dias) — altura fixa.
  const gridStart = React.useMemo(() => startOfWeek(startOfMonth(anchor)), [anchor])
  const rangeStart = visao === 'lista' ? weekStart : gridStart
  const rangeEnd = React.useMemo(() => addDays(rangeStart, visao === 'lista' ? 7 : 42), [rangeStart, visao])
  const { data, isLoading, isError, error, refetch, isFetching } = useAgendaEvents(
    rangeStart.toISOString(),
    rangeEnd.toISOString(),
  )
  const [modal, setModal] = React.useState<{ open: boolean; event: CalendarEvent | null; date: string }>({
    open: false,
    event: null,
    date: toDateInput(new Date()),
  })
  const abrirNovo = (date: string) => setModal({ open: true, event: null, date })
  const abrirEvento = (event: CalendarEvent) => setModal({ open: true, event, date: toDateInput(new Date(event.start)) })
  const deleteMeeting = useDeleteMeeting()
  const reschedule = useRescheduleMeeting()

  const days = React.useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const gridDays = React.useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart])
  // Separação Comercial/Suporte É esse filtro — pra quem tem área travada, `filtro.tipo` nunca
  // muda do que `tipoTravado` definiu, então o outro tipo nunca aparece nem passando a semana.
  const events = (data?.events ?? []).filter((e) => {
    if (filtro.tipo && e.tipo !== filtro.tipo) return false
    if (filtro.responsavel && e.responsavel !== filtro.responsavel) return false
    return true
  })
  const eventsByDay = (day: Date) =>
    events.filter((e) => isSameDay(new Date(e.start), day)).sort((a, b) => a.start.localeCompare(b.start))

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link).catch(() => {})
    toast.success('Link copiado')
  }
  const copyMessage = (e: CalendarEvent) => {
    navigator.clipboard.writeText(buildInviteMessage(e)).catch(() => {})
    toast.success('Mensagem copiada')
  }

  const onCancel = (e: CalendarEvent, depois?: () => void) => {
    if (!window.confirm(`Cancelar a reunião "${e.clienteNome ?? e.title}"?\n\nIsso exclui o evento da agenda do Google.`)) return
    deleteMeeting.mutate(e.id, {
      onSuccess: () => {
        toast.success('Reunião cancelada')
        depois?.()
      },
      onError: (err) => toast.error('Falha ao cancelar: ' + (err instanceof Error ? err.message : 'erro')),
    })
  }

  // Arrastar: mantém o horário e troca só o dia.
  const [arrastando, setArrastando] = React.useState<string | null>(null)
  const [diaAlvo, setDiaAlvo] = React.useState<string | null>(null)
  const moverPara = (eventId: string, day: Date) => {
    const e = (data?.events ?? []).find((x) => x.id === eventId)
    if (!e) return
    const delta = diffDias(day, new Date(e.start))
    if (delta === 0) return
    const ms = delta * 86_400_000
    const start = new Date(new Date(e.start).getTime() + ms).toISOString()
    const end = new Date(new Date(e.end).getTime() + ms).toISOString()
    reschedule.mutate(
      { id: e.id, start, end },
      {
        onSuccess: () => toast.success(`Reunião movida para ${fmtDayMonth(day)}`),
        onError: (err) => toast.error('Falha ao mover: ' + (err instanceof Error ? err.message : 'erro')),
      },
    )
  }
  const dnd = (day: Date) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!arrastando) return
      ev.preventDefault()
      setDiaAlvo(day.toDateString())
    },
    onDragLeave: () => setDiaAlvo((d) => (d === day.toDateString() ? null : d)),
    onDrop: (ev: React.DragEvent) => {
      ev.preventDefault()
      const id = arrastando ?? ev.dataTransfer.getData('text/plain')
      setArrastando(null)
      setDiaAlvo(null)
      if (id) moverPara(id, day)
    },
  })
  const dragEvento = (e: CalendarEvent) => ({
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      ev.dataTransfer.setData('text/plain', e.id)
      ev.dataTransfer.effectAllowed = 'move'
      setArrastando(e.id)
    },
    onDragEnd: () => {
      setArrastando(null)
      setDiaAlvo(null)
    },
  })

  const navegar = (dir: -1 | 1) =>
    setAnchor(visao === 'lista' ? addDays(anchor, 7 * dir) : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1))
  const titulo =
    visao === 'lista'
      ? `${fmtDayMonth(days[0])} – ${fmtDayMonth(days[6])}`
      : anchor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  if (isError && isNotConfiguredError(error)) {
    return (
      <>
        <TopBar title="Agenda" subtitle="Reuniões comerciais e de suporte" />
        <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          <SetupPendingPanel />
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title="Agenda"
        subtitle="Reuniões comerciais e de suporte"
        rightSlot={
          <Button onClick={() => abrirNovo(toDateInput(new Date()))} leftIcon={<PlusCircle className="h-4 w-4" />}>
            Nova reunião
          </Button>
        }
      />

      <div className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => navegar(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(new Date())}>
              Hoje
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navegar(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="ml-2 text-sm capitalize text-foreground/60">{titulo}</span>
          </div>
          <div className="flex items-center gap-3">
            {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-foreground/40" />}
            <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Visualização">
              {([
                { value: 'lista' as Visao, label: 'Lista', icon: List },
                { value: 'calendario' as Visao, label: 'Calendário', icon: CalendarDays },
              ]).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setVisao(o.value)}
                  aria-pressed={visao === o.value}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
                    visao === o.value ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
                  )}
                >
                  <o.icon className="h-3.5 w-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          {travado ? (
            <Badge tone={travado === 'comercial' ? 'info' : 'warning'}>{tipoLabel(travado)}</Badge>
          ) : (
            <div className="inline-flex overflow-hidden rounded-lg border border-line">
              {([
                { value: null, label: 'Todos' },
                { value: 'comercial' as MeetingType, label: 'Comercial' },
                { value: 'suporte' as MeetingType, label: 'Suporte' },
              ]).map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setFiltro({ ...filtro, tipo: o.value, responsavel: '' })}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    filtro.tipo === o.value ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <div className="w-52">
            <Select
              value={filtro.responsavel}
              onChange={(e) => setFiltro({ ...filtro, responsavel: e.target.value })}
              options={[{ value: '', label: 'Todos os colaboradores' }, ...responsavelOptionsFiltro]}
            />
          </div>
          <span className="text-[11px] text-foreground/40">Arraste uma reunião para outro dia para reagendar.</span>
        </div>

        {isError ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-6 text-center text-sm text-danger">
            Não foi possível carregar a agenda.{' '}
            <button type="button" onClick={() => refetch()} className="underline">
              Tentar de novo
            </button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : visao === 'calendario' ? (
          <MonthGrid
            days={gridDays}
            mes={anchor.getMonth()}
            eventsByDay={eventsByDay}
            diaAlvo={diaAlvo}
            dnd={dnd}
            dragEvento={dragEvento}
            onOpen={abrirEvento}
            onNew={(day) => abrirNovo(toDateInput(day))}
          />
        ) : (
          <div className="space-y-3">
            {days.map((day) => {
              const dayEvents = eventsByDay(day)
              const today = isSameDay(day, new Date())
              return (
                <section
                  key={day.toISOString()}
                  {...dnd(day)}
                  className={cn(
                    'overflow-hidden rounded-xl border bg-card transition-shadow',
                    today ? 'border-accent/40' : 'border-line',
                    diaAlvo === day.toDateString() && 'ring-2 ring-accent/50',
                  )}
                >
                  <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                    <Calendar className="h-4 w-4 text-foreground/45" />
                    <span className="text-sm font-semibold text-foreground">{WEEKDAY_LABEL[day.getDay()]}</span>
                    <span className="text-xs text-foreground/45">{fmtDayMonth(day)}</span>
                    {today && <Badge tone="info">Hoje</Badge>}
                    <span className="ml-auto text-xs text-foreground/40">
                      {dayEvents.length} reunião{dayEvents.length !== 1 ? 'ões' : ''}
                    </span>
                    <button
                      type="button"
                      title="Nova reunião neste dia"
                      onClick={() => abrirNovo(toDateInput(day))}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                    </button>
                  </header>
                  {dayEvents.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-foreground/40">Sem reuniões</div>
                  ) : (
                    <ul className="divide-y divide-line/60">
                      {dayEvents.map((e) => {
                        const cor = corDoColaborador(e.responsavel)
                        const parar = (fn: () => void) => (ev: React.MouseEvent) => {
                          ev.stopPropagation()
                          fn()
                        }
                        return (
                          <li
                            key={e.id}
                            {...dragEvento(e)}
                            onClick={() => abrirEvento(e)}
                            className={cn(
                              'flex cursor-pointer flex-wrap items-center justify-between gap-3 border-l-[6px] px-4 py-3 transition-colors hover:brightness-95',
                              arrastando === e.id && 'opacity-40',
                            )}
                            style={{ borderLeftColor: cor, backgroundColor: `${cor}1F` }}
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                                {fmtHour(e.start)}–{fmtHour(e.end)}
                              </span>
                              <Badge tone={e.tipo === 'comercial' ? 'info' : e.tipo === 'suporte' ? 'warning' : 'neutral'}>
                                {tipoBadge(e)}
                              </Badge>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{asText(e.clienteNome, e.title)}</div>
                                {e.responsavel && (
                                  <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: cor }}>
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                                    {e.responsavel}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {e.meetLink && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={parar(() => window.open(e.meetLink!, '_blank', 'noopener'))}
                                    leftIcon={<Video className="h-3.5 w-3.5" />}
                                  >
                                    Entrar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    title="Copiar link da reunião"
                                    onClick={parar(() => copyLink(e.meetLink!))}
                                    leftIcon={<Copy className="h-3.5 w-3.5" />}
                                  >
                                    Copiar link
                                  </Button>
                                </>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Copiar mensagem de convite"
                                onClick={parar(() => copyMessage(e))}
                                leftIcon={<MessageSquareText className="h-3.5 w-3.5" />}
                              >
                                Copiar mensagem
                              </Button>
                              <button
                                type="button"
                                title="Editar reunião"
                                aria-label="Editar reunião"
                                onClick={parar(() => abrirEvento(e))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-card text-foreground/50 ring-1 ring-line hover:bg-accent/10 hover:text-accent hover:ring-accent/30"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                title="Cancelar reunião"
                                aria-label="Cancelar reunião"
                                onClick={parar(() => onCancel(e))}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-card text-foreground/40 ring-1 ring-line hover:bg-danger/10 hover:text-danger hover:ring-danger/30"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <MeetingModal
        open={modal.open}
        event={modal.event}
        defaultDate={modal.date}
        travado={travado}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
        onCopyLink={copyLink}
        onCopyMessage={copyMessage}
        onCancelMeeting={(e) => onCancel(e, () => setModal((m) => ({ ...m, open: false })))}
      />
    </>
  )
}

/** Visão "Calendário": grade do mês (seg–dom). Chips coloridos por colaborador; arrastar chip troca o dia. */
function MonthGrid({
  days, mes, eventsByDay, diaAlvo, dnd, dragEvento, onOpen, onNew,
}: {
  days: Date[]
  mes: number
  eventsByDay: (d: Date) => CalendarEvent[]
  diaAlvo: string | null
  dnd: (d: Date) => React.HTMLAttributes<HTMLElement>
  dragEvento: (e: CalendarEvent) => React.HTMLAttributes<HTMLElement>
  onOpen: (e: CalendarEvent) => void
  onNew: (d: Date) => void
}) {
  const MAX = 3
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px] overflow-hidden rounded-xl border border-line bg-card">
        <div className="grid grid-cols-7 border-b border-line bg-elevate/[0.03]">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
            <div key={d} className="px-2 py-2 text-center text-xs font-medium text-foreground/50">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const evs = eventsByDay(day)
            const today = isSameDay(day, new Date())
            const foraDoMes = day.getMonth() !== mes
            return (
              <div
                key={day.toISOString()}
                {...dnd(day)}
                className={cn(
                  'group min-h-[112px] border-b border-r border-line/60 p-1.5 transition-colors',
                  foraDoMes && 'bg-elevate/[0.025]',
                  diaAlvo === day.toDateString() && 'bg-accent/10 ring-2 ring-inset ring-accent/50',
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      'grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular-nums',
                      today ? 'bg-accent font-semibold text-white' : foraDoMes ? 'text-foreground/30' : 'text-foreground/70',
                    )}
                  >
                    {day.getDate()}
                  </span>
                  <button
                    type="button"
                    title="Nova reunião neste dia"
                    onClick={() => onNew(day)}
                    className="rounded p-0.5 text-foreground/30 opacity-0 hover:bg-elevate/[0.06] hover:text-foreground group-hover:opacity-100"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {evs.slice(0, MAX).map((e) => {
                    const cor = corDoColaborador(e.responsavel)
                    return (
                      <button
                        key={e.id}
                        type="button"
                        {...dragEvento(e)}
                        onClick={() => onOpen(e)}
                        title={`${fmtHour(e.start)} · ${tipoBadge(e)} · ${asText(e.clienteNome, e.title)}${e.responsavel ? ` · ${e.responsavel}` : ''}`}
                        className="flex w-full items-center gap-1 truncate rounded border-l-[4px] px-1.5 py-0.5 text-left text-[11px] text-foreground hover:brightness-95"
                        style={{ borderLeftColor: cor, backgroundColor: `${cor}33` }}
                      >
                        <span className="shrink-0 font-semibold tabular-nums">{fmtHour(e.start)}</span>
                        <span className="truncate">{asText(e.clienteNome, e.title)}</span>
                      </button>
                    )
                  })}
                  {evs.length > MAX && (
                    <p className="px-1 text-[11px] text-foreground/45">+{evs.length - MAX} mais</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SetupPendingPanel() {
  const vars = ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-elevate/[0.04] text-foreground/60">
        <Settings className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-medium text-foreground">Agenda do Google ainda não configurada</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs text-foreground/50">
        Falta autorizar o acesso à conta Google que vai virar a agenda compartilhada. Preencha no .env:
      </p>
      <ul className="mx-auto mt-3 inline-block space-y-1 text-left text-xs">
        {vars.map((v) => (
          <li key={v} className="rounded bg-elevate/[0.05] px-2 py-1 font-mono text-foreground/70">
            {v}
          </li>
        ))}
      </ul>
      <p className="mx-auto mt-3 max-w-md text-[11px] text-foreground/40">
        Veja o passo a passo nos comentários de server/.env.example (criar um "ID do cliente OAuth" no
        Google Cloud Console e autorizar via developers.google.com/oauthplayground).
      </p>
    </div>
  )
}

/** Mesmo modal pra criar e pra ver/editar: com `event` abre as informações da reunião já editáveis. */
function MeetingModal({
  open,
  event,
  defaultDate,
  travado,
  onClose,
  onCopyLink,
  onCopyMessage,
  onCancelMeeting,
}: {
  open: boolean
  /** Reunião aberta pra ver/editar. null = nova reunião. */
  event: CalendarEvent | null
  defaultDate: string
  /** Área travada pelo profile.area de quem está criando (ver tipoTravado) — null = sem trava,
   * pode escolher o tipo livremente. Evita criar uma reunião que depois nem ela mesma verá. */
  travado: MeetingType | null
  onClose: () => void
  onCopyLink: (link: string) => void
  onCopyMessage: (e: CalendarEvent) => void
  onCancelMeeting: (e: CalendarEvent) => void
}) {
  const clients = useClients()
  const { data: profiles } = useTeamProfiles()
  const createMeeting = useCreateMeeting()
  const updateMeeting = useUpdateMeeting()
  const editando = event !== null

  const [tipo, setTipo] = React.useState<MeetingType>(travado ?? 'comercial')
  const [subtipo, setSubtipo] = React.useState<SupportSubtype | ''>('')
  const [clienteNome, setClienteNome] = React.useState('')
  const [clienteId, setClienteId] = React.useState<string | null>(null)
  const [clienteSearchOpen, setClienteSearchOpen] = React.useState(false)
  const [responsavel, setResponsavel] = React.useState('')
  const [date, setDate] = React.useState(defaultDate)
  const [duration, setDuration] = React.useState(60)
  const [selectedStart, setSelectedStart] = React.useState<string | null>(null)
  const [manualTime, setManualTime] = React.useState('')
  const [obs, setObs] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    if (event) {
      setTipo(event.tipo ?? travado ?? 'comercial')
      setSubtipo(event.subtipo ?? '')
      setClienteNome(event.clienteNome ?? event.title)
      setClienteId(event.clienteId)
      setResponsavel(event.responsavel ?? '')
      setDate(spDate(event.start))
      setDuration(Math.max(15, Math.round((new Date(event.end).getTime() - new Date(event.start).getTime()) / 60_000)))
      setSelectedStart(null)
      setManualTime(spTime(event.start))
      setObs(event.obs ?? '')
    } else {
      setTipo(travado ?? 'comercial')
      setSubtipo('')
      setClienteNome('')
      setClienteId(null)
      setResponsavel('')
      setDate(defaultDate)
      setDuration(60)
      setSelectedStart(null)
      setManualTime('')
      setObs('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, defaultDate, travado])

  const slotsQuery = useAgendaSlots(open ? date : null, duration)

  const clienteMatches = React.useMemo(() => {
    const q = clienteNome.trim().toLowerCase()
    if (!q) return []
    return clients
      .filter((c) => [c.company, c.name].some((x) => asText(x).toLowerCase().includes(q)))
      .slice(0, 8)
  }, [clients, clienteNome])

  const responsavelOptions = profileOptions(profiles, tipo === 'comercial' ? 'comercial' : 'entrega')
  // Se o responsável salvo no evento não está mais na lista (ex.: saiu do time), continua selecionável.
  const responsavelComAtual =
    responsavel && !responsavelOptions.some((o) => o.value === responsavel)
      ? [...responsavelOptions, { value: responsavel, label: responsavel }]
      : responsavelOptions
  const duracoes = DURATION_OPTIONS.some((o) => o.value === String(duration))
    ? DURATION_OPTIONS
    : [...DURATION_OPTIONS, { value: String(duration), label: `${duration} min` }].sort((a, b) => Number(a.value) - Number(b.value))

  const startISO = React.useMemo(() => {
    if (selectedStart) return selectedStart
    if (manualTime) return new Date(`${date}T${manualTime}:00-03:00`).toISOString()
    return null
  }, [selectedStart, manualTime, date])

  const canSubmit = Boolean(clienteNome.trim() && responsavel.trim() && startISO)
  const pending = createMeeting.isPending || updateMeeting.isPending

  const onSubmit = () => {
    if (!startISO) return
    const end = new Date(new Date(startISO).getTime() + duration * 60_000).toISOString()
    const input = {
      tipo,
      subtipo: tipo === 'suporte' && subtipo ? subtipo : null,
      clienteId,
      clienteNome: clienteNome.trim(),
      responsavel: responsavel.trim(),
      start: startISO,
      end,
      obs: obs.trim() || undefined,
    }
    if (event) {
      updateMeeting.mutate(
        { id: event.id, input },
        {
          onSuccess: () => {
            onClose()
            toast.success('Reunião atualizada')
          },
          onError: (err) => toast.error('Falha ao salvar: ' + (err instanceof Error ? err.message : 'erro')),
        },
      )
      return
    }
    createMeeting.mutate(input, {
      onSuccess: (res) => {
        onClose()
        toast.success(
          <div className="flex flex-col gap-1.5">
            <span>Reunião criada com sucesso.</span>
            {res.event.meetLink && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(res.event.meetLink!).catch(() => {})
                  toast.success('Link copiado')
                }}
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs hover:bg-elevate/[0.04]"
              >
                <Copy className="h-3 w-3" /> Copiar link do Meet
              </button>
            )}
          </div>,
        )
      },
      onError: (err) => toast.error('Falha ao criar reunião: ' + (err instanceof Error ? err.message : 'erro')),
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editando ? 'Reunião' : 'Nova reunião'}
      description={
        editando
          ? 'Informações da reunião — edite o que precisar e salve para atualizar a agenda do Google.'
          : 'Cria o evento direto na agenda compartilhada, com link do Meet.'
      }
      size="md"
      footer={
        <>
          {event && (
            <Button
              variant="ghost"
              className="mr-auto text-danger hover:bg-danger/10"
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => onCancelMeeting(event)}
            >
              Cancelar reunião
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {editando ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit} loading={pending}>
            {editando ? 'Salvar alterações' : 'Criar reunião'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {event && (
          <div className="flex flex-wrap items-center gap-2">
            {event.meetLink && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => window.open(event.meetLink!, '_blank', 'noopener')}
                  leftIcon={<Video className="h-3.5 w-3.5" />}
                >
                  Entrar
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onCopyLink(event.meetLink!)} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                  Copiar link
                </Button>
              </>
            )}
            <Button size="sm" variant="secondary" onClick={() => onCopyMessage(event)} leftIcon={<MessageSquareText className="h-3.5 w-3.5" />}>
              Copiar mensagem
            </Button>
          </div>
        )}

        {travado && !editando ? (
          <Badge tone={travado === 'comercial' ? 'info' : 'warning'}>{tipoLabel(travado)}</Badge>
        ) : (
          <Select
            label="Tipo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as MeetingType)
              if (e.target.value !== 'suporte') setSubtipo('')
            }}
            options={[
              { value: 'comercial', label: 'Comercial' },
              { value: 'suporte', label: 'Suporte' },
            ]}
            disabled={Boolean(travado)}
          />
        )}

        {tipo === 'suporte' && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground/55">Tipo da reunião de suporte</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo da reunião de suporte">
              {SUPPORT_SUBTYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSubtipo(subtipo === t.value ? '' : t.value)}
                  aria-pressed={subtipo === t.value}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    subtipo === t.value
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : 'border-line text-foreground/60 hover:bg-elevate/[0.04]',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="relative">
          <Input
            label="Cliente"
            value={clienteNome}
            onChange={(e) => {
              setClienteNome(e.target.value)
              setClienteId(null)
              setClienteSearchOpen(true)
            }}
            onFocus={() => setClienteSearchOpen(true)}
            onBlur={() => setTimeout(() => setClienteSearchOpen(false), 150)}
            placeholder="Nome do cliente ou empresa…"
            leftIcon={<Search className="h-4 w-4" />}
          />
          {clienteSearchOpen && clienteMatches.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-card shadow-lg divide-y divide-line/50">
              {clienteMatches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={() => {
                      setClienteNome(c.company || c.name)
                      setClienteId(c.id)
                      setClienteSearchOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-elevate/[0.04]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate text-foreground/85">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
                      {asText(c.company || c.name, '—')}
                    </span>
                    {clienteId === c.id && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Select
          label="Responsável"
          value={responsavel}
          onChange={(e) => setResponsavel(e.target.value)}
          options={[{ value: '', label: '— Selecione —' }, ...responsavelComAtual]}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Data"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setSelectedStart(null)
            }}
          />
          <Select
            label="Duração"
            value={String(duration)}
            onChange={(e) => {
              setDuration(Number(e.target.value))
              setSelectedStart(null)
            }}
            options={duracoes}
          />
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground/55">
            <Clock className="h-3.5 w-3.5" /> Horários livres (08h–18h)
          </p>
          {slotsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-foreground/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando agenda…
            </div>
          ) : (slotsQuery.data?.slots.length ?? 0) === 0 ? (
            <p className="py-1 text-xs text-foreground/40">Nenhum horário livre nesse dia — escolha outra data ou informe um horário manualmente.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {slotsQuery.data!.slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  onClick={() => {
                    setSelectedStart(s.start)
                    setManualTime('')
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                    selectedStart === s.start
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line text-foreground/70 hover:bg-elevate/[0.04]',
                  )}
                >
                  {fmtHour(s.start)}
                </button>
              ))}
            </div>
          )}
          <Input
            label="Ou informe um horário manualmente"
            type="time"
            value={manualTime}
            onChange={(e) => {
              setManualTime(e.target.value)
              setSelectedStart(null)
            }}
            containerClassName="mt-2"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/55">Observações (opcional)</label>
          <textarea
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            rows={2}
            placeholder="Pauta, contexto, link de material…"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
        </div>
      </div>
    </Modal>
  )
}
