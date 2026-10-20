import * as React from 'react'
import { BellRing, ClipboardCheck } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { registrarPedidoDeDadoDoStatus, type PedidoDeDadoDoStatus, type RespostaDoPedido } from '@/services/leadBoards'
import {
  MINIMO_DETALHE_MOTIVO, MINIMO_OUTRO, MOTIVOS_DESQUALIFICACAO, ORIGENS_DO_LEAD, PREFIXO_ORIGEM_OUTROS, campoOk,
  juntarMotivo, origemEhOutros, separarMotivo, textoDaOrigemOutros, type CampoDoPopup,
} from '@/lib/regraDoStatus'
import { prettifyCurrencyRaw, sanitizeCurrencyRaw } from '@/lib/currency'
import { cn } from '@/lib/utils'

type Pedido = PedidoDeDadoDoStatus & { responder: (resposta: RespostaDoPedido | null) => void }

const ROTULO: Record<CampoDoPopup, string> = {
  agendamento: 'Dia e horário da reunião',
  retornar: 'Dia e horário do retorno',
  origem: 'De onde o lead veio?',
  valorMrr: 'Valor MRR',
  valorImplementacao: 'Valor de implementação',
  motivoDesqualificacao: 'Motivo da desqualificação',
}

const campoCls = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-foreground outline-none focus:border-accent'

/**
 * Popup único (montado no Layout) que pede o que falta pra mudar o status de um lead: dia e horário da reunião,
 * do retorno, origem, valores (MRR/implementação) e o motivo da desqualificação. Só aparecem os campos que faltam;
 * sem preencher todos, não confirma — e o lead fica onde estava. Vários pedidos (mover em lote) entram numa fila.
 */
export function PopupDadosDoStatus() {
  const [fila, setFila] = React.useState<Pedido[]>([])
  const atual = fila[0] ?? null
  // Rascunho de cada campo, no formato da tela (data/hora separados, valor em "1.234,56", motivo + texto do "Outro").
  const [data, setData] = React.useState<Record<string, string>>({})
  const [hora, setHora] = React.useState<Record<string, string>>({})
  const [texto, setTexto] = React.useState<Record<string, string>>({})
  const [outro, setOutro] = React.useState('')
  const [origemOutros, setOrigemOutros] = React.useState('')
  // Só depois de tentar confirmar é que o aviso do detalhe curto aparece.
  const [tentou, setTentou] = React.useState(false)

  React.useEffect(
    () => registrarPedidoDeDadoDoStatus((p) => new Promise<RespostaDoPedido | null>((responder) => setFila((f) => [...f, { ...p, responder }]))),
    [],
  )

  React.useEffect(() => {
    if (!atual) return
    const d: Record<string, string> = {}, h: Record<string, string> = {}, tx: Record<string, string> = {}
    let o = ''
    let oo = ''
    for (const c of atual.campos) {
      const v = atual.valores[c] ?? ''
      if (c === 'agendamento' || c === 'retornar') {
        const [dia, hr] = v.split('T')
        d[c] = /^\d{4}-\d{2}-\d{2}$/.test(dia ?? '') ? dia : ''
        h[c] = /^\d{2}:\d{2}/.test(hr ?? '') ? hr.slice(0, 5) : ''
      } else if (c === 'valorMrr' || c === 'valorImplementacao') {
        tx[c] = v ? sanitizeCurrencyRaw(v) : ''
      } else if (c === 'motivoDesqualificacao') {
        const { motivo, detalhe } = separarMotivo(v)
        tx[c] = (MOTIVOS_DESQUALIFICACAO as readonly string[]).includes(motivo) ? motivo : ''
        o = detalhe
      } else if (c === 'origem' && origemEhOutros(v)) {
        tx[c] = 'outros'
        oo = textoDaOrigemOutros(v)
      } else {
        tx[c] = v
      }
    }
    setData(d); setHora(h); setTexto(tx); setOutro(o); setOrigemOutros(oo); setTentou(false)
  }, [atual])

  if (!atual) return null

  const valorFinal = (c: CampoDoPopup): string => {
    if (c === 'agendamento' || c === 'retornar') return data[c] && hora[c] ? `${data[c]}T${hora[c]}` : ''
    if (c === 'valorMrr' || c === 'valorImplementacao') return texto[c] ? prettifyCurrencyRaw(texto[c]) : ''
    if (c === 'motivoDesqualificacao') return juntarMotivo(texto[c] ?? '', outro)
    if (c === 'origem') return texto[c] === 'outros' ? `${PREFIXO_ORIGEM_OUTROS}${origemOutros.trim()}` : (texto[c] ?? '')
    return texto[c] ?? ''
  }
  const pronto = atual.campos.every((c) => campoOk(c, valorFinal(c)))
  // O botão libera quando tudo foi escolhido — o tamanho do detalhe do motivo só é cobrado ao tentar confirmar.
  const podeTentar = atual.campos.every((c) => (c === 'motivoDesqualificacao' ? !!texto[c] && !!outro.trim() : campoOk(c, valorFinal(c))))
  const detalheCurto = atual.campos.includes('motivoDesqualificacao') && outro.trim().length < MINIMO_DETALHE_MOTIVO
  const fechar = (resposta: RespostaDoPedido | null) => {
    atual.responder(resposta)
    setFila((f) => f.slice(1))
  }
  const confirmar = () => {
    if (!pronto) { setTentou(true); return }
    fechar(Object.fromEntries(atual.campos.map((c) => [c, valorFinal(c)])) as RespostaDoPedido)
  }

  return (
    <Modal
      open
      onClose={() => fechar(null)}
      size="sm"
      title={`Pra marcar como ${atual.status}`}
      description={`"${atual.nome}" — preencha o que falta. Sem isso o lead não muda de status.`}
      footer={
        <>
          <Button variant="ghost" onClick={() => fechar(null)}>Cancelar</Button>
          <Button disabled={!podeTentar} onClick={confirmar}>Confirmar</Button>
        </>
      }
    >
      <div className="space-y-3.5" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') confirmar() }}>
        <div className="flex items-center gap-2 rounded-lg bg-accent/[0.06] px-3 py-2 text-xs text-foreground/70">
          <ClipboardCheck className="h-4 w-4 shrink-0 text-accent" />
          Todos os campos abaixo são obrigatórios.
        </div>
        {atual.campos.map((c, i) => (
          <div key={c}>
            <span className="mb-1 block text-xs font-medium text-foreground/70">{ROTULO[c]} *</span>
            {(c === 'agendamento' || c === 'retornar') && (
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={data[c] ?? ''} autoFocus={i === 0} onChange={(e) => setData((x) => ({ ...x, [c]: e.target.value }))} className={campoCls} aria-label={`${ROTULO[c]}: dia`} />
                <input type="time" value={hora[c] ?? ''} onChange={(e) => setHora((x) => ({ ...x, [c]: e.target.value }))} className={campoCls} aria-label={`${ROTULO[c]}: horário`} />
              </div>
            )}
            {c === 'agendamento' && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs font-medium text-warning">
                <BellRing className="mt-px h-3.5 w-3.5 shrink-0" />
                Não esqueça de enviar o link pro lead e colocar na agenda.
              </p>
            )}
            {c === 'origem' && (
              <>
                <select value={texto[c] ?? ''} autoFocus={i === 0} onChange={(e) => setTexto((x) => ({ ...x, [c]: e.target.value }))} className={campoCls}>
                  <option value="">Escolha a origem…</option>
                  {ORIGENS_DO_LEAD.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
                {texto[c] === 'outros' && (
                  <>
                    <input
                      value={origemOutros}
                      onChange={(e) => setOrigemOutros(e.target.value)}
                      placeholder={`De onde ele veio? (mínimo ${MINIMO_OUTRO} letras)`}
                      className={`${campoCls} mt-2`}
                    />
                    {origemOutros.trim().length > 0 && origemOutros.trim().length < MINIMO_OUTRO && (
                      <span className="mt-1 block text-xs text-warning">Faltam {MINIMO_OUTRO - origemOutros.trim().length} letra(s).</span>
                    )}
                  </>
                )}
              </>
            )}
            {(c === 'valorMrr' || c === 'valorImplementacao') && (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground/45">R$</span>
                <input
                  inputMode="decimal"
                  value={texto[c] ?? ''}
                  autoFocus={i === 0}
                  placeholder="0,00"
                  onChange={(e) => setTexto((x) => ({ ...x, [c]: sanitizeCurrencyRaw(e.target.value) }))}
                  className={`${campoCls} pl-9`}
                />
              </div>
            )}
            {c === 'motivoDesqualificacao' && (
              <>
                <select value={texto[c] ?? ''} autoFocus={i === 0} onChange={(e) => setTexto((x) => ({ ...x, [c]: e.target.value }))} className={campoCls}>
                  <option value="">Escolha o motivo…</option>
                  {MOTIVOS_DESQUALIFICACAO.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {!!texto[c] && (
                  <>
                    <span className="mb-1 mt-2.5 block text-xs font-medium text-foreground/70">Detalhe a desqualificação *</span>
                    <textarea
                      value={outro}
                      onChange={(e) => setOutro(e.target.value)}
                      rows={3}
                      placeholder="Ex.: o cliente quer pagar menos de R$ 100 por mês"
                      className={cn(
                        'w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent',
                        tentou && detalheCurto ? 'border-warning' : 'border-line',
                      )}
                    />
                    {tentou && detalheCurto && (
                      <span className="mt-1 block text-xs text-warning">Detalhe um pouco mais (mínimo de {MINIMO_DETALHE_MOTIVO} caracteres).</span>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        ))}
        {fila.length > 1 && <p className="text-xs text-foreground/45">Depois deste, mais {fila.length - 1} lead(s) pra preencher.</p>}
      </div>
    </Modal>
  )
}
