import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { LeadBoardsView } from '@/components/comercial/LeadBoardsView'
import { useAllLeadRows, useLeadBoards } from '@/hooks/useLeadBoards'
import { useLeadPages } from '@/hooks/useLeadPages'
import { useAuth } from '@/hooks/useAuth'
import { ABAS_JUNTAS } from '@/lib/abasJuntas'
import { todayKey } from '@/lib/leadDates'
import { cn } from '@/lib/utils'

/** Data local (YYYY-MM-DD) de um created_at do servidor — o dateKey corta o ISO em UTC e erraria o dia à noite. */
function diaLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Uma aba que mostra outras dentro dela (ex.: CRM ARTHUR com o CRM IA LUIZA), com o seletor ao lado do título.
 * A aba escolhida fica na URL (?quadro=<id>), então o link e o F5 mantêm a aba; sem ?quadro, volta a última que a
 * pessoa escolheu. Cada aba é o LeadBoardsView inteiro dela (key = id): métricas, filtros e pesquisa nunca se
 * misturam, e trocar de aba começa limpo.
 */
export function AbasJuntasView({ pageId }: { pageId: string }) {
  const { profile } = useAuth()
  const pages = useLeadPages()
  const boards = useLeadBoards()
  const rows = useAllLeadRows()
  const [params, setParams] = useSearchParams()
  const chave = `comercial_aba_junta:${profile?.id ?? ''}:${pageId}`

  // Só as abas que a pessoa enxerga (a de dentro pode ter sido arquivada).
  const abas = React.useMemo(
    () => [pageId, ...(ABAS_JUNTAS[pageId] ?? [])].flatMap((id) => pages.find((p) => p.id === id) ?? []),
    [pageId, pages],
  )
  const valida = (id: string | null) => !!id && abas.some((a) => a.id === id)

  const pedida = params.get('quadro')
  let guardada: string | null = null
  try { guardada = window.localStorage.getItem(chave) } catch { /* ignore */ }
  const ativa = valida(pedida) ? pedida! : !pedida && valida(guardada) ? guardada! : pageId

  // Sem ?quadro e com outra aba guardada: põe na URL, pra o link copiado agora abrir a mesma aba.
  React.useEffect(() => {
    if (!pedida && ativa !== pageId) setParams((p) => { const n = new URLSearchParams(p); n.set('quadro', ativa); return n }, { replace: true })
  }, [pedida, ativa, pageId, setParams])

  const escolher = (id: string) => {
    try { window.localStorage.setItem(chave, id) } catch { /* ignore */ }
    setParams((p) => { const n = new URLSearchParams(p); n.set('quadro', id); return n })
  }

  // Cards que entraram hoje em cada aba de dentro.
  const entraramHoje = React.useMemo(() => {
    const hoje = todayKey()
    const out = new Map<string, number>()
    for (const id of ABAS_JUNTAS[pageId] ?? []) {
      const quadros = new Set(boards.filter((b) => b.page === id).map((b) => b.id))
      out.set(id, rows.filter((r) => quadros.has(r.boardId) && !r.deletedAt && diaLocal(r.createdAt) === hoje).length)
    }
    return out
  }, [pageId, boards, rows])

  const nomeDaTela = abas[0]?.name ?? '...'
  const seletor = abas.length > 1 ? (
    <div className="inline-flex shrink-0 self-center overflow-hidden rounded-lg border border-line" role="tablist">
      {abas.map((a) => {
        const novos = entraramHoje.get(a.id) ?? 0
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={a.id === ativa}
            onClick={() => escolher(a.id)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1 text-sm font-medium transition-colors',
              a.id === ativa ? 'bg-accent/10 text-accent' : 'text-foreground/50 hover:bg-elevate/[0.04]',
            )}
          >
            {a.name}
            {novos > 0 && (
              <span
                className="rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold leading-4 text-accent"
                title={`${novos} card(s) entraram hoje`}
              >
                {novos}
              </span>
            )}
          </button>
        )
      })}
    </div>
  ) : undefined

  return <LeadBoardsView key={ativa} page={ativa} tituloDaTela={nomeDaTela} aoLadoDoTitulo={seletor} />
}
