import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { numeroDigitado } from '@/lib/gcMetricas'
import {
  TIPOS_SERVICO, gestaoClientes,
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
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Início</label>
          <DatePickerField value={inicio} onChange={setInicio} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Renovação</label>
          <DatePickerField value={renovacao} onChange={setRenovacao} />
        </div>
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
 * Visão geral do cliente: o cadastro, os serviços contratados e as observações.
 *
 * O cadastro é só leitura aqui — editar abre o mesmo modal do "Novo cliente", pra não existirem
 * dois formulários diferentes pros mesmos campos.
 */
export function AbaVisaoGeral({
  detalhe,
  onMudou,
}: {
  detalhe: GcClienteDetalhe
  onMudou: () => Promise<void> | void
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

        <section className="rounded-xl border border-line p-4">
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
                    {s.descricao_plano || 'sem descrição'} · início {dataBr(s.data_inicio)} ·
                    renovação {dataBr(s.data_renovacao)}
                  </span>
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
