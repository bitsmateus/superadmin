import * as React from 'react'
import { ArrowRight, Pin, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { CampoData, DataMiuda } from '@/components/gestaoClientes/CampoData'
import { RotinaMensal } from '@/components/gestaoClientes/RotinaMensal'
import { ResumoPlanejamento } from '@/components/gestaoClientes/ResumoPlanejamento'
import {
  comDerivadas, formatarMetrica, mesAtual, mesPorExtenso, numeroDigitado,
} from '@/lib/gcMetricas'
import { DIAS_AVISO_RENOVACAO, avaliarSaude, type Destino } from '@/lib/gcSaude'
import { AvaliacaoDoResultado, PainelSaude } from '@/components/gestaoClientes/Semaforo'
import {
  PRIORIDADES, TIPOS_SERVICO, gestaoClientes,
  type GcClienteDetalhe, type GcServico, type GcTipoServico,
} from '@/services/gestaoClientes'

const STATUS_SERVICO: { valor: GcServico['status']; label: string }[] = [
  { valor: 'ativo', label: 'Ativo' },
  { valor: 'pausado', label: 'Pausado' },
  { valor: 'cancelado', label: 'Cancelado' },
]

function dataBr(valor: string | null | undefined): string {
  if (!valor) return '—'
  const [a, m, d] = String(valor).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

function reais(valor: string | null): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/** Um dado do cadastro: rótulo pequeno em cima, valor embaixo. */
function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-foreground/45">{rotulo}</dt>
      <dd className="mt-0.5 text-sm text-foreground/85">{valor || '—'}</dd>
    </div>
  )
}

/**
 * Aviso de renovação de um serviço: sem data, vencida, ou chegando (menos de 45 dias). Só pra
 * serviço ativo — um serviço cancelado não renova, e avisar dele seria ruído.
 */
function AvisoDeRenovacao({ data, ativo }: { data: string | null; ativo: boolean }) {
  if (!ativo) return null
  if (!data) {
    return (
      <span className="mt-0.5 block text-xs font-medium text-danger">
        Sem data de renovação — informe ao lado pra ser avisado do fim do contrato
      </span>
    )
  }
  const quando = new Date(`${String(data).slice(0, 10)}T12:00:00`).getTime()
  const dias = Math.round((quando - Date.now()) / 86400000)
  if (dias > DIAS_AVISO_RENOVACAO) return null
  return (
    <span className="mt-0.5 block text-xs font-medium text-danger">
      {dias < 0
        ? `Renovação venceu há ${Math.abs(dias)} dia(s)`
        : dias === 0
          ? 'Renovação vence hoje'
          : `Renova em ${dias} dia(s) — hora de conversar com o cliente`}
    </span>
  )
}

/** Serviço novo — aparece no fim da lista quando a pessoa clica em "Adicionar serviço". */
function FormServico({
  clienteId,
  onPronto,
  onCancelar,
}: {
  clienteId: string
  onPronto: () => Promise<void> | void
  onCancelar: () => void
}) {
  const [tipo, setTipo] = React.useState<GcTipoServico>('trafego_meta')
  const [plano, setPlano] = React.useState('')
  const [investimento, setInvestimento] = React.useState('')
  const [inicio, setInicio] = React.useState<string | null>(null)
  const [renovacao, setRenovacao] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!renovacao) {
      toast.error('Informe a data de renovação do serviço')
      return
    }
    setSalvando(true)
    try {
      await gestaoClientes.criarServico(clienteId, {
        tipo,
        descricao_plano: plano,
        // Campo em branco é "não sei ainda", não zero: zero diria que o cliente não investe nada.
        investimento_previsto_mensal: numeroDigitado(investimento),
        data_inicio: inicio,
        data_renovacao: renovacao,
      })
      await onPronto()
      onCancelar()
    } catch (err) {
      toast.error('Falha ao adicionar o serviço: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form onSubmit={salvar} className="rounded-xl border border-accent/30 bg-accent/[0.02] p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Serviço"
          options={TIPOS_SERVICO.map((t) => ({ value: t.valor, label: t.label }))}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as GcTipoServico)}
        />
        <Input
          label="Investimento previsto / mês"
          value={investimento}
          onChange={(e) => setInvestimento(e.target.value)}
          placeholder="1.500,00"
        />
        <div className="sm:col-span-2">
          <Input
            label="Plano"
            value={plano}
            onChange={(e) => setPlano(e.target.value)}
            placeholder="O que está contratado nesse serviço"
          />
        </div>
        <CampoData label="Início" value={inicio} onChange={setInicio} />
        <CampoData
          label="Renovação *"
          value={renovacao}
          onChange={setRenovacao}
          hint={`obrigatória — o painel avisa quando faltar menos de ${DIAS_AVISO_RENOVACAO} dias`}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button size="sm" type="submit" loading={salvando}>
          Adicionar
        </Button>
      </div>
    </form>
  )
}

/**
 * As notas FIXADAS do cliente, repetidas aqui de propósito: são os combinados que a pessoa precisa
 * ver antes de falar com o cliente, e ninguém abre a aba de notas antes de uma ligação.
 */
function QuadroDeAvisos({
  detalhe,
  onVerNotas,
}: {
  detalhe: GcClienteDetalhe
  onVerNotas?: () => void
}) {
  const fixadas = detalhe.historico.filter((h) => h.fixado)
  return (
    <section className="rounded-xl border border-line p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Pin className="h-4 w-4 text-accent" /> Avisos fixados
        </h2>
        {onVerNotas && (
          <button
            type="button"
            onClick={onVerNotas}
            className="flex items-center gap-1 text-xs text-foreground/50 transition-colors hover:text-accent"
          >
            abrir as notas <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      {fixadas.length === 0 ? (
        <p className="text-sm text-foreground/45">
          Nada fixado. Na aba de notas dá pra fixar o que todo mundo precisa ver antes de falar com
          esse cliente.
        </p>
      ) : (
        <ul className="space-y-2">
          {fixadas.slice(0, 4).map((n) => (
            <li key={n.id} className="rounded-lg border border-accent/20 bg-accent/[0.03] px-3 py-2">
              <p className="whitespace-pre-wrap text-sm text-foreground/85">{n.descricao || n.titulo}</p>
              <p className="mt-0.5 text-xs text-foreground/45">
                {n.autor_nome ?? 'equipe'} ·{' '}
                {new Date(n.created_at).toLocaleDateString('pt-BR')}
                {(n.anexos ?? []).length > 0 ? ` · ${n.anexos.length} anexo(s)` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Investido × vendido × receita do mês corrente — as três perguntas que o cliente faz e que a
 * pessoa que cuida da conta precisa responder sem abrir outra aba.
 */
function ResumoDoMes({ cliente }: { cliente: GcClienteDetalhe['cliente'] }) {
  const v = comDerivadas(cliente.metricas_mes ?? {})
  const vazio = Object.keys(cliente.metricas_mes ?? {}).length === 0
  if (vazio) {
    return (
      <p className="text-sm text-foreground/50">
        Nada lançado neste mês ainda. Sem isso não dá pra dizer se o mês foi bom — a aba "Métricas e
        metas" é onde entra.
      </p>
    )
  }
  const linhas: { rotulo: string; valor: string; destaque?: boolean }[] = [
    { rotulo: 'Investido', valor: formatarMetrica(v.investimento ?? null, 'reais'), destaque: true },
    { rotulo: 'Leads', valor: formatarMetrica(v.leads ?? null, 'inteiro') },
    { rotulo: 'Vendas', valor: formatarMetrica(v.vendas ?? null, 'inteiro'), destaque: true },
    { rotulo: 'Receita', valor: formatarMetrica(v.receita ?? null, 'reais'), destaque: true },
    { rotulo: 'Retorno', valor: v.roas === undefined ? '—' : `${v.roas.toFixed(2).replace('.', ',')}x` },
  ]
  return (
    <div className="space-y-1.5 text-sm">
      {linhas.map((l) => (
        <div key={l.rotulo} className="flex items-center justify-between gap-3">
          <span className="text-foreground/60">{l.rotulo}</span>
          <span
            className={
              l.destaque
                ? 'font-semibold tabular-nums text-foreground'
                : 'tabular-nums text-foreground/85'
            }
          >
            {l.valor}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * Visão geral do cliente: o cadastro, os serviços contratados e as observações.
 *
 * O cadastro é só leitura aqui — editar abre o mesmo modal do "Novo cliente", pra não existirem
 * dois formulários diferentes pros mesmos campos.
 */
export function AbaVisaoGeral({
  detalhe,
  onMudou,
  onVerNotas,
  onIr,
}: {
  detalhe: GcClienteDetalhe
  onMudou: () => Promise<void> | void
  /** Chamado ao clicar num sinal do semáforo — a página sabe trocar de aba e abrir janelas. */
  onIr?: (d: Destino) => void
  /** Leva pra aba de notas — o quadro de avisos daqui é só a prévia do que está fixado lá. */
  onVerNotas?: () => void
}) {
  const { cliente, servicos } = detalhe
  const [adicionando, setAdicionando] = React.useState(false)

  const excluirServico = async (id: string) => {
    try {
      await gestaoClientes.excluirServico(id)
      await onMudou()
    } catch (err) {
      toast.error('Falha ao excluir: ' + (err as Error).message)
    }
  }

  const trocarRenovacao = async (id: string, data: string | null) => {
    // A data é obrigatória: o seletor deixa limpar, mas o servidor recusa — então nem tenta.
    if (!data) {
      toast.error('A data de renovação é obrigatória — escolha outra data em vez de apagar')
      return
    }
    try {
      await gestaoClientes.atualizarServico(id, { data_renovacao: data })
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  const trocarStatus = async (id: string, status: GcServico['status']) => {
    try {
      await gestaoClientes.atualizarServico(id, { status })
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <PainelSaude saude={avaliarSaude(cliente)} onIr={onIr}>
          <AvaliacaoDoResultado
            clienteId={cliente.id}
            avaliacao={cliente.avaliacao}
            periodoRotulo={mesPorExtenso(mesAtual())}
            onMudou={onMudou}
          />
        </PainelSaude>

        <section className="rounded-xl border border-line p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Cadastro</h2>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo rotulo="Contato" valor={cliente.nome_contato} />
            <Campo rotulo="WhatsApp" valor={cliente.whatsapp_contato} />
            <Campo rotulo="E-mail" valor={cliente.email_contato} />
            <Campo rotulo="CNPJ" valor={cliente.cnpj} />
            <Campo rotulo="Cidade" valor={cliente.cidade} />
            <Campo rotulo="Segmento" valor={cliente.segmento} />
            <Campo rotulo="Responsável" valor={cliente.responsavel_nome} />
            <Campo rotulo="Início" valor={dataBr(cliente.data_inicio)} />
          </dl>
        </section>

        <section id="gc-servicos" className="rounded-xl border border-line p-4 transition-shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Serviços contratados</h2>
            {!adicionando && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => setAdicionando(true)}
              >
                Adicionar serviço
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {servicos.length === 0 && !adicionando && (
              <p className="py-4 text-center text-sm text-foreground/50">
                Nenhum serviço registrado.
              </p>
            )}
            {servicos.map((s) => (
              <div
                key={s.id}
                className="group flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {TIPOS_SERVICO.find((t) => t.valor === s.tipo)?.label ?? s.tipo}
                  </span>
                  <span className="block truncate text-xs text-foreground/50">
                    {s.descricao_plano || 'sem descrição'} · início {dataBr(s.data_inicio)}
                  </span>
                  <AvisoDeRenovacao data={s.data_renovacao} ativo={s.status === 'ativo'} />
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground/50">
                  renova
                  <DataMiuda
                    value={s.data_renovacao ? String(s.data_renovacao).slice(0, 10) : null}
                    atrasado={!s.data_renovacao && s.status === 'ativo'}
                    onChange={(v) => void trocarRenovacao(s.id, v)}
                  />
                </span>
                <span className="text-sm tabular-nums text-foreground/80">
                  {reais(s.investimento_previsto_mensal)}
                </span>
                <Select
                  options={STATUS_SERVICO.map((o) => ({ value: o.valor, label: o.label }))}
                  value={s.status}
                  onChange={(e) => void trocarStatus(s.id, e.target.value as GcServico['status'])}
                  className="w-32"
                />
                <button
                  type="button"
                  onClick={() => void excluirServico(s.id)}
                  className="text-foreground/25 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  aria-label="Excluir serviço"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {adicionando && (
              <FormServico
                clienteId={cliente.id}
                onPronto={onMudou}
                onCancelar={() => setAdicionando(false)}
              />
            )}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <QuadroDeAvisos detalhe={detalhe} onVerNotas={onVerNotas} />

        <ResumoPlanejamento cliente={cliente} onAbrir={() => onIr?.('planejamento')} />

        <RotinaMensal itens={detalhe.rotina ?? []} onMudou={onMudou} />

        <section className="rounded-xl border border-line p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Observações</h2>
          {cliente.observacoes_gerais ? (
            <p className="whitespace-pre-wrap text-sm text-foreground/80">
              {cliente.observacoes_gerais}
            </p>
          ) : (
            <p className="text-sm text-foreground/45">
              Nada anotado. Use "Editar cliente" pra registrar combinados e particularidades.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-line p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">O mês até agora</h2>
          <ResumoDoMes cliente={cliente} />
        </section>

        <section className="rounded-xl border border-line p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Onde o cliente está</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-foreground/60">Etapa atual</span>
              <span className="text-right font-medium text-foreground">
                {detalhe.jornada.find((j) => j.status !== 'concluida')?.nome ?? 'Jornada concluída'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground/60">Etapas concluídas</span>
              <span className="tabular-nums text-foreground/85">
                {detalhe.jornada.filter((j) => j.status === 'concluida').length} de{' '}
                {detalhe.jornada.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground/60">Prioridade</span>
              <span
                className={
                  cliente.prioridade === 'alta'
                    ? 'font-medium text-danger'
                    : cliente.prioridade === 'baixa'
                      ? 'text-foreground/50'
                      : 'text-foreground/85'
                }
                title={PRIORIDADES.find((p) => p.valor === cliente.prioridade)?.ajuda}
              >
                {PRIORIDADES.find((p) => p.valor === (cliente.prioridade ?? 'media'))?.label}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-foreground/60">Status</span>
              <Badge
                tone={
                  cliente.status === 'ativo'
                    ? 'success'
                    : cliente.status === 'pausado'
                      ? 'warning'
                      : 'neutral'
                }
                dot
              >
                {cliente.status}
              </Badge>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
