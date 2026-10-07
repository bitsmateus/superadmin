import * as React from 'react'
import { ArrowRight, Pin, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { RotinaMensal } from '@/components/gestaoClientes/RotinaMensal'
import { ResumoPlanejamento } from '@/components/gestaoClientes/ResumoPlanejamento'
import { mesAtual, mesPorExtenso } from '@/lib/gcMetricas'
import { useAvisoAoSair } from '@/hooks/useAvisoAoSair'
import { avaliarSaude, type Destino } from '@/lib/gcSaude'
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

/** Serviço novo — o serviço e o que ele contempla. Sem datas: aqui é só "o que foi contratado". */
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
  const [contempla, setContempla] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await gestaoClientes.criarServico(clienteId, { tipo, descricao_plano: contempla.trim() })
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
      <Select
        label="Serviço"
        options={TIPOS_SERVICO.map((t) => ({ value: t.valor, label: t.label }))}
        value={tipo}
        onChange={(e) => setTipo(e.target.value as GcTipoServico)}
      />
      <div className="mt-3">
        <Textarea
          label="O que contempla"
          rows={3}
          value={contempla}
          onChange={(e) => setContempla(e.target.value)}
          placeholder="Ex.: gestão de tráfego no Meta Ads, 3 criativos por mês, relatório mensal…"
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

/** Um serviço contratado: o nome, o que contempla (edita ao sair do campo), o status e a lixeira. */
function LinhaDeServico({
  servico: s,
  onMudou,
}: {
  servico: GcServico
  onMudou: () => Promise<void> | void
}) {
  const [contempla, setContempla] = React.useState(s.descricao_plano ?? '')
  React.useEffect(() => setContempla(s.descricao_plano ?? ''), [s.descricao_plano])

  const agir = async (fn: () => Promise<unknown>, falha: string) => {
    try {
      await fn()
      await onMudou()
    } catch (err) {
      toast.error(falha + (err as Error).message)
    }
  }

  return (
    <div className="group rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-foreground">{TIPOS_SERVICO.find((t) => t.valor === s.tipo)?.label ?? s.tipo}</span>
        <span className="flex items-center gap-2">
          <Select
            options={STATUS_SERVICO.map((o) => ({ value: o.valor, label: o.label }))}
            value={s.status}
            onChange={(e) => void agir(() => gestaoClientes.atualizarServico(s.id, { status: e.target.value as GcServico['status'] }), 'Falha ao salvar: ')}
            className="w-32"
          />
          <button
            type="button"
            onClick={() => void agir(() => gestaoClientes.excluirServico(s.id), 'Falha ao excluir: ')}
            className="text-foreground/25 transition-opacity hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
            aria-label="Excluir serviço"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      <Textarea
        rows={2}
        value={contempla}
        onChange={(e) => setContempla(e.target.value)}
        onBlur={() => {
          if (contempla !== (s.descricao_plano ?? '')) {
            void agir(() => gestaoClientes.atualizarServico(s.id, { descricao_plano: contempla }), 'Falha ao salvar: ')
          }
        }}
        placeholder="O que esse serviço contempla…"
        className="mt-2"
      />
    </div>
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
  onEditar,
}: {
  detalhe: GcClienteDetalhe
  onMudou: () => Promise<void> | void
  /** Abre o cadastro do cliente (botão "Completar cadastro"). */
  onEditar?: () => void
  /** Chamado ao clicar num sinal do semáforo — a página sabe trocar de aba e abrir janelas. */
  onIr?: (d: Destino) => void
  /** Leva pra aba de notas — o quadro de avisos daqui é só a prévia do que está fixado lá. */
  onVerNotas?: () => void
}) {
  const { cliente, servicos } = detalhe
  const [adicionando, setAdicionando] = React.useState(false)
  const camposDoCadastro: { rotulo: string; valor: string | null | undefined }[] = [
    { rotulo: 'Contato', valor: cliente.nome_contato },
    { rotulo: 'WhatsApp', valor: cliente.whatsapp_contato },
    { rotulo: 'E-mail', valor: cliente.email_contato },
    { rotulo: 'CNPJ', valor: cliente.cnpj },
    { rotulo: 'Cidade', valor: cliente.cidade },
    { rotulo: 'Segmento', valor: cliente.segmento },
    { rotulo: 'Responsável', valor: cliente.responsavel_nome },
    { rotulo: 'Início', valor: cliente.data_inicio ? dataBr(cliente.data_inicio) : null },
  ]

  // O texto de "informações do cliente" (o que foi combinado ao fechar, particularidades…). Salva pelo botão.
  const [info, setInfo] = React.useState(cliente.observacoes_gerais ?? '')
  const [salvandoInfo, setSalvandoInfo] = React.useState(false)
  React.useEffect(() => setInfo(cliente.observacoes_gerais ?? ''), [cliente.observacoes_gerais, cliente.id])
  const infoSuja = info !== (cliente.observacoes_gerais ?? '')
  useAvisoAoSair(infoSuja)
  const salvarInfo = async () => {
    setSalvandoInfo(true)
    try {
      await gestaoClientes.atualizar(cliente.id, { observacoes_gerais: info })
      toast.success('Informações salvas')
      await onMudou()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvandoInfo(false)
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">Cadastro</h2>
            {camposDoCadastro.some((c) => !c.valor) && onEditar && (
              <Button variant="secondary" size="sm" onClick={onEditar}>
                Completar cadastro
              </Button>
            )}
          </div>
          {/* Só o que está preenchido: um monte de "—" não informa nada, e o botão ao lado diz o que falta. */}
          {camposDoCadastro.some((c) => c.valor) ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {camposDoCadastro
                .filter((c) => c.valor)
                .map((c) => (
                  <Campo key={c.rotulo} rotulo={c.rotulo} valor={c.valor} />
                ))}
            </dl>
          ) : (
            <p className="text-sm text-foreground/45">Nenhum dado de cadastro preenchido ainda.</p>
          )}
        </section>

        <section id="gc-informacoes" className="rounded-xl border border-line p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Informações do cliente</h2>
          <p className="mb-2 text-xs text-foreground/50">Registre aqui o que foi combinado ao fechar, valores, particularidades — o que o time precisa saber.</p>
          <Textarea
            rows={5}
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            placeholder="Ex.: Fechei com ele dia 07/10: plano de tráfego Meta + Google, entrada paga, quer começar com R$ 3.000 de verba…"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            {infoSuja && <span className="text-xs text-warning">alterações não salvas</span>}
            {infoSuja && (
              <Button variant="ghost" size="sm" onClick={() => setInfo(cliente.observacoes_gerais ?? '')}>
                Descartar
              </Button>
            )}
            <Button size="sm" loading={salvandoInfo} disabled={!infoSuja} onClick={() => void salvarInfo()}>
              Salvar
            </Button>
          </div>
        </section>

        <section id="gc-servicos" className="rounded-xl border border-line p-4 transition-shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Serviços contratados</h2>
            {!adicionando && (
              <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdicionando(true)}>
                Adicionar serviço
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {servicos.length === 0 && !adicionando && (
              <p className="py-4 text-center text-sm text-foreground/50">Nenhum serviço registrado.</p>
            )}
            {servicos.map((s) => (
              <LinhaDeServico key={s.id} servico={s} onMudou={onMudou} />
            ))}
            {adicionando && <FormServico clienteId={cliente.id} onPronto={onMudou} onCancelar={() => setAdicionando(false)} />}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <QuadroDeAvisos detalhe={detalhe} onVerNotas={onVerNotas} />

        <ResumoPlanejamento cliente={cliente} onAbrir={() => onIr?.('planejamento')} />

        <RotinaMensal clienteId={cliente.id} itens={detalhe.rotina ?? []} onMudou={onMudou} />

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
