import * as React from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  dataBr, DIAS_CURTOS, horas, pontosService, ROTULO_AJUSTE,
  type AjustePonto, type DiaPonto, type TipoAjuste,
} from '@/services/pontos'

/**
 * Ajuste manual de um dia (só admin): abono, justificativa, folga/compensação, feriado, perdão do desconto, destino da
 * hora extra ou correção das batidas. Motivo obrigatório; quem fez e quando ficam registrados. A batida original nunca
 * é apagada: a correção vale por cima dela.
 */
export function AjusteDiaModal({ dia, colaboradorId, colaboradorNome, ajustes, onClose, onSalvo }: {
  dia: DiaPonto | null
  colaboradorId: string
  colaboradorNome: string
  ajustes: AjustePonto[]
  onClose: () => void
  onSalvo: () => void
}) {
  const [tipo, setTipo] = React.useState<TipoAjuste>('abonar_atraso')
  const [motivo, setMotivo] = React.useState('')
  const [batidas, setBatidas] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!dia) return
    setTipo(dia.status === 'falta' ? 'abonar_falta' : dia.extraMinutos > 0 ? 'extra_pagamento' : 'abonar_atraso')
    setMotivo('')
    setBatidas(dia.batidas.join(' '))
  }, [dia])

  if (!dia) return null
  const doDia = ajustes.filter((a) => a.data === dia.data)

  const salvar = async () => {
    if (!motivo.trim()) return toast.error('O motivo é obrigatório.')
    const lista = batidas.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
    if (tipo === 'corrigir_batidas' && lista.some((h) => !/^\d{1,2}:\d{2}$/.test(h))) return toast.error('Batidas: use HH:MM separados por espaço.')
    setSalvando(true)
    try {
      await pontosService.criarAjuste({ colaboradorId, data: dia.data, tipo, motivo: motivo.trim(), batidas: tipo === 'corrigir_batidas' ? lista : undefined })
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
    if (!window.confirm(`Remover o ajuste "${ROTULO_AJUSTE[a.tipo]}"? Fica registrado que você removeu.`)) return
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
          Tipo de ajuste
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAjuste)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
            {(Object.keys(ROTULO_AJUSTE) as TipoAjuste[]).map((t) => <option key={t} value={t}>{ROTULO_AJUSTE[t]}</option>)}
          </select>
        </label>
        {tipo === 'corrigir_batidas' && (
          <label className="block text-xs font-medium text-foreground/70">
            Batidas que valem (HH:MM separados por espaço; depois da meia-noite use 24h+, ex.: 26:10)
            <input value={batidas} onChange={(e) => setBatidas(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm" />
          </label>
        )}
        <label className="block text-xs font-medium text-foreground/70">
          Motivo (obrigatório)
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm" />
        </label>

        {doDia.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">Ajustes desse dia</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {doDia.map((a) => (
                <li key={a.id} className="flex items-start gap-2 px-3 py-2">
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{ROTULO_AJUSTE[a.tipo]}{a.batidas ? `: ${a.batidas.join(' ')}` : ''}</p>
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
