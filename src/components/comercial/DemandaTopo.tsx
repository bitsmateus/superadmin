import * as React from 'react'
import { toast } from 'sonner'
import { CalendarDays, Clock, Loader2, Plus, Sparkles, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAgendaEvents } from '@/hooks/useAgenda'
import { useTeamProfiles, profileOptions } from '@/hooks/useTeamProfiles'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { MeetingModal, tipoTravado } from '@/pages/AgendaPage'
import { useAuth } from '@/hooks/useAuth'
import { resolveArea } from '@/services/supabase'
import { leadPagesService } from '@/services/leadPages'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/api/agenda'

const TZ = 'America/Sao_Paulo'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
const diaChave = (iso: string | Date) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const diaRotulo = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ })

/** Topo das abas de Demandas: a quem a aba pertence (vínculo), a agenda dessa pessoa e o botão da IA. */
export function DemandaTopo({
  pageId, pageName, responsavel, isAdmin,
}: { pageId: string; pageName: string; responsavel: string; isAdmin: boolean }) {
  const { data: profiles } = useTeamProfiles()
  const options = React.useMemo(() => {
    const base = profileOptions(profiles)
    // Vínculo que já não existe mais na equipe continua aparecendo, em vez de sumir do seletor.
    return responsavel && !base.some((o) => o.value === responsavel) ? [{ value: responsavel, label: responsavel }, ...base] : base
  }, [profiles, responsavel])
  const [iaOpen, setIaOpen] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-card pl-2.5 pr-1 text-sm text-foreground/70">
        <UserRound className="h-4 w-4 shrink-0 text-foreground/40" />
        {isAdmin ? (
          <select
            value={responsavel}
            onChange={(e) => void leadPagesService.setResponsavel(pageId, e.target.value)}
            className="h-8 max-w-[11rem] cursor-pointer bg-transparent pr-1 text-sm text-foreground focus:outline-none"
            aria-label="Pessoa vinculada a esta aba"
          >
            <option value="">Vincular pessoa…</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <span className="px-1 text-foreground">{responsavel || 'Sem pessoa vinculada'}</span>
        )}
      </label>

      {responsavel && <AgendaDaPessoa responsavel={responsavel} />}

      <Button size="sm" leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => setIaOpen(true)}>
        Organizar com IA
      </Button>
      <OrganizarIaModal open={iaOpen} onClose={() => setIaOpen(false)} pageId={pageId} pageName={pageName} responsavel={responsavel} />
    </div>
  )
}

/** Chip com os compromissos de hoje da pessoa ("Sem compromisso" se não houver) e, ao clicar, os próximos 7 dias. */
function AgendaDaPessoa({ responsavel }: { responsavel: string }) {
  const [open, setOpen] = React.useState(false)
  const [novaOpen, setNovaOpen] = React.useState(false)
  const { profile } = useAuth()
  const ref = React.useRef<HTMLDivElement>(null)
  useOutsideClose(ref, open, () => setOpen(false))

  // Janela fixa por dia (não por instante) pra a query não refazer a cada render.
  const chaveHoje = diaChave(new Date())
  const { from, to } = React.useMemo(() => {
    const d = new Date(`${chaveHoje}T00:00:00-03:00`)
    return { from: d.toISOString(), to: new Date(d.getTime() + 7 * 86400_000).toISOString() }
  }, [chaveHoje])
  const { data, isLoading, isError } = useAgendaEvents(from, to)

  const meus: CalendarEvent[] = React.useMemo(
    () => (data?.events ?? [])
      .filter((e) => (e.responsavel ?? '').trim().toLowerCase() === responsavel.trim().toLowerCase())
      .sort((a, b) => a.start.localeCompare(b.start)),
    [data, responsavel],
  )
  const hoje = meus.filter((e) => diaChave(e.start) === chaveHoje)
  const proximos = meus.filter((e) => diaChave(e.start) !== chaveHoje)

  let resumo: React.ReactNode
  if (isLoading) resumo = <span className="inline-flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" />Agenda…</span>
  else if (isError) resumo = 'Agenda indisponível'
  else if (!hoje.length) resumo = 'Sem compromisso hoje'
  else {
    const prox = hoje.find((e) => new Date(e.end).getTime() > Date.now()) ?? hoje[hoje.length - 1]
    resumo = `${hoje.length} hoje · ${hora(prox.start)} ${prox.clienteNome ?? prox.title}`
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-9 max-w-[18rem] items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors',
          hoje.length ? 'border-accent/40 bg-accent/10 text-foreground' : 'border-line bg-card text-foreground/60',
        )}
        title={`Agenda de ${responsavel}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0" />
        <span className="truncate">{resumo}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 max-w-[90vw] rounded-lg border border-line bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground/60">Agenda de {responsavel}</p>
            <button
              type="button"
              onClick={() => { setOpen(false); setNovaOpen(true) }}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />Nova reunião
            </button>
          </div>
          {!meus.length ? (
            <p className="py-2 text-sm text-foreground/50">Sem compromisso nos próximos 7 dias.</p>
          ) : (
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {[...hoje, ...proximos].map((e) => (
                <div key={e.id} className="rounded-md border border-line px-2.5 py-1.5 text-sm">
                  <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                    <Clock className="h-3 w-3" />
                    {diaChave(e.start) === chaveHoje ? 'Hoje' : diaRotulo(e.start)} · {hora(e.start)}–{hora(e.end)}
                  </div>
                  <div className="truncate text-foreground">{e.clienteNome ?? e.title}</div>
                </div>
              ))}
            </div>
          )}
          {hoje.length === 0 && meus.length > 0 && <p className="mt-2 text-xs text-foreground/50">Sem compromisso hoje.</p>}
        </div>
      )}
      <MeetingModal
        open={novaOpen}
        event={null}
        defaultDate={chaveHoje}
        defaultResponsavel={responsavel}
        travado={tipoTravado(resolveArea(profile?.area))}
        onClose={() => setNovaOpen(false)}
        onCopyLink={() => {}}
        onCopyMessage={() => {}}
        onCancelMeeting={() => {}}
      />
    </div>
  )
}

interface Plano {
  resumo: string
  grupos: { titulo: string; itens: { id: string; titulo: string; motivo: string; horario: string | null }[] }[]
  geradoEm: string
  responsavel: string
  totalDemandas: number
  compromissos: number
  origem?: 'auto' | 'manual'
}

/** Pop-up que pede à IA (Anthropic, no servidor) a organização das demandas abertas por horário/urgência. */
function OrganizarIaModal({
  open, onClose, pageId, pageName, responsavel,
}: { open: boolean; onClose: () => void; pageId: string; pageName: string; responsavel: string }) {
  const [loading, setLoading] = React.useState(false)
  const [plano, setPlano] = React.useState<Plano | null>(null)
  const [erro, setErro] = React.useState('')

  // Outra aba = outro plano; não reaproveita o da anterior.
  React.useEffect(() => { setPlano(null); setErro('') }, [pageId])

  const gerar = async () => {
    setLoading(true); setErro('')
    try {
      setPlano(await api.post<Plano>(`/api/lead-pages/${encodeURIComponent(pageId)}/organizar`, {}))
    } catch (err) {
      const msg = (err as Error).message || 'Falha ao gerar a organização.'
      setErro(msg); toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  // Ao abrir mostra o plano salvo (gerado automaticamente às 08h ou na última vez que alguém gerou);
  // só gera na hora se a aba ainda não tem nenhum.
  React.useEffect(() => {
    if (!open || plano || loading || erro) return
    let vivo = true
    setLoading(true)
    api.get<{ plano: Plano | null }>(`/api/lead-pages/${encodeURIComponent(pageId)}/organizar`)
      .then((r) => {
        if (!vivo) return
        if (r.plano) { setPlano(r.plano); setLoading(false) } else void gerar()
      })
      .catch((err: Error) => { if (vivo) { setErro(err.message || 'Falha ao carregar.'); setLoading(false) } })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />Organizar demandas</span>}
      description={`${pageName}${responsavel ? ` · ${responsavel}` : ''} — agrupadas por urgência e horário, respeitando a agenda.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
          <Button onClick={() => void gerar()} disabled={loading} leftIcon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}>
            {plano ? 'Gerar novamente' : 'Gerar'}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="grid min-h-[200px] place-items-center text-sm text-foreground/50">
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Carregando a organização das demandas…</span>
        </div>
      ) : erro ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{erro}</p>
      ) : plano ? (
        <div className="space-y-4">
          <p className="text-xs font-medium text-foreground/50">
            {plano.origem === "manual" ? "Gerado manualmente" : "Gerado automaticamente"} em {new Date(plano.geradoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ })}
          </p>
          {plano.resumo && <p className="text-sm text-foreground/80">{plano.resumo}</p>}
          <p className="text-xs text-foreground/50">
            {plano.totalDemandas} demanda(s) aberta(s) · {plano.compromissos === 0 ? 'sem compromisso' : `${plano.compromissos} compromisso(s)`} na agenda nos próximos 7 dias
            {!responsavel && ' · vincule uma pessoa à aba pra a IA considerar a agenda'}
          </p>
          {plano.grupos.map((g) => (
            <section key={g.titulo}>
              <h3 className="mb-1.5 text-sm font-semibold text-foreground">{g.titulo}</h3>
              <ul className="space-y-1.5">
                {g.itens.map((it) => (
                  <li key={it.id} className="rounded-md border border-line px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-foreground">{it.titulo}</span>
                      {it.horario && <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-xs text-foreground/70">{it.horario}</span>}
                    </div>
                    {it.motivo && <p className="mt-0.5 text-xs text-foreground/55">{it.motivo}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}
