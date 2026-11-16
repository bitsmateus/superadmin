import * as React from 'react'
import {
  AlertTriangle, CalendarCheck, CalendarDays, CalendarX, Clock, Download, FileText, History, Loader2, Lock, PiggyBank, Settings2, TimerOff,
  TrendingUp, Upload, Users, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { AjusteDiaModal } from '@/components/pontos/AjusteDiaModal'
import { ColaboradoresPontoModal } from '@/components/pontos/ColaboradoresPontoModal'
import { FeriadosModal } from '@/components/pontos/FeriadosModal'
import { ImportacoesModal } from '@/components/pontos/ImportacoesModal'
import { ImportarPontosModal } from '@/components/pontos/ImportarPontosModal'
import { useAuth } from '@/hooks/useAuth'
import { canSeeFinancials } from '@/services/supabase'
import { cn } from '@/lib/utils'
import {
  baixarBlob, brl, dataBr, DIAS_CURTOS, horas, pontosService, ROTULO_STATUS,
  type Colaborador, type DiaPonto, type PeriodoDoColaborador, type StatusDia,
} from '@/services/pontos'

function hojeSP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function limitesDoMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split('-').map(Number)
  return { de: `${mes}-01`, ate: new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) }
}

const COR_STATUS: Record<StatusDia, string> = {
  normal: 'bg-elevate/[0.06] text-foreground/60',
  falta: 'bg-danger/15 text-danger',
  atraso: 'bg-warning/15 text-warning',
  manha_sem_batida: 'bg-warning/15 text-warning',
  tarde_sem_batida: 'bg-warning/15 text-warning',
  extra: 'bg-accent/15 text-accent',
  em_andamento: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  justificada: 'bg-success/15 text-success',
  folga: 'bg-elevate/[0.06] text-foreground/45',
  abonado: 'bg-success/15 text-success',
  feriado: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  incompleto: 'bg-warning/15 text-warning',
  fora_controle: 'bg-elevate/[0.04] text-foreground/35',
  sem_registro: 'bg-elevate/[0.06] text-foreground/40',
}

/**
 * Financeiro > Pontos. Só pra quem vê o Financeiro (o servidor bloqueia também: ver server/src/pontos/rotas.ts).
 * Período (mês atual por padrão, outro mês ou intervalo), "Todos" com o comparativo e uma aba por colaborador com os
 * cards de resumo, o dia a dia, os ajustes e a exportação (CSV/PDF) pro fechamento da folha.
 */
export function FinanceiroPontosPage() {
  const { profile } = useAuth()
  const pode = canSeeFinancials(profile)
  const hoje = hojeSP()
  const [modoPeriodo, setModoPeriodo] = React.useState<'mes' | 'intervalo'>('mes')
  const [mes, setMes] = React.useState(hoje.slice(0, 7))
  const [deCustom, setDeCustom] = React.useState(`${hoje.slice(0, 7)}-01`)
  const [ateCustom, setAteCustom] = React.useState(hoje)
  const { de, ate } = modoPeriodo === 'mes' ? limitesDoMes(mes) : { de: deCustom, ate: ateCustom < deCustom ? deCustom : ateCustom }

  const [dados, setDados] = React.useState<PeriodoDoColaborador[] | null>(null)
  const [colaboradores, setColaboradores] = React.useState<Colaborador[]>([])
  const [erro, setErro] = React.useState<string | null>(null)
  const [aba, setAba] = React.useState<string>('todos')
  const [modal, setModal] = React.useState<'importar' | 'colaboradores' | 'feriados' | 'importacoes' | null>(null)
  const [diaAjuste, setDiaAjuste] = React.useState<DiaPonto | null>(null)

  const carregar = React.useCallback(async () => {
    if (!pode) return
    try {
      const [p, c] = await Promise.all([pontosService.periodo(de, ate), pontosService.colaboradores()])
      setDados(p.colaboradores)
      setColaboradores(c)
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    }
  }, [pode, de, ate])
  React.useEffect(() => { setDados(null); void carregar() }, [carregar])

  if (!pode) {
    return (
      <>
        <TopBar title="Pontos" subtitle="Financeiro" />
        <div className="mx-auto mt-10 max-w-md rounded-2xl bg-card p-6 text-center shadow-sm">
          <Lock className="mx-auto h-7 w-7 text-foreground/30" />
          <p className="mt-3 text-sm font-medium text-foreground">Acesso restrito ao administrador do Financeiro.</p>
        </div>
      </>
    )
  }

  const atual = dados?.find((d) => d.colaborador.id === aba) ?? null

  const exportar = async (formato: 'csv' | 'pdf') => {
    if (!atual) return
    try {
      const blob = await pontosService.relatorio({ colaboradorId: atual.colaborador.id, de, ate, formato })
      baixarBlob(blob, `ponto-${atual.colaborador.nome}-${de}-a-${ate}.${formato}`)
    } catch (e) {
      toast.error((e as Error).message || 'Não deu pra exportar.')
    }
  }

  return (
    <>
      <TopBar
        title="Pontos"
        subtitle="Financeiro"
        rightSlot={(
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" leftIcon={<History className="h-4 w-4" />} onClick={() => setModal('importacoes')}>Importações</Button>
            <Button variant="ghost" size="sm" leftIcon={<CalendarDays className="h-4 w-4" />} onClick={() => setModal('feriados')}>Feriados</Button>
            <Button variant="ghost" size="sm" leftIcon={<Settings2 className="h-4 w-4" />} onClick={() => setModal('colaboradores')}>Colaboradores</Button>
            <Button leftIcon={<Upload className="h-4 w-4" />} onClick={() => setModal('importar')}>Importar planilha</Button>
          </div>
        )}
      />

      <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* período */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-3 text-sm">
          <CalendarDays className="h-4 w-4 text-foreground/40" />
          <Pilula ativa={modoPeriodo === 'mes' && mes === hoje.slice(0, 7)} onClick={() => { setModoPeriodo('mes'); setMes(hoje.slice(0, 7)) }}>Mês atual</Pilula>
          <label className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1', modoPeriodo === 'mes' && mes !== hoje.slice(0, 7) && 'bg-accent/10')}>
            <span className="text-foreground/60">Mês</span>
            <input type="month" value={mes} onChange={(e) => { if (e.target.value) { setModoPeriodo('mes'); setMes(e.target.value) } }} className="rounded-md border border-line bg-card px-2 py-1 text-sm" />
          </label>
          <Pilula ativa={modoPeriodo === 'intervalo'} onClick={() => setModoPeriodo('intervalo')}>Personalizado</Pilula>
          {modoPeriodo === 'intervalo' && (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-foreground/60">
              de <input type="date" value={deCustom} onChange={(e) => setDeCustom(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1 text-sm" />
              até <input type="date" value={ateCustom} onChange={(e) => setAteCustom(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1 text-sm" />
            </span>
          )}
          <span className="ml-auto text-xs text-foreground/45">{dataBr(de)} a {dataBr(ate)}</span>
        </div>

        {erro && <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{erro}</p>}
        {!dados && !erro && <p className="inline-flex items-center gap-2 text-sm text-foreground/50"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>}

        {dados && (
          <>
            {/* colaboradores */}
            <div className="flex flex-wrap gap-1.5" role="tablist">
              <Aba ativa={aba === 'todos'} onClick={() => setAba('todos')}><Users className="h-3.5 w-3.5" />Todos</Aba>
              {dados.map((d) => (
                <Aba key={d.colaborador.id} ativa={aba === d.colaborador.id} onClick={() => setAba(d.colaborador.id)}>
                  {d.colaborador.nome}{!d.colaborador.ativo && <span className="text-[10px] opacity-60">inativo</span>}
                </Aba>
              ))}
            </div>

            {aba === 'todos' || !atual ? (
              <Comparativo dados={dados} onAbrir={setAba} />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                  <Card icone={<Clock />} rotulo="Horas trabalhadas" valor={horas(atual.resumo.trabalhadoMinutos)} nota={`previstas ${horas(atual.resumo.previstoMinutos)}${atual.resumo.emAndamento ? ` · ${atual.resumo.emAndamento} em andamento` : ''}`} />
                  <Card icone={<TrendingUp />} rotulo="Horas extras" valor={horas(atual.resumo.extraMinutos)} nota={atual.resumo.valorExtraCentavos ? `a pagar ${brl(atual.resumo.valorExtraCentavos)}` : `banco ${horas(atual.resumo.extraBancoMinutos)} · pag. ${horas(atual.resumo.extraPagamentoMinutos)}`} />
                  <Card icone={<TimerOff />} rotulo="Atraso bruto" valor={horas(atual.resumo.atrasoMinutos)} nota="informativo (não entra de novo no banco)" />
                  <Card icone={<CalendarX />} rotulo="Faltas" valor={String(atual.resumo.faltas)} nota={atual.resumo.manhasSemBatida ? `${atual.resumo.manhasSemBatida} manhã(s) sem batida` : 'dia útil sem batida'} tom={atual.resumo.faltas > 0 ? 'ruim' : undefined} />
                  <Card icone={<CalendarCheck />} rotulo="Ausências justificadas" valor={String(atual.resumo.justificadas)} nota="licença, viagem, férias" />
                  <Card icone={<PiggyBank />} rotulo="Banco de horas" valor={horas(atual.bancoAcumuladoMinutos)} nota={`acumulado · no período ${horas(atual.resumo.bancoMinutos)}`} tom={atual.bancoAcumuladoMinutos < 0 ? 'ruim' : atual.bancoAcumuladoMinutos > 0 ? 'bom' : undefined} />
                  <Card icone={<Wallet />} rotulo="Desconto" valor={brl(atual.resumo.descontoCentavos)} nota={`valor/hora ${brl(atual.colaborador.valorHoraCalculadoCentavos)}`} tom={atual.resumo.descontoCentavos > 0 ? 'ruim' : undefined} />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={() => void exportar('csv')}>Exportar CSV</Button>
                  <Button variant="secondary" size="sm" leftIcon={<FileText className="h-4 w-4" />} onClick={() => void exportar('pdf')}>Exportar PDF</Button>
                </div>

                <TabelaDias dias={atual.dias} ajustesPorDia={new Set(atual.ajustes.map((a) => a.data))} onAjustar={setDiaAjuste} />
              </>
            )}
          </>
        )}
      </div>

      <ImportarPontosModal open={modal === 'importar'} onClose={() => setModal(null)} onImportado={() => void carregar()} colaboradores={colaboradores} />
      <ColaboradoresPontoModal open={modal === 'colaboradores'} onClose={() => setModal(null)} colaboradores={colaboradores} onSalvo={() => void carregar()} />
      <FeriadosModal open={modal === 'feriados'} onClose={() => setModal(null)} onSalvo={() => void carregar()} />
      <ImportacoesModal open={modal === 'importacoes'} onClose={() => setModal(null)} onDesfeita={() => void carregar()} />
      {atual && (
        <AjusteDiaModal
          dia={diaAjuste}
          colaboradorId={atual.colaborador.id}
          colaboradorNome={atual.colaborador.nome}
          ajustes={atual.ajustes}
          onClose={() => setDiaAjuste(null)}
          onSalvo={() => { void carregar().then(() => setDiaAjuste(null)) }}
        />
      )}
    </>
  )
}

function Pilula({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-lg px-3 py-1.5 font-medium transition-colors', ativa ? 'bg-accent/10 text-accent' : 'text-foreground/60 hover:bg-elevate/[0.04]')}>
      {children}
    </button>
  )
}

function Aba({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={ativa} onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', ativa ? 'bg-accent/10 text-accent ring-1 ring-accent/25' : 'text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground')}>
      {children}
    </button>
  )
}

function Card({ icone, rotulo, valor, nota, tom }: { icone: React.ReactElement; rotulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim' }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-foreground/45">
        {React.cloneElement(icone, { className: 'h-3.5 w-3.5' })}
        <p className="truncate text-[10px] font-medium uppercase tracking-wider">{rotulo}</p>
      </div>
      <p className={cn('mt-1.5 truncate text-xl font-bold tabular-nums', tom === 'bom' ? 'text-success' : tom === 'ruim' ? 'text-danger' : 'text-foreground')}>{valor}</p>
      {nota && <p className="truncate text-[11px] text-foreground/45">{nota}</p>}
    </div>
  )
}

function Comparativo({ dados, onAbrir }: { dados: PeriodoDoColaborador[]; onAbrir: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-card shadow-sm">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-foreground/45">
          <tr className="border-b border-line">
            <th className="px-4 py-3">Colaborador</th>
            <th className="px-3 py-3 text-right">Trabalhadas</th>
            <th className="px-3 py-3 text-right">Extras</th>
            <th className="px-3 py-3 text-right">Atraso bruto</th>
            <th className="px-3 py-3 text-right">Faltas</th>
            <th className="px-3 py-3 text-right">Justificadas</th>
            <th className="px-3 py-3 text-right">Banco no período</th>
            <th className="px-3 py-3 text-right">Banco acumulado</th>
            <th className="px-3 py-3 text-right">Desconto</th>
            <th className="px-3 py-3 text-right">Extras a pagar</th>
          </tr>
        </thead>
        <tbody>
          {dados.map((d) => (
            <tr key={d.colaborador.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-elevate/[0.03]" onClick={() => onAbrir(d.colaborador.id)}>
              <td className="px-4 py-3 font-medium text-foreground">{d.colaborador.nome}</td>
              <td className="px-3 py-3 text-right tabular-nums">{horas(d.resumo.trabalhadoMinutos)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{horas(d.resumo.extraMinutos)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{horas(d.resumo.atrasoMinutos)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{d.resumo.faltas}</td>
              <td className="px-3 py-3 text-right tabular-nums">{d.resumo.justificadas}</td>
              <td className={cn('px-3 py-3 text-right tabular-nums', d.resumo.bancoMinutos < 0 ? 'text-danger' : d.resumo.bancoMinutos > 0 ? 'text-success' : '')}>{horas(d.resumo.bancoMinutos)}</td>
              <td className={cn('px-3 py-3 text-right font-semibold tabular-nums', d.bancoAcumuladoMinutos < 0 ? 'text-danger' : d.bancoAcumuladoMinutos > 0 ? 'text-success' : '')}>{horas(d.bancoAcumuladoMinutos)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{brl(d.resumo.descontoCentavos)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{brl(d.resumo.valorExtraCentavos)}</td>
            </tr>
          ))}
          {!dados.length && <tr><td colSpan={10} className="px-4 py-8 text-center text-foreground/45">Nenhum colaborador ativo. Cadastre em “Colaboradores”.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function TabelaDias({ dias, ajustesPorDia, onAjustar }: { dias: DiaPonto[]; ajustesPorDia: Set<string>; onAjustar: (d: DiaPonto) => void }) {
  const traco = (m: number) => (m ? horas(m) : '—')
  return (
    <div className="overflow-x-auto rounded-2xl bg-card shadow-sm">
      <table className="w-full min-w-[1100px] text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-foreground/45">
          <tr className="border-b border-line">
            <th className="px-3 py-3">Data</th><th className="px-2 py-3">Dia</th><th className="px-2 py-3">Entradas e saídas</th>
            <th className="px-2 py-3 text-right">Trabalhado</th><th className="px-2 py-3 text-right">Previsto</th>
            <th className="px-2 py-3 text-right">Atraso bruto</th><th className="px-2 py-3 text-right">Saldo</th>
            <th className="px-2 py-3 text-right">Hora extra</th>
            <th className="px-2 py-3">Status</th><th className="px-3 py-3" />
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.data} className={cn('border-b border-line last:border-0', (d.diaSemana === 0 || d.diaSemana === 6) && 'bg-elevate/[0.02]')}>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dataBr(d.data)}</td>
              <td className="px-2 py-2 text-foreground/60">{DIAS_CURTOS[d.diaSemana]}</td>
              <td className="px-2 py-2 tabular-nums" title={d.avisos.join(' ')}>
                {d.batidas.length ? d.batidas.join('  ') : <span className="text-foreground/35">—</span>}
                {d.avisos.length > 0 && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 text-warning" aria-label={d.avisos.join(' ')} />}
                {d.batidas.join() !== d.batidasOriginais.join() && <span className="ml-1.5 text-[10px] text-accent">(corrigido)</span>}
                {d.feriado && <span className="ml-1.5 text-[10px] text-sky-600 dark:text-sky-300">{d.feriado}</span>}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{traco(d.trabalhadoMinutos)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-foreground/55">{traco(d.previstoMinutos)}</td>
              <td className="px-2 py-2 text-right tabular-nums" title={d.saidaAntecipadaMinutos ? `Saída antecipada bruta: ${horas(d.saidaAntecipadaMinutos)}` : undefined}>{traco(d.atrasoMinutos)}</td>
              <td className={cn('px-2 py-2 text-right font-medium tabular-nums', d.saldoMinutos < 0 ? 'text-danger' : d.saldoMinutos > 0 ? 'text-success' : 'text-foreground/40')}
                title={d.saldoBrutoMinutos && !d.saldoMinutos ? `${horas(d.saldoBrutoMinutos)} dentro da tolerância` : d.bancoMinutos !== d.saldoMinutos ? `No banco: ${horas(d.bancoMinutos)}` : undefined}>
                {d.saldoMinutos ? horas(d.saldoMinutos) : d.saldoBrutoMinutos ? <span className="text-foreground/40">0 <span className="text-[10px]">({horas(d.saldoBrutoMinutos)})</span></span> : '—'}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{d.extraMinutos ? `${horas(d.extraMinutos)}${d.extraDestino === 'pagamento' ? ' $' : ''}` : '—'}</td>
              <td className="px-2 py-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', COR_STATUS[d.status])}>{ROTULO_STATUS[d.status]}{d.justificativa && d.justificativa !== 'Justificada' && ` (${d.justificativa})`}</span>
                {ajustesPorDia.has(d.data) && <span className="ml-1 text-[10px] text-accent" title="Tem ajuste manual">✎</span>}
              </td>
              <td className="px-3 py-2 text-right">
                <button type="button" onClick={() => onAjustar(d)} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10">Ajustar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
