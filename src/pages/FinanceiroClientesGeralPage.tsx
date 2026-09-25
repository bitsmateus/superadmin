import * as React from 'react'
import {
  AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, RotateCcw, Search, Trash2, TrendingDown,
  UserMinus, Users, Wand2, Wallet,
} from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ClientDrawer } from '@/components/crm/ClientDrawerLazy'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { addMonthsToId, currentMonthId, monthIdBounds, monthLabelPt } from '@/hooks/useMonthFilter'
import { useClients } from '@/hooks/useClients'
import { useClientCancellations } from '@/hooks/useClientCancellations'
import { clientCancellationsService, type ClientCancellation } from '@/services/clientCancellations'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { formatBRLCents, parseBRLCents, prettifyCurrencyRaw, sanitizeCurrencyRaw } from '@/lib/currency'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Client } from '@/types/client'

/** Motivos prontos pra não virar texto livre — é o que permite somar "quantos saíram por preço"
 * depois. "Outro" continua existindo, com a observação explicando. */
const MOTIVOS = [
  'Preço',
  'Não usou / não engajou',
  'Insatisfação com o serviço',
  'Fechou / parou a operação',
  'Trocou de fornecedor',
  'Inadimplência',
  'Outro',
]

/** Etapas do cliente que contam como "cliente de verdade" no mês: já passou do contrato e está
 * rodando. Quem está em contrato/briefing/setup ainda não paga mensalidade, e 'churned' saiu. */
const ETAPAS_ATIVAS = new Set(['active', 'delivered', 'delivery', 'setup_done'])

type Unidade = 'nx_sistema' | 'nx_digital' | 'netscale'
type Aba = Unidade | 'cancelamentos'
type FiltroStatus = 'ativos' | 'cancelados' | 'todos'

/** As três empresas do grupo, na ordem em que aparecem nas abas. O cliente é classificado na
 * própria lista; quem ainda não foi classificado não some — aparece no aviso do topo. */
const UNIDADES: { valor: Unidade; label: string }[] = [
  { valor: 'nx_sistema', label: 'CLIENTES NX SISTEMA' },
  { valor: 'nx_digital', label: 'CLIENTES NX DIGITAL' },
  { valor: 'netscale', label: 'CLIENTES NETSCALE' },
]
const UNIDADE_CURTA: Record<Unidade, string> = {
  nx_sistema: 'NX Sistema',
  nx_digital: 'NX Digital',
  netscale: 'Netscale',
}

type Sugestao = { mrrCents: number; implCents: number; origem: string }

function centsDoCliente(valor: number | undefined): number {
  return Math.round((valor ?? 0) * 100)
}

/** CNPJ/CPF guardado só com dígitos — aqui ganha a pontuação pra leitura. Documento com tamanho
 * fora do padrão aparece como está, sem tentar formatar à força. */
function formatarCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return raw
}

/**
 * CLIENTES GERAL (Financeiro) — a base de clientes inteira numa tela só: quem é, quem atende,
 * quanto paga de mensalidade, quanto pagou de implementação, e quem cancelou em cada mês.
 *
 * O cadastro do cliente nasce no Suporte e nunca teve valor preenchido (mensalidade e implementação
 * só existiam na linha da aba Vendas). Por isso a tela edita os dois campos direto na lista e ainda
 * SUGERE o valor da venda de quem dá pra ligar sem dúvida — ver /api/clients/valores-sugeridos.
 */
export function FinanceiroClientesGeralPage() {
  const clients = useClients()
  const cancelamentos = useClientCancellations()

  const [aba, setAba] = React.useState<Aba>('nx_sistema')
  // Quem ainda não tem empresa definida não aparece em nenhuma das três abas — este botão mostra
  // esse pessoal pra classificar, sem precisar de uma quarta aba só pra isso.
  const [verSemEmpresa, setVerSemEmpresa] = React.useState(false)
  const [mes, setMes] = React.useState(currentMonthId())
  const [busca, setBusca] = React.useState('')
  const [status, setStatus] = React.useState<FiltroStatus>('ativos')
  const [drawerId, setDrawerId] = React.useState<string | null>(null)
  const [cancelando, setCancelando] = React.useState<Client | null>(null)

  // Leitura das assinaturas do Asaas: o servidor já faz sozinho de tempos em tempos, o botão é
  // pra quando a pessoa acabou de mexer lá e quer ver aqui na hora.
  const [sincronizando, setSincronizando] = React.useState(false)
  const sincronizarAsaas = async () => {
    setSincronizando(true)
    try {
      const r = await api.post<{ vinculados: number; valoresAtualizados: number; mrrLigado: number; semVinculo: number }>(
        '/api/asaas/sync',
      )
      await db.refresh()
      toast.success(
        `Asaas lido: ${r.valoresAtualizados} mensalidade(s) atualizada(s), ${r.vinculados} cliente(s) ligado(s) agora` +
        (r.semVinculo ? ` — ${r.semVinculo} sem par lá` : ''),
      )
    } catch (err) {
      toast.error('Falha ao ler o Asaas: ' + (err as Error).message)
    } finally {
      setSincronizando(false)
    }
  }

  // Valores que a venda conhece, pra quem ainda está sem — carregado uma vez.
  const [sugestoes, setSugestoes] = React.useState<Record<string, Sugestao>>({})
  React.useEffect(() => {
    let cancelado = false
    api.get<Record<string, Sugestao>>('/api/clients/valores-sugeridos')
      .then((res) => { if (!cancelado) setSugestoes(res) })
      .catch(() => { if (!cancelado) setSugestoes({}) })
    return () => { cancelado = true }
  }, [])

  const bounds = React.useMemo(() => monthIdBounds(mes), [mes])
  const cancelamentosDoMes = React.useMemo(
    () => cancelamentos.filter((c) => c.canceledAt >= bounds.from.slice(0, 10) && c.canceledAt <= bounds.to.slice(0, 10)),
    [cancelamentos, bounds],
  )

  const unidadeAtiva: Unidade | null = aba === 'cancelamentos' ? null : aba
  const semEmpresa = React.useMemo(() => clients.filter((c) => !c.archivedAt && !c.unidade), [clients])

  // Os números do topo seguem a aba: em "NX SISTEMA", é o MRR da NX Sistema.
  const ativos = React.useMemo(
    () => clients.filter((c) => {
      if (c.archivedAt || !ETAPAS_ATIVAS.has(c.stage)) return false
      return unidadeAtiva ? c.unidade === unidadeAtiva : true
    }),
    [clients, unidadeAtiva],
  )
  const mrrAtivo = ativos.reduce((acc, c) => acc + centsDoCliente(c.monthlyValue), 0)
  const comValor = ativos.filter((c) => (c.monthlyValue ?? 0) > 0).length
  const mrrPerdido = cancelamentosDoMes.filter((c) => !c.reactivatedAt).reduce((acc, c) => acc + c.mrrCents, 0)
  const multasDoMes = cancelamentosDoMes.reduce((acc, c) => acc + c.multaCents, 0)
  // Saiu daqui mas continua sendo cobrado no Asaas — é o que vira reclamação e estorno depois.
  const pendentesAsaas = cancelamentos.filter((c) => !c.reactivatedAt && !c.asaasRemovido).length
  const cancelados = cancelamentosDoMes.filter((c) => !c.reactivatedAt).length
  // Churn do mês = quem saiu sobre a base que existia no começo do mês (ativos de hoje + quem saiu).
  const churn = ativos.length + cancelados > 0 ? (cancelados / (ativos.length + cancelados)) * 100 : 0

  const lista = React.useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return clients
      .filter((c) => !c.archivedAt)
      .filter((c) => (verSemEmpresa ? !c.unidade : c.unidade === unidadeAtiva))
      .filter((c) => {
        if (status === 'ativos') return c.stage !== 'churned'
        if (status === 'cancelados') return c.stage === 'churned'
        return true
      })
      .filter((c) => {
        if (!termo) return true
        if ([c.name, c.company, c.phone].some((v) => (v ?? '').toLowerCase().includes(termo))) return true
        // CNPJ: compara só os dígitos dos dois lados, então acha tanto quem digita
        // "05.490.849/0001-04" quanto "05490849" ou o número colado.
        const digitos = termo.replace(/\D/g, '')
        return digitos.length >= 3 && (c.cnpj ?? '').replace(/\D/g, '').includes(digitos)
      })
      .sort((a, b) => centsDoCliente(b.monthlyValue) - centsDoCliente(a.monthlyValue) || (a.name ?? '').localeCompare(b.name ?? ''))
  }, [clients, busca, status, unidadeAtiva, verSemEmpresa])

  const semValorComSugestao = React.useMemo(
    () => lista.filter((c) => (c.monthlyValue ?? 0) === 0 && sugestoes[c.id]?.mrrCents),
    [lista, sugestoes],
  )

  const aplicarSugestao = (cliente: Client) => {
    const s = sugestoes[cliente.id]
    if (!s) return
    const patch: Partial<Client> = {}
    if ((cliente.monthlyValue ?? 0) === 0 && s.mrrCents) patch.monthlyValue = s.mrrCents / 100
    if ((cliente.implementationValue ?? 0) === 0 && s.implCents) patch.implementationValue = s.implCents / 100
    if (Object.keys(patch).length) void db.updateClient(cliente.id, patch)
  }

  return (
    <>
      <TopBar
        title="CLIENTES GERAL"
        subtitle="Financeiro"
        breadcrumbs={[{ label: 'Grupo NX Digital', to: '/' }, { label: 'Financeiro' }, { label: 'Clientes Geral' }]}
      />

      <div className="px-4 pb-10 lg:px-6">
        {/* Mês — manda nos números de cancelamento e na aba de baixo */}
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMes((m) => addMonthsToId(m, -1))}
            className="grid h-8 w-8 place-items-center rounded-lg text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
            title="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[150px] text-center text-sm font-semibold text-foreground">{monthLabelPt(mes)}</span>
          <button
            type="button"
            onClick={() => setMes((m) => addMonthsToId(m, 1))}
            className="grid h-8 w-8 place-items-center rounded-lg text-foreground/50 hover:bg-elevate/[0.05] hover:text-foreground"
            title="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {mes !== currentMonthId() && (
            <button
              type="button"
              onClick={() => setMes(currentMonthId())}
              className="rounded-lg px-2 py-1 text-xs text-accent hover:bg-accent/10"
            >
              Voltar pro mês atual
            </button>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={sincronizarAsaas}
            disabled={sincronizando}
            title="Relê as assinaturas do Asaas e atualiza as mensalidades"
            className="ml-auto"
          >
            {sincronizando
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Atualizar do Asaas
          </Button>
        </div>

        {/* Painel do mês */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card icon={<Users className="h-4 w-4" />}
            label={unidadeAtiva ? `Ativos ${UNIDADE_CURTA[unidadeAtiva]}` : 'Clientes ativos'}
            value={String(ativos.length)}
            hint={`${comValor} com mensalidade preenchida`} />
          <Card icon={<Wallet className="h-4 w-4" />} label="MRR ativo" value={formatBRLCents(mrrAtivo)}
            hint="soma das mensalidades" tone="success" />
          <Card icon={<Wallet className="h-4 w-4" />} label="Ticket médio"
            value={formatBRLCents(comValor ? Math.round(mrrAtivo / comValor) : 0)}
            hint="entre quem tem valor" />
          <Card icon={<UserMinus className="h-4 w-4" />} label={`Cancelados em ${monthLabelPt(mes)}`}
            value={String(cancelados)} hint={`${churn.toFixed(1)}% da base`} tone={cancelados ? 'danger' : undefined} />
          <Card icon={<TrendingDown className="h-4 w-4" />} label="MRR perdido no mês"
            value={formatBRLCents(mrrPerdido)}
            hint={multasDoMes ? `+ ${formatBRLCents(multasDoMes)} de multa` : 'mensalidade que saiu'}
            tone={mrrPerdido ? 'danger' : undefined} />
        </div>

        {/* Abas */}
        <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-line">
          {UNIDADES.map((u) => (
            <AbaBotao
              key={u.valor}
              ativa={aba === u.valor}
              onClick={() => { setAba(u.valor); setVerSemEmpresa(false) }}
            >
              {u.label} ({clients.filter((c) => !c.archivedAt && c.unidade === u.valor).length})
            </AbaBotao>
          ))}
          <AbaBotao ativa={aba === 'cancelamentos'} onClick={() => setAba('cancelamentos')}>
            CANCELAMENTOS GERAL ({cancelamentosDoMes.length})
          </AbaBotao>
        </div>

        {pendentesAsaas > 0 && (
          <button
            type="button"
            onClick={() => setAba('cancelamentos')}
            className="mt-3 flex w-full items-center gap-2 rounded-xl bg-warning/10 px-4 py-2.5 text-left text-sm text-warning hover:bg-warning/15"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {pendentesAsaas} cliente(s) cancelado(s) ainda sem baixa no Asaas — continuam sendo cobrados lá.
            </span>
          </button>
        )}

        {aba !== 'cancelamentos' && semEmpresa.length > 0 && (
          <button
            type="button"
            onClick={() => setVerSemEmpresa((v) => !v)}
            className={cn(
              'mt-3 flex w-full items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors',
              verSemEmpresa ? 'bg-accent/15 text-accent' : 'bg-elevate/[0.05] text-foreground/70 hover:bg-elevate/[0.08]',
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {verSemEmpresa
                ? `Mostrando os ${semEmpresa.length} clientes sem empresa definida — escolha a empresa de cada um na coluna "Empresa do grupo". Clique aqui pra voltar.`
                : `${semEmpresa.length} cliente(s) ainda sem empresa do grupo definida — clique pra classificar.`}
            </span>
          </button>
        )}

        {aba !== 'cancelamentos' ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/30" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por cliente, empresa, telefone ou CNPJ…"
                  className="pl-9"
                />
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as FiltroStatus)}
                className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground outline-none"
              >
                <option value="ativos">Só ativos</option>
                <option value="cancelados">Só cancelados</option>
                <option value="todos">Todos</option>
              </select>
              {semValorComSugestao.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => semValorComSugestao.forEach(aplicarSugestao)}
                  title="Preenche a mensalidade de quem já tem venda registrada com valor"
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  Puxar {semValorComSugestao.length} valor(es) das vendas
                </Button>
              )}
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Empresa</th>
                      <th className="w-40 px-4 py-3">Telefone</th>
                      <th className="w-40 px-4 py-3">Empresa do grupo</th>
                      <th className="w-40 px-4 py-3 text-right">Mensalidade</th>
                      <th className="w-40 px-4 py-3 text-right">Implementação</th>
                      <th className="w-28 px-4 py-3">Situação</th>
                      <th className="w-28 px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {lista.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-foreground/40">
                          {semEmpresa.length > 0 && !verSemEmpresa
                            ? 'Nenhum cliente nesta empresa ainda — use o aviso acima pra classificar quem está sem.'
                            : 'Nenhum cliente com esses filtros.'}
                        </td>
                      </tr>
                    )}
                    {lista.map((c) => (
                      <LinhaCliente
                        key={c.id}
                        cliente={c}
                        sugestao={sugestoes[c.id]}
                        onAbrir={() => setDrawerId(c.id)}
                        onCancelar={() => setCancelando(c)}
                        onAplicarSugestao={() => aplicarSugestao(c)}
                      />
                    ))}
                  </tbody>
                  {lista.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                        <td className="px-4 py-3">Total ({lista.length})</td>
                        <td /><td /><td />
                        <td className="px-4 py-3 text-right tabular-nums text-success">
                          {formatBRLCents(lista.reduce((a, c) => a + centsDoCliente(c.monthlyValue), 0))}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-success">
                          {formatBRLCents(lista.reduce((a, c) => a + centsDoCliente(c.implementationValue), 0))}
                        </td>
                        <td /><td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </>
        ) : (
          <ListaCancelamentos
            itens={cancelamentosDoMes}
            mes={mes}
            todos={cancelamentos}
            onAbrirCliente={(id) => setDrawerId(id)}
          />
        )}
      </div>

      <ClientDrawer clientId={drawerId} onClose={() => setDrawerId(null)} />
      <CancelarClienteModal cliente={cancelando} onClose={() => setCancelando(null)} />
    </>
  )
}

function AbaBotao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
        ativa ? 'border-accent text-foreground' : 'border-transparent text-foreground/50 hover:text-foreground/80',
      )}
    >
      {children}
    </button>
  )
}

function Card({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; tone?: 'success' | 'danger'
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-foreground/45">
        <span className="text-foreground/35">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <p className={cn(
        'mt-2 text-xl font-semibold tabular-nums',
        tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-foreground',
      )}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-foreground/40">{hint}</p>}
    </div>
  )
}

function LinhaCliente({ cliente, sugestao, onAbrir, onCancelar, onAplicarSugestao }: {
  cliente: Client
  sugestao: Sugestao | undefined
  onAbrir: () => void
  onCancelar: () => void
  onAplicarSugestao: () => void
}) {
  const cancelado = cliente.stage === 'churned'
  const semMrr = (cliente.monthlyValue ?? 0) === 0
  const podeSugerir = semMrr && !!sugestao?.mrrCents

  return (
    <tr className="group border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
      <td className="px-4 py-2.5">
        <button
          type="button"
          onClick={onAbrir}
          className={cn('text-left text-sm font-medium hover:text-accent hover:underline', cancelado ? 'text-foreground/50' : 'text-foreground')}
          title="Abrir o cadastro do cliente"
        >
          {cliente.name || '—'}
        </button>
      </td>
      <td className="px-4 py-2.5 text-sm text-foreground/70">
        {cliente.company || '—'}
        {cliente.cnpj && (
          <span className="block text-[11px] tabular-nums text-foreground/35">{formatarCnpj(cliente.cnpj)}</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm tabular-nums text-foreground/60">{cliente.phone || '—'}</td>
      <td className="px-4 py-2.5">
        <select
          value={cliente.unidade ?? ''}
          onChange={(e) => void db.updateClient(cliente.id, { unidade: (e.target.value || undefined) as Client['unidade'] })}
          className={cn(
            'w-full rounded-md bg-elevate/[0.05] px-2 py-1 text-sm outline-none',
            cliente.unidade ? 'text-foreground' : 'text-danger',
          )}
        >
          <option value="">— definir —</option>
          {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{UNIDADE_CURTA[u.valor]}</option>)}
        </select>
      </td>
      <td className="px-4 py-2.5 text-right">
        <CelulaValor
          cents={centsDoCliente(cliente.monthlyValue)}
          onSalvar={(cents) => void db.updateClient(cliente.id, { monthlyValue: cents ? cents / 100 : undefined })}
        />
        {podeSugerir && (
          <button
            type="button"
            onClick={onAplicarSugestao}
            title={`A venda desse cliente está registrada com ${formatBRLCents(sugestao!.mrrCents)} (ligação por ${sugestao!.origem})`}
            className="mt-0.5 block w-full text-right text-[11px] text-accent hover:underline"
          >
            usar {formatBRLCents(sugestao!.mrrCents)} da venda
          </button>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <CelulaValor
          cents={centsDoCliente(cliente.implementationValue)}
          onSalvar={(cents) => void db.updateClient(cliente.id, { implementationValue: cents ? cents / 100 : undefined })}
        />
      </td>
      <td className="px-4 py-2.5">
        <span className={cn(
          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
          cancelado ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
        )}>
          {cancelado ? 'Cancelado' : 'Ativo'}
        </span>
      </td>
      <td className="px-2 py-2.5 text-right">
        {!cancelado && (
          <button
            type="button"
            onClick={onCancelar}
            title="Registrar cancelamento desse cliente"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
          >
            <UserMinus className="h-3.5 w-3.5" />
            Cancelar
          </button>
        )}
      </td>
    </tr>
  )
}

/** Valor em reais editável direto na lista — o cadastro do cliente nunca teve esses campos
 * preenchidos, então digitar aqui é o caminho mais curto pra base ficar completa. */
function CelulaValor({ cents, onSalvar }: { cents: number; onSalvar: (cents: number) => void }) {
  const [editando, setEditando] = React.useState(false)
  const [raw, setRaw] = React.useState('')

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => { setRaw(cents ? prettifyCurrencyRaw(String(cents)) : ''); setEditando(true) }}
        className={cn(
          'w-full rounded px-1 py-0.5 text-right text-sm tabular-nums hover:bg-elevate/[0.06]',
          cents ? 'text-foreground' : 'text-foreground/25',
        )}
      >
        {cents ? formatBRLCents(cents) : 'R$ 0,00'}
      </button>
    )
  }

  const salvar = () => {
    setEditando(false)
    const novo = parseBRLCents(raw)
    if (novo !== cents) onSalvar(novo)
  }

  return (
    <input
      autoFocus
      value={raw}
      onChange={(e) => setRaw(sanitizeCurrencyRaw(e.target.value))}
      onBlur={salvar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') salvar()
        if (e.key === 'Escape') setEditando(false)
      }}
      placeholder="0,00"
      className="w-full rounded bg-elevate/[0.06] px-1 py-0.5 text-right text-sm tabular-nums text-foreground outline-none ring-1 ring-accent/40"
    />
  )
}

function ListaCancelamentos({ itens, mes, todos, onAbrirCliente }: {
  itens: ClientCancellation[]
  mes: string
  todos: ClientCancellation[]
  onAbrirCliente: (id: string) => void
}) {
  // Últimos 6 meses ao lado, pra dar o "e nos meses anteriores?" sem precisar navegar mês a mês.
  const historico = React.useMemo(() => {
    const meses = Array.from({ length: 6 }, (_, i) => addMonthsToId(mes, -i))
    return meses.map((m) => {
      const b = monthIdBounds(m)
      const doMes = todos.filter((c) => c.canceledAt >= b.from.slice(0, 10) && c.canceledAt <= b.to.slice(0, 10) && !c.reactivatedAt)
      return { mes: m, qtd: doMes.length, cents: doMes.reduce((a, c) => a + c.mrrCents, 0) }
    })
  }, [mes, todos])

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className="overflow-hidden rounded-2xl bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-foreground/50">
                <th className="w-28 px-4 py-3">Data</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="w-48 px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Observação</th>
                <th className="w-32 px-4 py-3 text-right">MRR perdido</th>
                <th className="w-28 px-4 py-3 text-right">Multa</th>
                <th className="w-28 px-4 py-3 text-center">Asaas</th>
                <th className="w-28 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {itens.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-foreground/40">
                    Nenhum cancelamento em {monthLabelPt(mes)}.
                  </td>
                </tr>
              )}
              {itens.map((c) => (
                <tr key={c.id} className="group border-b border-line/60 last:border-0 hover:bg-elevate/[0.04]">
                  <td className="px-4 py-2.5 text-sm tabular-nums text-foreground/60">
                    {c.canceledAt.split('-').reverse().join('/')}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => onAbrirCliente(c.clientId)}
                      className="text-left text-sm font-medium text-foreground hover:text-accent hover:underline"
                    >
                      {c.clientName || c.clientCompany || '—'}
                    </button>
                    {c.reactivatedAt && (
                      <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                        reativado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-foreground/70">{c.motivo || '—'}</td>
                  <td className="px-4 py-2.5">
                    <ObservacaoCell cancelamento={c} />
                  </td>
                  <td className={cn('px-4 py-2.5 text-right text-sm font-medium tabular-nums', c.reactivatedAt ? 'text-foreground/35 line-through' : 'text-danger')}>
                    {formatBRLCents(c.mrrCents)}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right text-sm tabular-nums', c.multaCents ? 'text-success' : 'text-foreground/25')}>
                    {c.multaCents ? formatBRLCents(c.multaCents) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => void clientCancellationsService.atualizar(c.id, { asaasRemovido: !c.asaasRemovido })}
                      title={c.asaasRemovido ? 'Cobrança já cancelada no Asaas — clique pra desmarcar' : 'Ainda sendo cobrado no Asaas — clique quando der baixa'}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                        c.asaasRemovido ? 'bg-success/10 text-success' : 'bg-warning/15 text-warning hover:bg-warning/25',
                      )}
                    >
                      {c.asaasRemovido ? 'baixado' : 'pendente'}
                    </button>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100">
                      {!c.reactivatedAt && (
                        <button
                          type="button"
                          onClick={() => void clientCancellationsService.reativar(c.id)}
                          title="Cliente voltou — volta pra ativo (o cancelamento continua no histórico deste mês)"
                          className="grid h-7 w-7 place-items-center rounded-lg text-foreground/40 hover:bg-success/10 hover:text-success"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm('Excluir esse registro de cancelamento? O cliente volta a ficar ativo.')) return
                          void clientCancellationsService.excluir(c.id)
                        }}
                        title="Registrei errado — apaga o cancelamento"
                        className="grid h-7 w-7 place-items-center rounded-lg text-foreground/40 hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {itens.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line bg-elevate/[0.03] text-sm font-semibold text-foreground">
                  <td className="px-4 py-3">Total</td>
                  <td /><td /><td />
                  <td className="px-4 py-3 text-right tabular-nums text-danger">
                    {formatBRLCents(itens.filter((c) => !c.reactivatedAt).reduce((a, c) => a + c.mrrCents, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-success">
                    {formatBRLCents(itens.reduce((a, c) => a + c.multaCents, 0))}
                  </td>
                  <td /><td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="rounded-2xl bg-card p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Últimos 6 meses</p>
        <div className="mt-3 space-y-2">
          {historico.map((h) => (
            <div key={h.mes} className="flex items-center justify-between text-sm">
              <span className={cn('capitalize', h.mes === mes ? 'font-semibold text-foreground' : 'text-foreground/60')}>
                {monthLabelPt(h.mes)}
              </span>
              <span className="text-right">
                <span className="text-foreground/70">{h.qtd}</span>
                <span className={cn('ml-2 tabular-nums', h.cents ? 'text-danger' : 'text-foreground/30')}>
                  {formatBRLCents(h.cents)}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ObservacaoCell({ cancelamento }: { cancelamento: ClientCancellation }) {
  const [texto, setTexto] = React.useState(cancelamento.observacao)
  React.useEffect(() => { setTexto(cancelamento.observacao) }, [cancelamento.observacao])

  return (
    <input
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => {
        if (texto !== cancelamento.observacao) void clientCancellationsService.atualizar(cancelamento.id, { observacao: texto })
      }}
      placeholder="—"
      className="w-full rounded bg-transparent px-1 py-0.5 text-sm text-foreground/70 outline-none placeholder:text-foreground/25 hover:bg-elevate/[0.06] focus:bg-elevate/[0.06]"
    />
  )
}

function CancelarClienteModal({ cliente, onClose }: { cliente: Client | null; onClose: () => void }) {
  const [data, setData] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [motivo, setMotivo] = React.useState(MOTIVOS[0])
  const [observacao, setObservacao] = React.useState('')
  const [multaRaw, setMultaRaw] = React.useState('')
  const [asaasRemovido, setAsaasRemovido] = React.useState(false)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!cliente) return
    setData(new Date().toISOString().slice(0, 10))
    setMotivo(MOTIVOS[0])
    setObservacao('')
    setMultaRaw('')
    setAsaasRemovido(false)
  }, [cliente])

  if (!cliente) return null

  const mrrCents = Math.round((cliente.monthlyValue ?? 0) * 100)

  const confirmar = async () => {
    setSalvando(true)
    await clientCancellationsService.cancelar({
      clientId: cliente.id,
      canceledAt: data,
      motivo,
      observacao: observacao.trim(),
      mrrCents,
      multaCents: parseBRLCents(multaRaw),
      asaasRemovido,
    })
    setSalvando(false)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Cancelar ${cliente.name || cliente.company}`}>
      <div className="space-y-4">
        <p className="text-sm text-foreground/60">
          O cliente sai da base ativa e entra no histórico de cancelamentos do mês. Nada é apagado — se ele voltar,
          é só reativar na aba Cancelamentos.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Data do cancelamento</label>
            <DatePickerField value={data} onChange={(v) => setData(v ?? '')} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Mensalidade que sai</label>
            {/* Não é campo: é a mensalidade do próprio cliente, registrada como está hoje. Digitar
                de novo só criaria chance de errar o valor que já está na tela. */}
            <p className="rounded-lg border border-line bg-elevate/[0.04] px-3 py-2 text-right text-sm font-medium tabular-nums text-danger">
              {formatBRLCents(mrrCents)}
            </p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Multa de rescisão cobrada</label>
          <Input
            value={multaRaw}
            onChange={(e) => setMultaRaw(sanitizeCurrencyRaw(e.target.value))}
            placeholder="0,00 — deixe vazio se não teve"
            className="text-right tabular-nums"
          />
        </div>

        <label className={cn(
          'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
          asaasRemovido ? 'border-success/40 bg-success/5' : 'border-warning/40 bg-warning/5',
        )}>
          <input
            type="checkbox"
            checked={asaasRemovido}
            onChange={(e) => setAsaasRemovido(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-foreground">Já tirei a cobrança do Asaas</span>
            <span className="mt-0.5 block text-xs text-foreground/55">
              {asaasRemovido
                ? 'Assinatura cancelada lá — não vai gerar cobrança nova.'
                : 'Se não marcar, ele fica na lista de pendências até você dar baixa.'}
            </span>
          </span>
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Motivo</label>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground outline-none"
          >
            {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-foreground/60">Observação</label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={3}
            placeholder="O que aconteceu, o que ele falou, se dá pra recuperar…"
            className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground/30"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Voltar</Button>
          <Button variant="danger" onClick={confirmar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <UserMinus className="mr-1.5 h-3.5 w-3.5" />}
            Confirmar cancelamento
          </Button>
        </div>
      </div>
    </Modal>
  )
}
