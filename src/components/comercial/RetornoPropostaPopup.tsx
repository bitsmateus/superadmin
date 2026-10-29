import * as React from 'react'
import { TelefoneAcoes } from '@/components/comercial/TelefoneAcoes'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { CalendarClock, MessageCircleOff, PhoneCall, Phone, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CurrencyField } from '@/components/comercial/CurrencyField'
import {
  MAXIMO_ADIAMENTOS, MAXIMO_EM_REUNIAO, MINIMO_MOTIVO_ADIAR, MINIMO_OBSERVACAO_RETORNO, MINIMO_OBSERVACAO_TENTATIVA, TENTATIVAS_PRA_FOLLOW_UP,
  retornosService, type PedidoDeRetorno, type RetornoPendente,
} from '@/services/retornos'
import { agendamentoLegivel } from '@/services/reunioes'
import {
  MINIMO_DETALHE_MOTIVO, MINIMO_OUTRO, MOTIVOS_DESQUALIFICACAO, ORIGENS_DO_LEAD, PREFIXO_ORIGEM_OUTROS, rotuloDaOrigem,
} from '@/lib/regraDoStatus'
import { formatBRLCents, parseBRLCents } from '@/lib/currency'
import { useTelaTravada } from '@/lib/telaTravada'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

const INTERVALO_MS = 60_000
const campoCls = 'w-full rounded-md border border-line bg-card px-2.5 py-2 text-sm text-foreground outline-none focus:border-accent/60'

const pad = (n: number) => String(n).padStart(2, '0')
/** Próximo dia útil, no mesmo horário do retorno que venceu (ou 10:00). */
function proximoDiaUtil(horaDe: string): { data: string; hora: string } {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return { data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hora: horaDe.slice(11, 16) || '10:00' }
}
const noFuturo = (data: string, hora: string) => !!data && !!hora && new Date(`${data}T${hora}:00-03:00`).getTime() > Date.now()

/**
 * Popup obrigatório do retorno da proposta (CRM LUIS CLOSER, só pro closer). Quando chega o dia e a hora do "Retornar"
 * de um card em Proposta enviada / Follow-up Propostas, abre em qualquer tela e só sai registrando: retornei (o que foi
 * conversado + fechou / ainda negociando / perdeu), tentei sem resposta (novo retorno) ou ainda não retornei (adiar,
 * até 2 vezes). Tudo vai pras Atualizações do card — quem decide o que é pendência é o servidor (routes/retornos.ts).
 * "Estou em reunião" tira o popup por 1h (todos os retornos da fila de uma vez), no máximo 2 vezes por retorno.
 */
export function RetornoPropostaPopup() {
  const [lista, setLista] = React.useState<RetornoPendente[]>([])
  const [feitos, setFeitos] = React.useState(0)
  const [passo, setPasso] = React.useState<'escolha' | 'retornou' | 'sem_resposta' | 'adiar'>('escolha')
  const [enviando, setEnviando] = React.useState(false)

  const carregar = React.useCallback(async () => {
    try {
      const novos = await retornosService.pendentes()
      setLista(novos)
      if (!novos.length) setFeitos(0)
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
  const atualId = atual?.card_id
  React.useEffect(() => { setPasso('escolha') }, [atualId])
  useTelaTravada(!!atual, 'retorno')

  const enviar = async (pedido: PedidoDeRetorno) => {
    if (!atual || enviando) return
    setEnviando(true)
    try {
      await retornosService.registrar(atual.card_id, pedido)
      toast.success('Retorno registrado nas Atualizações do card.')
      setFeitos((n) => n + 1)
      setLista((l) => l.filter((x) => x.card_id !== atual.card_id))
      void carregar()
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra registrar o retorno.')
      if ((err as { status?: number }).status === 409) void carregar()
    } finally {
      setEnviando(false)
    }
  }

  // Os da fila que ainda podem ser deixados pra daqui a 1h (o resto continua na tela).
  const adiaveisPorReuniao = lista.filter((x) => x.em_reuniao_usados < MAXIMO_EM_REUNIAO)
  const estouEmReuniao = async () => {
    if (!adiaveisPorReuniao.length || enviando) return
    setEnviando(true)
    try {
      const r = await retornosService.emReuniao(adiaveisPorReuniao.map((x) => x.card_id))
      const hora = new Date(r.volta_as).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      toast.success(`Beleza! ${r.escondidos.length > 1 ? `Os ${r.escondidos.length} retornos voltam` : 'O retorno volta'} às ${hora}.`)
      setLista((l) => l.filter((x) => !r.escondidos.includes(x.card_id)))
    } catch (err) {
      toast.error((err as Error).message || 'Não deu pra adiar agora.')
      void carregar()
    } finally {
      setEnviando(false)
    }
  }

  if (!atual) return null
  const contador = `${feitos + 1} de ${feitos + lista.length}`
  const podeAdiar = atual.adiamentos < MAXIMO_ADIAMENTOS
  const mrr = parseBRLCents(atual.valor_mrr)
  const impl = parseBRLCents(atual.valor_implementacao)

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div role="alertdialog" aria-modal="true" aria-labelledby="retorno-titulo"
        className="relative z-10 max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-warning">Retorno da proposta</p>
            <h2 id="retorno-titulo" className="mt-0.5 text-lg font-semibold text-foreground">{atual.nome || 'Lead sem nome'}</h2>
            {atual.empresa && <p className="text-sm text-foreground/60">{atual.empresa}</p>}
          </div>
          <span className="shrink-0 rounded-full bg-elevate/[0.06] px-2 py-0.5 text-xs font-medium text-foreground/60">{contador}</span>
        </div>

        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm text-foreground">
          <dt className="text-foreground/45">Retornar</dt>
          <dd><span className="font-medium">{agendamentoLegivel(atual.retornar)}</span> <span className="text-danger">· venceu {timeAgo(`${atual.retornar}:00-03:00`)}</span></dd>
          <dt className="text-foreground/45">Etapa</dt>
          <dd>{atual.coluna}{atual.crm_de_origem ? ` · veio do ${atual.crm_de_origem}` : ''}</dd>
          {atual.telefone && (<><dt className="text-foreground/45">Telefone</dt><dd className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5 text-foreground/40" />{atual.telefone}<TelefoneAcoes telefone={atual.telefone} /></dd></>)}
          <dt className="text-foreground/45">Proposta</dt>
          <dd>MRR {mrr ? formatBRLCents(mrr) : '—'} · Implementação {atual.valor_implementacao ? formatBRLCents(impl) : '—'}</dd>
          {atual.tentativas > 0 && (<><dt className="text-foreground/45">Tentativas</dt><dd>{atual.tentativas} sem resposta desde o último contato</dd></>)}
        </dl>
        {atual.resumo && (
          <p className="mt-3 line-clamp-3 rounded-lg bg-elevate/[0.04] px-3 py-2 text-sm text-foreground/70">
            <span className="text-foreground/45">Última atualização: </span>{atual.resumo}
          </p>
        )}

        {passo === 'escolha' && (
          <div className="mt-5">
            <p className="mb-2 text-sm text-foreground/70">Você retornou esse cliente? É obrigatório registrar pra continuar usando o app.</p>
            <div className="grid gap-2">
              <Opcao icone={<PhoneCall className="h-5 w-5 text-success" />} titulo="Retornei, falei com o cliente" onClick={() => setPasso('retornou')} />
              <Opcao icone={<MessageCircleOff className="h-5 w-5 text-warning" />} titulo="Tentei, mas o cliente não respondeu" onClick={() => setPasso('sem_resposta')} />
              <Opcao
                icone={<CalendarClock className="h-5 w-5 text-accent" />}
                titulo="Ainda não retornei (adiar)"
                detalhe={podeAdiar ? `Pode adiar mais ${MAXIMO_ADIAMENTOS - atual.adiamentos}x` : `Já adiado ${MAXIMO_ADIAMENTOS}x: agora é retornar ou registrar a tentativa`}
                desabilitada={!podeAdiar}
                onClick={() => setPasso('adiar')}
              />
            </div>
            <button type="button" onClick={estouEmReuniao} disabled={enviando || atual.em_reuniao_usados >= MAXIMO_EM_REUNIAO}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-foreground/70 transition-colors hover:border-accent/50 hover:text-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:text-foreground/70">
              <Users className="h-4 w-4" />
              <span>
                Estou em reunião, me lembra em 1h
                <span className="block text-xs text-foreground/50">
                  {atual.em_reuniao_usados >= MAXIMO_EM_REUNIAO
                    ? `Já usado ${MAXIMO_EM_REUNIAO}x neste retorno: agora é registrar`
                    : `${adiaveisPorReuniao.length > 1 ? `Vale pros ${adiaveisPorReuniao.length} retornos da fila · ` : ''}pode usar mais ${MAXIMO_EM_REUNIAO - atual.em_reuniao_usados}x`}
                </span>
              </span>
            </button>
          </div>
        )}
        {passo === 'retornou' && <Retornou atual={atual} enviando={enviando} onVoltar={() => setPasso('escolha')} onConcluir={enviar} />}
        {passo === 'sem_resposta' && <SemResposta atual={atual} enviando={enviando} onVoltar={() => setPasso('escolha')} onConcluir={enviar} />}
        {passo === 'adiar' && <Adiar atual={atual} enviando={enviando} onVoltar={() => setPasso('escolha')} onConcluir={enviar} />}
      </div>
    </div>,
    document.body,
  )
}

function Opcao({ icone, titulo, detalhe, desabilitada, onClick }: {
  icone: React.ReactNode; titulo: string; detalhe?: string; desabilitada?: boolean; onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={desabilitada}
      className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent/[0.04] focus-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent">
      {icone}
      <span>
        {titulo}
        {detalhe && <span className="block text-xs font-normal text-foreground/50">{detalhe}</span>}
      </span>
    </button>
  )
}

function NovaData({ data, hora, onData, onHora, rotulo = 'Próximo retorno' }: {
  data: string; hora: string; onData: (v: string) => void; onHora: (v: string) => void; rotulo?: string
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-foreground/50">{rotulo}</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={data} onChange={(e) => onData(e.target.value)} className={campoCls} aria-label={`${rotulo}: data`} />
        <input type="time" value={hora} onChange={(e) => onHora(e.target.value)} className={campoCls} aria-label={`${rotulo}: hora`} />
      </div>
    </div>
  )
}

function Rodape({ enviando, onVoltar, onConcluir, rotulo = 'Concluir' }: { enviando: boolean; onVoltar: () => void; onConcluir: () => void; rotulo?: string }) {
  return (
    <div className="flex justify-between gap-2 pt-1">
      <Button variant="ghost" onClick={onVoltar} disabled={enviando}>Voltar</Button>
      <Button loading={enviando} onClick={onConcluir}>{rotulo}</Button>
    </div>
  )
}

type Form = { atual: RetornoPendente; enviando: boolean; onVoltar: () => void; onConcluir: (p: PedidoDeRetorno) => void }

function Retornou({ atual, enviando, onVoltar, onConcluir }: Form) {
  const sugestao = proximoDiaUtil(atual.retornar)
  const [obs, setObs] = React.useState('')
  const [desfecho, setDesfecho] = React.useState<'' | 'fechou' | 'negociando' | 'perdeu'>('')
  const [data, setData] = React.useState(sugestao.data)
  const [hora, setHora] = React.useState(sugestao.hora)
  const [motivo, setMotivo] = React.useState('')
  const [detalhe, setDetalhe] = React.useState('')
  const [mrr, setMrr] = React.useState(atual.valor_mrr)
  const [impl, setImpl] = React.useState(atual.valor_implementacao)
  const origemConhecida = (ORIGENS_DO_LEAD.some((o) => o.valor === atual.origem) || atual.origem.startsWith(PREFIXO_ORIGEM_OUTROS)) ? atual.origem : ''
  const [origem, setOrigem] = React.useState(origemConhecida.startsWith(PREFIXO_ORIGEM_OUTROS) ? 'outros' : origemConhecida)
  const [origemOutros, setOrigemOutros] = React.useState(origemConhecida.startsWith(PREFIXO_ORIGEM_OUTROS) ? origemConhecida.slice(PREFIXO_ORIGEM_OUTROS.length) : '')
  const [tentou, setTentou] = React.useState(false)
  const origemFinal = origem === 'outros' ? `${PREFIXO_ORIGEM_OUTROS}${origemOutros.trim()}` : origem

  const falta = obs.trim().length < MINIMO_OBSERVACAO_RETORNO ? `Escreva o que foi conversado (mínimo ${MINIMO_OBSERVACAO_RETORNO} caracteres).`
    : !desfecho ? 'Escolha como ficou.'
    : desfecho === 'negociando' && !noFuturo(data, hora) ? 'O próximo retorno tem que ser no futuro.'
    : desfecho === 'perdeu' && !motivo ? 'Escolha o motivo da perda.'
    : desfecho === 'perdeu' && detalhe.trim().length < MINIMO_DETALHE_MOTIVO ? `Detalhe o motivo (mínimo ${MINIMO_DETALHE_MOTIVO} caracteres).`
    : desfecho === 'fechou' && !/\d/.test(mrr) ? 'Informe o valor MRR fechado.'
    : desfecho === 'fechou' && !/\d/.test(impl) ? 'Informe o valor de implementação (R$ 0,00 também vale).'
    : desfecho === 'fechou' && (!origem || (origem === 'outros' && origemOutros.trim().length < MINIMO_OUTRO)) ? 'Informe a origem do lead.'
    : ''

  return (
    <div className="mt-5 space-y-3">
      <label className="block text-xs text-foreground/50">
        O que foi conversado ({obs.trim().length}/{MINIMO_OBSERVACAO_RETORNO})
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} autoFocus
          placeholder="Ex.: falei com ele, quer ajustar o plano pra 3 atendentes…" className={cn(campoCls, 'mt-0.5 resize-y')} />
      </label>
      <div>
        <p className="mb-1 text-xs text-foreground/50">Como ficou?</p>
        <div className="grid grid-cols-3 gap-2">
          {([['fechou', 'Fechou'], ['negociando', 'Ainda negociando'], ['perdeu', 'Perdeu']] as const).map(([v, r]) => (
            <button key={v} type="button" onClick={() => setDesfecho(v)}
              className={cn('rounded-lg border px-2 py-2 text-sm font-medium', desfecho === v ? 'border-accent/60 bg-accent/[0.06] text-accent' : 'border-line text-foreground hover:bg-elevate/[0.03]')}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {desfecho === 'negociando' && <NovaData data={data} hora={hora} onData={setData} onHora={setHora} />}
      {desfecho === 'perdeu' && (
        <div className="space-y-2">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campoCls} aria-label="Motivo da perda">
            <option value="">Motivo da perda…</option>
            {MOTIVOS_DESQUALIFICACAO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <textarea value={detalhe} onChange={(e) => setDetalhe(e.target.value)} rows={2} placeholder="Detalhe o motivo" className={campoCls} />
        </div>
      )}
      {desfecho === 'fechou' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {/* O campo de valor ocupa a altura toda do pai: a caixa de altura fixa segura ele (senão passa por cima do texto de baixo). */}
            <label className="block text-xs text-foreground/50">Valor MRR
              <div className="mt-0.5 h-10"><CurrencyField value={mrr} onSave={setMrr} className={campoCls} /></div>
            </label>
            <label className="block text-xs text-foreground/50">Valor implementação
              <div className="mt-0.5 h-10"><CurrencyField value={impl} onSave={setImpl} className={campoCls} /></div>
            </label>
          </div>
          {!origemConhecida && (
            <label className="block text-xs text-foreground/50">De onde o lead veio?
              <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={cn(campoCls, 'mt-0.5')}>
                <option value="">Escolha a origem…</option>
                {ORIGENS_DO_LEAD.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
              </select>
              {origem === 'outros' && <input value={origemOutros} onChange={(e) => setOrigemOutros(e.target.value)} placeholder="De onde?" className={cn(campoCls, 'mt-1')} />}
            </label>
          )}
          {origemConhecida && <p className="text-xs text-foreground/45">Origem: {rotuloDaOrigem(origemConhecida)}</p>}
          <p className="text-xs text-foreground/45">O card vai pra Vendido e a venda é registrada como sempre.</p>
        </div>
      )}
      {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      <Rodape enviando={enviando} onVoltar={onVoltar} onConcluir={() => {
        setTentou(true)
        if (falta || !desfecho) return
        onConcluir({
          resultado: 'retornou', observacao: obs.trim(), desfecho,
          ...(desfecho === 'negociando' ? { retornar_novo: `${data}T${hora}` } : {}),
          ...(desfecho === 'perdeu' ? { motivo, motivo_detalhe: detalhe.trim() } : {}),
          ...(desfecho === 'fechou' ? { valor_mrr: mrr, valor_implementacao: impl, origem: origemFinal } : {}),
        })
      }} />
    </div>
  )
}

function SemResposta({ atual, enviando, onVoltar, onConcluir }: Form) {
  const sugestao = proximoDiaUtil(atual.retornar)
  const [obs, setObs] = React.useState('')
  const [data, setData] = React.useState(sugestao.data)
  const [hora, setHora] = React.useState(sugestao.hora)
  const ehAUltima = atual.tentativas + 1 >= TENTATIVAS_PRA_FOLLOW_UP
  const [followUp, setFollowUp] = React.useState(true)
  const [tentou, setTentou] = React.useState(false)
  const falta = obs.trim().length < MINIMO_OBSERVACAO_TENTATIVA ? `Diga por onde tentou (mínimo ${MINIMO_OBSERVACAO_TENTATIVA} caracteres).`
    : !noFuturo(data, hora) ? 'O próximo retorno tem que ser no futuro.' : ''
  return (
    <div className="mt-5 space-y-3">
      <label className="block text-xs text-foreground/50">
        Por onde tentou? ({atual.tentativas + 1}ª tentativa)
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} autoFocus
          placeholder="Ex.: mandei no WhatsApp e liguei 2x" className={cn(campoCls, 'mt-0.5')} />
      </label>
      <NovaData data={data} hora={hora} onData={setData} onHora={setHora} />
      {ehAUltima && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-warning/40 bg-warning/[0.06] px-3 py-2 text-sm text-foreground">
          <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="mt-0.5" />
          <span>Já são {atual.tentativas + 1} tentativas sem resposta: mandar pro <b>Follow-up Propostas</b> (a régua de follow-up assume).</span>
        </label>
      )}
      {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      <Rodape enviando={enviando} onVoltar={onVoltar} onConcluir={() => {
        setTentou(true)
        if (falta) return
        onConcluir({ resultado: 'sem_resposta', observacao: obs.trim(), retornar_novo: `${data}T${hora}`, mover_follow_up: ehAUltima && followUp })
      }} />
    </div>
  )
}

function Adiar({ atual, enviando, onVoltar, onConcluir }: Form) {
  const sugestao = proximoDiaUtil(atual.retornar)
  const [obs, setObs] = React.useState('')
  const [data, setData] = React.useState(sugestao.data)
  const [hora, setHora] = React.useState(sugestao.hora)
  const [tentou, setTentou] = React.useState(false)
  const falta = obs.trim().length < MINIMO_MOTIVO_ADIAR ? `Diga por que vai adiar (mínimo ${MINIMO_MOTIVO_ADIAR} caracteres).`
    : !noFuturo(data, hora) ? 'O novo horário tem que ser no futuro.' : ''
  return (
    <div className="mt-5 space-y-3">
      <NovaData data={data} hora={hora} onData={setData} onHora={setHora} rotulo="Retornar em" />
      <label className="block text-xs text-foreground/50">
        Por que vai adiar? ({MAXIMO_ADIAMENTOS - atual.adiamentos - 1} adiamento(s) restante(s) depois deste)
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: cliente pediu pra falar na quinta" className={cn(campoCls, 'mt-0.5')} />
      </label>
      {tentou && falta && <p className="text-xs text-danger">{falta}</p>}
      <Rodape enviando={enviando} onVoltar={onVoltar} rotulo="Adiar" onConcluir={() => {
        setTentou(true)
        if (falta) return
        onConcluir({ resultado: 'adiar', observacao: obs.trim(), retornar_novo: `${data}T${hora}` })
      }} />
    </div>
  )
}
