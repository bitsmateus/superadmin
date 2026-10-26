import * as React from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { CalendarClock, CalendarX2, CheckCircle2, Circle, ExternalLink, Phone, Video } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LeadDetailModal } from '@/components/comercial/LeadDetailModal'
import { MotivoComOutro } from '@/components/comercial/LeadOrigemBlock'
import { useLeadRow } from '@/hooks/useLeadBoards'
import { leadBoardsService } from '@/services/leadBoards'
import {
  ETAPAS_COMPARECEU, MINIMO_RESUMO, MOTIVOS_NAO_COMPARECEU, agendamentoLegivel, reunioesService,
  type PedidoDeResultado, type ReuniaoPendente,
} from '@/services/reunioes'
import { motivoValido } from '@/lib/regraDoStatus'
import { cn } from '@/lib/utils'
import { useTelaTravada } from '@/lib/telaTravada'

const INTERVALO_MS = 90_000

/**
 * Popup obrigatório de resultado da reunião (layout global). Busca as pendências ao abrir o app, a cada 1min30 e ao
 * voltar pra aba; mostra uma por vez ("1 de 3") e só sai escolhendo Compareceu, Não compareceu ou Remarcar e
 * concluindo o que a opção pede. Quem decide o que é pendência é o servidor (routes/reunioes.ts).
 */
export function ReuniaoResultadoPopup() {
  const [lista, setLista] = React.useState<ReuniaoPendente[]>([])
  const [feitas, setFeitas] = React.useState(0)
  const [passo, setPasso] = React.useState<'escolha' | 'compareceu' | 'nao' | 'remarcar'>('escolha')
  const [enviando, setEnviando] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const novas = await reunioesService.pendentes()
      setLista(novas)
      if (!novas.length) setFeitas(0)
    } catch { /* sem rede: tenta de novo no próximo ciclo */ }
  }, [])

  React.useEffect(() => {
    void carregar()
    const timer = window.setInterval(() => { void carregar() }, INTERVALO_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') void carregar() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', aoVoltar) }
  }, [carregar])

  const atual = lista[0]
  // Se a reunião da tela sumiu da lista (outra pessoa resolveu), recomeça na escolha da próxima.
  const atualId = atual?.card_id
  React.useEffect(() => { setPasso('escolha') }, [atualId])
  useTelaTravada(!!atual, 'reuniao')

  const enviar = async (pedido: PedidoDeResultado) => {
    if (!atual || enviando) return
    setEnviando(true)
    try {
      // A ficha salva cada campo ao sair dele: dá tempo do último salvamento chegar antes de concluir.
      await new Promise((r) => window.setTimeout(r, 500))
      await reunioesService.registrar(atual.card_id, pedido)
      toast.success('Resultado da reunião registrado.')
      setFeitas((n) => n + 1)
      setLista((l) => l.filter((x) => x.card_id !== atual.card_id))
      void carregar()
    } catch (err) {
      const status = (err as { status?: number }).status
      toast.error((err as Error).message || 'Não deu pra registrar o resultado.')
      if (status === 409) void carregar()
    } finally {
      setEnviando(false)
    }
  }

  if (!atual) return null
  const contador = `${feitas + 1} de ${feitas + lista.length}`

  if (passo === 'compareceu') {
    return <CompareceuNaFicha reuniao={atual} contador={contador} enviando={enviando} onConcluir={enviar} />
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="reuniao-titulo"
        className="relative z-10 max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-warning">Resultado da reunião</p>
            <h2 id="reuniao-titulo" className="mt-0.5 text-lg font-semibold text-foreground">{atual.nome || 'Lead sem nome'}</h2>
            {atual.empresa && <p className="text-sm text-foreground/60">{atual.empresa}</p>}
          </div>
          <span className="shrink-0 rounded-full bg-elevate/[0.06] px-2 py-0.5 text-xs font-medium text-foreground/60">{contador}</span>
        </div>

        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-foreground/45">Agendada</dt>
          <dd className="font-medium text-foreground">{agendamentoLegivel(atual.agendamento)}</dd>
          <dt className="text-foreground/45">CRM</dt>
          <dd className="text-foreground">{atual.crm}{atual.crm_do_card !== atual.crm ? ` · card no ${atual.crm_do_card}` : ''}</dd>
          {atual.telefone && (<><dt className="text-foreground/45">Telefone</dt><dd className="inline-flex items-center gap-1 text-foreground"><Phone className="h-3.5 w-3.5 text-foreground/40" />{atual.telefone}</dd></>)}
          {atual.link && (
            <>
              <dt className="text-foreground/45">Link</dt>
              <dd><a href={atual.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline"><Video className="h-3.5 w-3.5" />Abrir reunião<ExternalLink className="h-3 w-3" /></a></dd>
            </>
          )}
        </dl>
        {(atual.dor || atual.resumo) && (
          <div className="mt-3 space-y-1 rounded-lg bg-elevate/[0.04] px-3 py-2 text-sm text-foreground">
            {atual.dor && <p><span className="text-foreground/45">Dor: </span>{atual.dor}</p>}
            {atual.resumo && <p className="line-clamp-3 text-foreground/70"><span className="text-foreground/45">Última atualização: </span>{atual.resumo}</p>}
          </div>
        )}

        {passo === 'escolha' && (
          <div className="mt-5">
            <p className="mb-2 text-sm text-foreground/70">Como foi a reunião? É obrigatório responder pra continuar usando o app.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Opcao icone={<CheckCircle2 className="h-5 w-5 text-success" />} titulo="Compareceu" onClick={() => setPasso('compareceu')} />
              <Opcao icone={<CalendarX2 className="h-5 w-5 text-danger" />} titulo="Não compareceu" onClick={() => setPasso('nao')} />
              <Opcao icone={<CalendarClock className="h-5 w-5 text-accent" />} titulo="Remarcar" onClick={() => setPasso('remarcar')} />
            </div>
          </div>
        )}
        {passo === 'nao' && <NaoCompareceu enviando={enviando} onVoltar={() => setPasso('escolha')} onConcluir={enviar} />}
        {passo === 'remarcar' && <Remarcar atual={atual.agendamento} enviando={enviando} onVoltar={() => setPasso('escolha')} onConcluir={enviar} />}
      </div>
    </div>,
    document.body,
  )
}

function Opcao({ icone, titulo, onClick }: { icone: React.ReactNode; titulo: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-line px-3 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/[0.04] focus-ring">
      {icone}{titulo}
    </button>
  )
}

const campoCls = 'w-full rounded-md border border-line bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent/60'

function NaoCompareceu({ enviando, onVoltar, onConcluir }: {
  enviando: boolean; onVoltar: () => void; onConcluir: (p: PedidoDeResultado) => void
}) {
  const [motivo, setMotivo] = React.useState('')
  const [outro, setOutro] = React.useState('')
  const [obs, setObs] = React.useState('')
  const [tentou, setTentou] = React.useState(false)
  const falta = !motivo ? 'Escolha o motivo.' : motivo === 'Outro' && outro.trim().length < 5 ? 'Escreva o motivo (mínimo 5 caracteres).' : ''
  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm font-medium text-foreground">Por que o lead não compareceu?</p>
      <div className="space-y-1.5">
        {MOTIVOS_NAO_COMPARECEU.map((m) => (
          <label key={m} className={cn('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', motivo === m ? 'border-accent/60 bg-accent/[0.05]' : 'border-line hover:bg-elevate/[0.03]')}>
            <input type="radio" name="motivo-nao" checked={motivo === m} onChange={() => setMotivo(m)} />
            {m}
          </label>
        ))}
      </div>
      {motivo === 'Outro' && <input autoFocus value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Qual foi o motivo?" className={campoCls} />}
      <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Observação (opcional)" className={campoCls} />
      {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      <p className="text-xs text-foreground/45">O card vai pra "Reunião não comparecida" e o motivo fica nas Atualizações.</p>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onVoltar} disabled={enviando}>Voltar</Button>
        <Button loading={enviando} onClick={() => {
          setTentou(true)
          if (!falta) onConcluir({ resultado: 'nao_compareceu', motivo, motivo_outro: outro.trim(), resumo: obs.trim() })
        }}>Concluir</Button>
      </div>
    </div>
  )
}

function Remarcar({ atual, enviando, onVoltar, onConcluir }: {
  atual: string; enviando: boolean; onVoltar: () => void; onConcluir: (p: PedidoDeResultado) => void
}) {
  const [data, setData] = React.useState(atual.slice(0, 10))
  const [hora, setHora] = React.useState('')
  const [motivo, setMotivo] = React.useState('')
  const [tentou, setTentou] = React.useState(false)
  const quando = data && hora ? new Date(`${data}T${hora}:00-03:00`) : null
  const falta = !data || !hora ? 'Informe a nova data e a nova hora.'
    : !quando || Number.isNaN(quando.getTime()) ? 'Data ou hora inválida.'
    : quando.getTime() <= Date.now() ? 'O novo horário tem que ser no futuro.' : ''
  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm font-medium text-foreground">Novo horário da reunião</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-foreground/50">Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} className={cn(campoCls, 'mt-0.5')} /></label>
        <label className="text-xs text-foreground/50">Hora<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={cn(campoCls, 'mt-0.5')} /></label>
      </div>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo da remarcação (opcional)" className={campoCls} />
      {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      <p className="text-xs text-foreground/45">O card continua em "Reunião agendada" com o novo horário. Se passar 1h dele sem resultado, este aviso volta.</p>
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={onVoltar} disabled={enviando}>Voltar</Button>
        <Button loading={enviando} onClick={() => {
          setTentou(true)
          if (!falta) onConcluir({ resultado: 'remarcada', agendamento_novo: `${data}T${hora}`, motivo: motivo.trim() })
        }}>Remarcar</Button>
      </div>
    </div>
  )
}

/**
 * "Compareceu": a ficha normal do card, sem como fechar, com o que falta pra concluir em cima. Os campos da ficha
 * (nº de atendentes, valores, Retornar, motivo) salvam no card como sempre; aqui só se escolhe a próxima etapa e se
 * escreve o resumo, e o "Concluir" só libera com tudo preenchido (o servidor confere de novo).
 */
function CompareceuNaFicha({ reuniao, contador, enviando, onConcluir }: {
  reuniao: ReuniaoPendente; contador: string; enviando: boolean; onConcluir: (p: PedidoDeResultado) => void
}) {
  const row = useLeadRow(reuniao.card_id)
  const [etapa, setEtapa] = React.useState('')
  const [resumo, setResumo] = React.useState('')
  const [tentou, setTentou] = React.useState(false)

  if (!row) {
    // A linha ainda não chegou na tela (ou a pessoa não enxerga esse quadro): sem ficha não há o que preencher.
    return createPortal(
      <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4">
        <div className="max-w-sm rounded-2xl border border-line bg-card p-5 text-center text-sm text-foreground/70">
          Carregando a ficha de {reuniao.nome || 'lead'}…
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => window.location.reload()}>Recarregar a página</Button>
        </div>
      </div>,
      document.body,
    )
  }

  const pedeRetorno = /proposta/i.test(etapa)
  const pedeMotivo = /perdido|desqualificado/i.test(etapa)
  const itens: { ok: boolean; rotulo: string }[] = [
    { ok: resumo.trim().length >= MINIMO_RESUMO, rotulo: `Resumo (${resumo.trim().length}/${MINIMO_RESUMO})` },
    { ok: !!row.numeroAtendentes.trim(), rotulo: 'Nº atendentes' },
    { ok: /\d/.test(row.valorImplementacao), rotulo: 'Valor Implementação' },
    { ok: /\d/.test(row.valorMrr), rotulo: 'Valor MRR' },
    { ok: !!etapa, rotulo: 'Próxima etapa' },
    ...(pedeRetorno ? [{ ok: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(row.retornar), rotulo: 'Retornar' }] : []),
    ...(pedeMotivo ? [{ ok: motivoValido(row.motivoDesqualificacao), rotulo: 'Motivo' }] : []),
    // Origem vazia não passa de "Primeiro contato" (o servidor recusa mover o card): fica no bloco Origem da ficha.
    ...(!row.metaLeadId ? [{ ok: !!row.origem.trim(), rotulo: 'Origem' }] : []),
  ]
  const pronto = itens.every((i) => i.ok)

  const topo = (
    <div className="border-b border-line bg-success/[0.06] px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          <CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />
          O lead compareceu à reunião de {agendamentoLegivel(reuniao.agendamento)}. Preencha pra concluir.
        </p>
        <span className="rounded-full bg-elevate/[0.06] px-2 py-0.5 text-xs font-medium text-foreground/60">{contador}</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[220px,1fr]">
        <div className="space-y-2">
          <label className="block text-[11px] text-foreground/50">
            Próxima etapa
            <select value={etapa} onChange={(e) => setEtapa(e.target.value)} className={cn(campoCls, 'mt-0.5')}>
              <option value="">Selecionar…</option>
              {ETAPAS_COMPARECEU.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          {pedeMotivo && (
            <MotivoComOutro valor={row.motivoDesqualificacao} onChange={(v) => leadBoardsService.updateRow(row.id, { motivoDesqualificacao: v })} />
          )}
        </div>
        <label className="block text-[11px] text-foreground/50">
          Resumo da reunião (vai nas Atualizações)
          <textarea value={resumo} onChange={(e) => setResumo(e.target.value)} rows={3}
            placeholder="O que foi conversado, o que o lead precisa, próximos passos…" className={cn(campoCls, 'mt-0.5 resize-y')} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-1.5 text-xs">
          {itens.map((i) => (
            <li key={i.rotulo} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5', i.ok ? 'bg-success/10 text-success' : tentou ? 'bg-danger/10 text-danger' : 'bg-elevate/[0.06] text-foreground/55')}>
              {i.ok ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}{i.rotulo}
            </li>
          ))}
        </ul>
        <Button loading={enviando} onClick={() => {
          setTentou(true)
          if (!pronto) { toast.error('Preencha o que está em vermelho (nº de atendentes, valores e Retornar ficam na ficha abaixo).'); return }
          onConcluir({ resultado: 'compareceu', resumo: resumo.trim(), proxima_etapa: etapa })
        }}>Concluir reunião</Button>
      </div>
    </div>
  )

  return <LeadDetailModal leadRowId={row.id} onClose={() => {}} obrigatorio={{ topo }} />
}
