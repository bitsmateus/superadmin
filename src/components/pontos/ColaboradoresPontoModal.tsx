import * as React from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { brl, DIAS_CURTOS, pontosService, type Colaborador } from '@/services/pontos'

type Rascunho = {
  nome: string; apelidos: string; ativo: boolean; diasSemana: number[]; horasDia: string; horasSabado: string; horasDomingo: string
  entradaPrevista: string; saidaPrevista: string; intervaloMinutos: string; intervaloInicio: string; toleranciaMinutos: string
  salario: string; divisorMensal: string; valorHora: string; pctExtraUtil: string; pctExtraDomingoFeriado: string
  destinoExtra: 'banco' | 'pagamento'; bancoSaldoInicial: string; bancoInicio: string; inicioControle: string
}

const paraHorasTexto = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
const deHorasTexto = (s: string): number | null => {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : null
}
const centavos = (s: string): number | null => {
  const limpo = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  if (!limpo) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
const reais = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))

function paraRascunho(c?: Colaborador): Rascunho {
  return {
    nome: c?.nome ?? '', apelidos: (c?.apelidos ?? []).join(', '), ativo: c?.ativo ?? true, diasSemana: c?.diasSemana ?? [1, 2, 3, 4, 5],
    horasDia: paraHorasTexto(c?.minutosDia ?? 510), horasSabado: paraHorasTexto(c?.minutosSabado ?? 240), horasDomingo: paraHorasTexto(c?.minutosDomingo ?? 0),
    entradaPrevista: c?.entradaPrevista ?? '08:00', saidaPrevista: c?.saidaPrevista ?? '18:00', intervaloMinutos: String(c?.intervaloMinutos ?? 90), intervaloInicio: c ? (c.intervaloInicio ?? '') : '12:00',
    toleranciaMinutos: String(c?.toleranciaMinutos ?? 10), salario: reais(c?.salarioBaseCentavos ?? 0), divisorMensal: String(c?.divisorMensal ?? 220),
    valorHora: reais(c?.valorHoraCentavos ?? null), pctExtraUtil: String(c?.pctExtraUtil ?? 50), pctExtraDomingoFeriado: String(c?.pctExtraDomingoFeriado ?? 100),
    destinoExtra: c?.destinoExtra ?? 'banco', bancoSaldoInicial: paraHorasTexto(Math.abs(c?.bancoSaldoInicialMinutos ?? 0)).replace(/^/, (c?.bancoSaldoInicialMinutos ?? 0) < 0 ? '-' : ''),
    bancoInicio: c?.bancoInicio ?? '', inicioControle: c?.inicioControle ?? '',
  }
}

/** Cadastro dos colaboradores do ponto: jornada, horários, tolerância, salário/valor-hora, % de extra e banco de horas. */
export function ColaboradoresPontoModal({ open, onClose, colaboradores, onSalvo }: {
  open: boolean
  onClose: () => void
  colaboradores: Colaborador[]
  onSalvo: () => void
}) {
  const [selecionado, setSelecionado] = React.useState<string | 'novo' | null>(null)
  const atual = colaboradores.find((c) => c.id === selecionado)
  const [r, setR] = React.useState<Rascunho>(paraRascunho())
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSelecionado((s) => s ?? colaboradores[0]?.id ?? 'novo')
  }, [open, colaboradores])
  React.useEffect(() => { setR(paraRascunho(selecionado === 'novo' ? undefined : atual)) }, [selecionado, atual])

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((x) => ({ ...x, [k]: v }))

  const salvar = async () => {
    const minutosDia = deHorasTexto(r.horasDia)
    const minutosSabado = deHorasTexto(r.horasSabado)
    const minutosDomingo = deHorasTexto(r.horasDomingo)
    const saldo = deHorasTexto(r.bancoSaldoInicial.replace('-', ''))
    const salario = centavos(r.salario)
    if (!r.nome.trim()) return toast.error('Informe o nome.')
    if (minutosDia == null || minutosSabado == null || minutosDomingo == null) return toast.error('Jornada: use horas no formato 8:00.')
    if (saldo == null) return toast.error('Saldo inicial do banco: use horas no formato 2:30 (ou -2:30).')
    const corpo: Partial<Colaborador> = {
      nome: r.nome.trim(), apelidos: r.apelidos.split(',').map((s) => s.trim()).filter(Boolean), ativo: r.ativo, diasSemana: r.diasSemana,
      minutosDia, minutosSabado, minutosDomingo, entradaPrevista: r.entradaPrevista, saidaPrevista: r.saidaPrevista,
      intervaloMinutos: Number(r.intervaloMinutos) || 0, intervaloInicio: r.intervaloInicio || null, toleranciaMinutos: Number(r.toleranciaMinutos) || 0,
      salarioBaseCentavos: salario ?? 0, divisorMensal: Number(r.divisorMensal) || 220, valorHoraCentavos: centavos(r.valorHora),
      pctExtraUtil: Number(r.pctExtraUtil.replace(',', '.')) || 0, pctExtraDomingoFeriado: Number(r.pctExtraDomingoFeriado.replace(',', '.')) || 0,
      destinoExtra: r.destinoExtra, bancoSaldoInicialMinutos: r.bancoSaldoInicial.trim().startsWith('-') ? -saldo : saldo,
      bancoInicio: r.bancoInicio || null, inicioControle: r.inicioControle || null,
    }
    setSalvando(true)
    try {
      const salvo = selecionado === 'novo' || !atual
        ? await pontosService.criarColaborador(corpo)
        : await pontosService.salvarColaborador(atual.id, corpo)
      toast.success('Colaborador salvo.')
      setSelecionado(salvo.id)
      onSalvo()
    } catch (e) {
      toast.error((e as Error).message || 'Não deu pra salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const valorHoraPrevisto = centavos(r.valorHora) || Math.round((centavos(r.salario) ?? 0) / (Number(r.divisorMensal) || 220))

  return (
    <Modal open={open} onClose={onClose} title="Colaboradores do ponto" size="2xl"
      footer={<><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={() => void salvar()} disabled={salvando}>Salvar</Button></>}>
      <div className="grid gap-4 md:grid-cols-[12rem,1fr]">
        <div className="space-y-1">
          {colaboradores.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelecionado(c.id)}
              className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', selecionado === c.id ? 'bg-accent/10 text-accent' : 'hover:bg-elevate/[0.04]', !c.ativo && 'opacity-50')}>
              {c.nome}{!c.ativo && <span className="text-[10px]">inativo</span>}
            </button>
          ))}
          <Button size="sm" variant="secondary" className="mt-2 w-full" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSelecionado('novo')}>Novo colaborador</Button>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Nome" value={r.nome} onChange={(e) => set('nome', e.target.value)} />
            <Input label="Apelidos: como aparece na planilha (separados por vírgula)" value={r.apelidos} onChange={(e) => set('apelidos', e.target.value)}
              hint='Ex.: "joao vitor". A planilha do relógio usa o nome em minúsculas e abreviado.' />
            <Input label="Início do controle de ponto" type="date" value={r.inicioControle} onChange={(e) => set('inicioControle', e.target.value)}
              hint="Antes dessa data nada conta: sem falta, previsto ou saldo." />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-foreground/70">
            <input type="checkbox" checked={r.ativo} onChange={(e) => set('ativo', e.target.checked)} /> Ativo
          </label>

          <div>
            <p className="mb-1.5 text-xs font-medium text-foreground/70">Dias trabalhados</p>
            <div className="flex flex-wrap gap-1.5">
              {DIAS_CURTOS.map((d, i) => (
                <button key={d} type="button" onClick={() => set('diasSemana', r.diasSemana.includes(i) ? r.diasSemana.filter((x) => x !== i) : [...r.diasSemana, i])}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm', r.diasSemana.includes(i) ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-foreground/60')}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Jornada seg–sex (h:mm)" value={r.horasDia} onChange={(e) => set('horasDia', e.target.value)} />
            <Input label="Jornada sábado (h:mm)" value={r.horasSabado} onChange={(e) => set('horasSabado', e.target.value)} />
            <Input label="Jornada domingo (h:mm)" value={r.horasDomingo} onChange={(e) => set('horasDomingo', e.target.value)} />
            <Input label="Entrada prevista" type="time" value={r.entradaPrevista} onChange={(e) => set('entradaPrevista', e.target.value)} />
            <Input label="Saída prevista" type="time" value={r.saidaPrevista} onChange={(e) => set('saidaPrevista', e.target.value)} />
            <Input label="Início do almoço" type="time" value={r.intervaloInicio} onChange={(e) => set('intervaloInicio', e.target.value)} />
            <Input label="Almoço previsto (min)" inputMode="numeric" value={r.intervaloMinutos} onChange={(e) => set('intervaloMinutos', e.target.value)} />
            <Input label="Tolerância (min)" inputMode="numeric" value={r.toleranciaMinutos} onChange={(e) => set('toleranciaMinutos', e.target.value)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Salário base (R$)" inputMode="decimal" value={r.salario} onChange={(e) => set('salario', e.target.value)} />
            <Input label="Divisor de horas/mês" inputMode="numeric" value={r.divisorMensal} onChange={(e) => set('divisorMensal', e.target.value)} />
            <Input label="Valor/hora direto (R$, opcional)" inputMode="decimal" value={r.valorHora} onChange={(e) => set('valorHora', e.target.value)}
              hint={`Valor/hora usado: ${brl(valorHoraPrevisto)}`} />
            <Input label="% extra dia útil" inputMode="decimal" value={r.pctExtraUtil} onChange={(e) => set('pctExtraUtil', e.target.value)} />
            <Input label="% extra domingo/feriado" inputMode="decimal" value={r.pctExtraDomingoFeriado} onChange={(e) => set('pctExtraDomingoFeriado', e.target.value)} />
            <label className="text-xs font-medium text-foreground/70">
              Hora extra vai para
              <select value={r.destinoExtra} onChange={(e) => set('destinoExtra', e.target.value as 'banco' | 'pagamento')} className="mt-1.5 block w-full rounded-lg border border-line bg-card px-2.5 py-2 text-sm">
                <option value="banco">Banco de horas</option>
                <option value="pagamento">Pagamento em folha</option>
              </select>
            </label>
            <Input label="Saldo inicial do banco (h:mm)" value={r.bancoSaldoInicial} onChange={(e) => set('bancoSaldoInicial', e.target.value)} />
            <Input label="Banco de horas conta a partir de" type="date" value={r.bancoInicio} onChange={(e) => set('bancoInicio', e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  )
}
