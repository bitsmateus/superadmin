import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { CamposDeHoras, CamposDoDesconto, minutosDo } from '@/components/pontos/LancamentoManualModal'
import {
  dataBr, DIAS_CURTOS, horas, pontosService, ROTULO_AJUSTE, rotuloDoAjuste,
  type AjustePonto, type DestinoDesconto, type DiaPonto, type TipoAjuste,
} from '@/services/pontos'

/** O que mais se usa, em palavras simples. O resto (abonar manhã, folga, feriado, converter em hora extra…) fica em "Ver outros ajustes". */
type Escolha = 'atestado_dia' | 'atestado_horas' | 'desconto' | 'corrigir_batidas' | `outro:${TipoAjuste}`
const PRINCIPAIS: { valor: Escolha; rotulo: string }[] = [
  { valor: 'atestado_dia', rotulo: 'Falta abonada com atestado (dia inteiro)' },
  { valor: 'atestado_horas', rotulo: 'Atestado de algumas horas (ex.: dentista)' },
  { valor: 'desconto', rotulo: 'Descontar horas do salário' },
  { valor: 'corrigir_batidas', rotulo: 'Corrigir batidas' },
]
const OUTROS: TipoAjuste[] = [
  'abonar_manha', 'abonar_tarde', 'abonar_falta', 'abonar_atraso', 'justificar', 'folga', 'compensacao', 'feriado',
  'perdoar_desconto', 'descontar_saldo', 'extra_banco', 'extra_pagamento',
]

/**
 * Ajuste manual de um dia (só admin): atestado (dia inteiro ou algumas horas), desconto de horas do salário, correção das batidas
 * e, em "Ver outros ajustes", os demais (abonos, folga, feriado, hora extra…). Motivo obrigatório; quem fez e quando ficam
 * registrados. A batida original nunca é apagada: a correção vale por cima dela.
 */
export function AjusteDiaModal({ dia, colaboradorId, colaboradorNome, ajustes, onClose, onSalvo }: {
  dia: DiaPonto | null
  colaboradorId: string
  colaboradorNome: string
  ajustes: AjustePonto[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [escolha, setEscolha] = React.useState<Escolha>('atestado_dia')
  const [verOutros, setVerOutros] = React.useState(false)
  const [motivo, setMotivo] = React.useState('')
  const [batidas, setBatidas] = React.useState('')
  const [h, setH] = React.useState('1')
  const [m, setM] = React.useState('0')
  const [destino, setDestino] = React.useState<DestinoDesconto>('dinheiro')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!dia) return
    // Já sugere o que costuma servir: falta -> atestado do dia; saiu mais cedo/chegou atrasado -> atestado das horas que faltaram.
    const faltou = dia.saldoMinutos < 0 ? -dia.saldoMinutos : 0
    setEscolha(dia.status === 'falta' ? 'atestado_dia' : faltou > 0 ? 'atestado_horas' : 'desconto')
    setH(faltou > 0 ? String(Math.floor(faltou / 60)) : '1')
    setM(faltou > 0 ? String(faltou % 60) : '0')
    setDestino('dinheiro')
    setVerOutros(false)
    setMotivo('')
    setBatidas(dia.batidas.join(' '))
  }, [dia])

  if (!dia) return null
  const doDia = ajustes.filter((a) => a.data === dia.data)
  const outroTipo = escolha.startsWith('outro:') ? (escolha.slice(6) as TipoAjuste) : null

  const salvar = async () => {
    if (!motivo.trim()) return toast.error('O motivo é obrigatório.')
    const minutos = minutosDo(h, m)
    const lista = batidas.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
    if (escolha === 'corrigir_batidas' && lista.some((x) => !/^\d{1,2}:\d{2}$/.test(x))) return toast.error('Batidas: use HH:MM separados por espaço.')
    if ((escolha === 'desconto' || escolha === 'atestado_horas') && (minutos < 1 || minutos > 12 * 60)) return toast.error('Informe as horas (de 1 minuto a 12 horas).')
    const pedido =
      escolha === 'atestado_dia' ? { tipo: 'atestado' as const }
      : escolha === 'atestado_horas' ? { tipo: 'atestado' as const, minutos }
      : escolha === 'desconto' ? { tipo: 'descontar_horas' as const, minutos, destino }
      : escolha === 'corrigir_batidas' ? { tipo: 'corrigir_batidas' as const, batidas: lista }
      : { tipo: outroTipo as TipoAjuste }
    setSalvando(true)
    try {
      await pontosService.criarAjuste({ colaboradorId, data: dia.data, motivo: motivo.trim(), ...pedido })
      toast.success('Ajuste registrado.')
      onSalvo()
      setMotivo('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const remover = async (a: AjustePonto) => {
    if (!window.confirm(`Remover o ajuste "${rotuloDoAjuste(a)}"? Fica registrado que você removeu.`)) return
    try { await pontosService.removerAjuste(a.id); onSalvo() } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal open onClose={onClose} title={`Ajustar ${dataBr(dia.data)} (${DIAS_CURTOS[dia.diaSemana]})`} description={colaboradorNome} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => void salvar()} disabled={salvando}>Registrar ajuste</Button></>}>
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-elevate/[0.04] p-3 sm:grid-cols-4">
          <Info r="Batidas" v={dia.batidasOriginais.join(' ') || '—'} />
          <Info r="Trabalhadas" v={horas(dia.trabalhadoMinutos)} />
          <Info r="Atraso + saída" v={horas(dia.atrasoMinutos + dia.saidaAntecipadaMinutos)} />
          <Info r="Extra" v={horas(dia.extraMinutos)} />
        </div>

        <label className="block text-xs font-medium text-foreground/70">
          O que ajustar
          <select value={escolha} onChange={(e) => setEscolha(e.target.value as Escolha)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground">
            {PRINCIPAIS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            {(verOutros || outroTipo) && (
              <optgroup label="Outros ajustes">
                {OUTROS.map((t) => <option key={t} value={`outro:${t}`}>{ROTULO_AJUSTE[t]}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {!verOutros && !outroTipo && (
          <button type="button" onClick={() => setVerOutros(true)} className="-mt-2 text-xs font-medium text-accent hover:underline">Ver outros ajustes</button>
        )}

        {escolha === 'atestado_dia' && <p className="text-xs text-foreground/50">A falta fica abonada: não desconta, não perde horas e não fica negativo no banco.</p>}
        {escolha === 'atestado_horas' && (
          <>
            <CamposDeHoras h={h} m={m} onH={setH} onM={setM} />
            <p className="text-xs text-foreground/50">Essas horas ficam abonadas: o que faltou no dia, até esse tempo, não desconta nem fica negativo.</p>
          </>
        )}
        {escolha === 'desconto' && <CamposDoDesconto h={h} m={m} destino={destino} onH={setH} onM={setM} onDestino={setDestino} />}
        {escolha === 'corrigir_batidas' && (
          <label className="block text-xs font-medium text-foreground/70">
            Batidas que valem (HH:MM separados por espaço; depois da meia-noite use 24h+, ex.: 26:10)
            <input value={batidas} onChange={(e) => setBatidas(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" />
          </label>
        )}
        <label className="block text-xs font-medium text-foreground/70">
          Motivo (obrigatório)
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" />
        </label>

        {doDia.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">Ajustes desse dia</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {doDia.map((a) => (
                <li key={a.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{rotuloDoAjuste(a)}{a.batidas ? `: ${a.batidas.join(' ')}` : ''}</p>
                    <p className="text-xs text-foreground/55">{a.motivo} · {a.autor} em {new Date(a.criadoEm).toLocaleString('pt-BR')}</p>
                  </div>
                  <button type="button" title="Remover ajuste" onClick={() => void remover(a)} className="rounded p-1 text-foreground/40 hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Info({ r, v }: { r: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-foreground/45">{r}</p>
      <p className="font-medium tabular-nums text-foreground">{v}</p>
    </div>
  )
}
