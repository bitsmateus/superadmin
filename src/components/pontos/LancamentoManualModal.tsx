import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { horas, pontosService, type Colaborador, type DestinoDesconto } from '@/services/pontos'

/** Horas e minutos (ex.: 1 hora e 0 minutos). */
export function CamposDeHoras({ h, m, onH, onM }: { h: string; m: string; onH: (v: string) => void; onM: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-medium text-foreground/70">
        Horas
        <input type="number" min={0} max={12} inputMode="numeric" value={h} onChange={(e) => onH(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" aria-label="Horas" />
      </label>
      <label className="block text-xs font-medium text-foreground/70">
        Minutos
        <input type="number" min={0} max={59} inputMode="numeric" value={m} onChange={(e) => onM(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" aria-label="Minutos" />
      </label>
    </div>
  )
}

/** Desconto de horas: quanto e de onde sai. O padrão é o salário (R$); dá pra tirar do banco de horas em vez disso. */
export function CamposDoDesconto({ h, m, destino, onH, onM, onDestino }: {
  h: string; m: string; destino: DestinoDesconto
  onH: (v: string) => void; onM: (v: string) => void; onDestino: (v: DestinoDesconto) => void
}) {
  const minutos = minutosDo(h, m)
  return (
    <div className="space-y-3">
      <CamposDeHoras h={h} m={m} onH={onH} onM={onM} />
      <label className="block text-xs font-medium text-foreground/70">
        Sai de onde
        <select value={destino} onChange={(e) => onDestino(e.target.value as DestinoDesconto)}
          className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground">
          <option value="dinheiro">Do salário (R$, descontado na folha)</option>
          <option value="banco">Do banco de horas (fica negativo até compensar)</option>
        </select>
      </label>
      {minutos > 0 && <p className="text-xs text-foreground/50">Vai descontar {horas(minutos)} {destino === 'dinheiro' ? 'do salário (valor da hora do colaborador)' : 'do banco de horas'}.</p>}
    </div>
  )
}

/** "1" horas + "30" minutos -> 90. Vazio vale 0. */
export function minutosDo(h: string, m: string): number {
  const hh = Math.max(0, Math.floor(Number(h) || 0))
  const mm = Math.max(0, Math.floor(Number(m) || 0))
  return hh * 60 + mm
}

const ontemSP = () => {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

/** Dias úteis (seg a sex) de `de` até `ate`, no máximo 31. */
export function diasUteisEntre(de: string, ate: string): string[] {
  const out: string[] = []
  let t = Date.parse(`${de}T12:00:00Z`)
  const fim = Date.parse(`${ate}T12:00:00Z`)
  while (t <= fim && out.length < 31) {
    const d = new Date(t)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
    t += 86_400_000
  }
  return out
}

/**
 * Lançamento manual do admin direto da tela de Pontos: descontar horas (saiu no meio do expediente, chegou atrasado…) e atestado
 * (abona a falta, de um dia ou de vários). Fica registrado quem lançou e o motivo; importar a planilha do relógio de novo
 * não apaga nem duplica o que foi lançado aqui — o cálculo só se ajusta às batidas.
 */
export function LancamentoManualModal({ open, colaboradores, colaboradorInicial, onClose, onSalvo }: {
  open: boolean
  colaboradores: Colaborador[]
  colaboradorInicial?: string
  onClose: () => void
  onSalvo: () => void
}) {
  const ativos = React.useMemo(() => colaboradores.filter((c) => c.ativo), [colaboradores])
  const [colaboradorId, setColaboradorId] = React.useState('')
  // As três coisas que o admin lança: falta abonada com atestado (dia inteiro), atestado de algumas horas e desconto de horas do salário.
  const [tipo, setTipo] = React.useState<'atestado_dia' | 'atestado_horas' | 'desconto'>('atestado_dia')
  const [data, setData] = React.useState('')
  const [ate, setAte] = React.useState('')
  const [h, setH] = React.useState('1')
  const [m, setM] = React.useState('0')
  const [destino, setDestino] = React.useState<DestinoDesconto>('dinheiro')
  const [motivo, setMotivo] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setColaboradorId(colaboradorInicial && ativos.some((c) => c.id === colaboradorInicial) ? colaboradorInicial : ativos[0]?.id ?? '')
    setTipo('atestado_dia'); setData(ontemSP()); setAte(''); setH('1'); setM('0'); setDestino('dinheiro'); setMotivo('')
  }, [open, colaboradorInicial, ativos])

  const salvar = async () => {
    if (!colaboradorId) return toast.error('Escolha o colaborador.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return toast.error('Escolha a data.')
    if (!motivo.trim()) return toast.error('O motivo é obrigatório.')
    setSalvando(true)
    try {
      if (tipo === 'desconto') {
        const minutos = minutosDo(h, m)
        if (minutos < 1 || minutos > 12 * 60) { toast.error('Informe quanto descontar (de 1 minuto a 12 horas).'); return }
        await pontosService.criarAjuste({ colaboradorId, data, tipo: 'descontar_horas', motivo: motivo.trim(), minutos, destino })
        toast.success('Desconto lançado.')
      } else if (tipo === 'atestado_horas') {
        const minutos = minutosDo(h, m)
        if (minutos < 1 || minutos > 12 * 60) { toast.error('Informe as horas do atestado (de 1 minuto a 12 horas).'); return }
        await pontosService.criarAjuste({ colaboradorId, data, tipo: 'atestado', motivo: motivo.trim(), minutos })
        toast.success('Atestado lançado: essas horas ficam abonadas.')
      } else {
        const fim = ate && ate >= data ? ate : data
        const dias = fim === data ? [data] : diasUteisEntre(data, fim)
        if (!dias.length) { toast.error('Nesse período não tem dia útil.'); return }
        for (const d of dias) await pontosService.criarAjuste({ colaboradorId, data: d, tipo: 'atestado', motivo: motivo.trim() })
        toast.success(dias.length === 1 ? 'Falta abonada com atestado.' : `Atestado lançado em ${dias.length} dias úteis.`)
      }
      onSalvo()
      onClose()
    } catch (e) {
      toast.error((e as Error).message || 'Não deu pra lançar.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Lançar desconto ou atestado"
      description="Só o administrador lança. Fica registrado quem fez e o motivo; importar a planilha de novo não apaga nem duplica."
      size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => void salvar()} loading={salvando}>Lançar</Button></>}
    >
      <div className="space-y-4 text-sm">
        <label className="block text-xs font-medium text-foreground/70">
          Colaborador
          <select value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground">
            {ativos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-foreground/70">
          O que lançar
          <select value={tipo} onChange={(e) => setTipo(e.target.value as 'atestado_dia' | 'atestado_horas' | 'desconto')} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground">
            <option value="atestado_dia">Falta abonada com atestado (dia inteiro)</option>
            <option value="atestado_horas">Atestado de algumas horas (ex.: dentista)</option>
            <option value="desconto">Descontar horas do salário</option>
          </select>
        </label>
        <div className={tipo === 'atestado_dia' ? 'grid grid-cols-2 gap-3' : ''}>
          <label className="block text-xs font-medium text-foreground/70">
            {tipo === 'atestado_dia' ? 'Primeiro dia' : 'Dia'}
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" />
          </label>
          {tipo === 'atestado_dia' && (
            <label className="block text-xs font-medium text-foreground/70">
              Último dia (se for mais de um)
              <input type="date" value={ate} min={data} onChange={(e) => setAte(e.target.value)} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground" />
            </label>
          )}
        </div>
        {tipo === 'desconto' && <CamposDoDesconto h={h} m={m} destino={destino} onH={setH} onM={setM} onDestino={setDestino} />}
        {tipo === 'atestado_horas' && (
          <>
            <CamposDeHoras h={h} m={m} onH={setH} onM={setM} />
            <p className="text-xs text-foreground/50">Essas horas ficam abonadas: o que faltou no dia até esse tempo não desconta nem fica negativo no banco.</p>
          </>
        )}
        {tipo === 'atestado_dia' && <p className="text-xs text-foreground/50">A falta do dia fica abonada: sem desconto em R$, sem banco negativo e sem perder horas. Em período, só os dias úteis (seg a sex) recebem o atestado.</p>}
        <label className="block text-xs font-medium text-foreground/70">
          Motivo (obrigatório)
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2}
            placeholder={tipo === 'desconto' ? 'Ex.: ficou 1 hora fora' : tipo === 'atestado_horas' ? 'Ex.: dentista' : 'Ex.: atestado médico'}
            className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm text-foreground placeholder:text-foreground/35" />
        </label>
      </div>
    </Modal>
  )
}
