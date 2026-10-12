import * as React from 'react'
import { Link2, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { CampoData } from '@/components/gestaoClientes/CampoData'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import {
  PRIORIDADES, gestaoClientes,
  type GcClienteEntrada, type GcClienteLista, type GcFichaParaVincular, type GcStatusCliente,
} from '@/services/gestaoClientes'

/** Data vinda do banco ('2026-10-05T00:00:00.000Z' ou '2026-10-05') no formato que o campo usa. */
function soData(valor: string | null | undefined): string {
  return valor ? String(valor).slice(0, 10) : ''
}

const STATUS: { valor: GcStatusCliente; label: string }[] = [
  { valor: 'ativo', label: 'Ativo' },
  { valor: 'pausado', label: 'Pausado' },
  { valor: 'encerrado', label: 'Encerrado' },
]

/** Formata o CNPJ (só dígitos → 00.000.000/0000-00); o que não for CNPJ volta como veio. */
function formatarCnpj(v: string): string {
  const d = v.replace(/\D/g, '')
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : v
}

const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '')

/**
 * "Vincular lead": busca quem já preencheu a ficha de cadastro e, ao escolher, preenche empresa, contato,
 * WhatsApp, e-mail, CNPJ e cidade. Segmento, responsável, status, prioridade e início continuam à mão.
 */
function VincularLead({
  vinculada,
  onEscolher,
  onDesvincular,
}: {
  vinculada: GcFichaParaVincular | null
  onEscolher: (f: GcFichaParaVincular) => void
  onDesvincular: () => void
}) {
  const [busca, setBusca] = React.useState('')
  const [lista, setLista] = React.useState<GcFichaParaVincular[] | null>(null)
  const [aberto, setAberto] = React.useState(false)

  React.useEffect(() => {
    if (!aberto) return
    let vivo = true
    const t = setTimeout(() => {
      gestaoClientes
        .fichasParaVincular(busca)
        .then((r) => vivo && setLista(r))
        .catch(() => vivo && setLista([]))
    }, 250)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [busca, aberto])

  if (vinculada) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/30 bg-success/[0.06] px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Link2 className="h-4 w-4 shrink-0 text-success" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground">Vinculado: {vinculada.empresa}</span>
            <span className="block text-xs text-foreground/55">
              Dados puxados da ficha de cadastro{vinculada.enviada_em ? ` de ${dataBr(vinculada.enviada_em)}` : ''}. Confira e complete o resto abaixo.
            </span>
          </span>
        </span>
        <Button variant="ghost" size="sm" leftIcon={<X className="h-3.5 w-3.5" />} onClick={onDesvincular}>
          Desvincular
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/[0.03] p-3">
      <p className="text-sm font-medium text-foreground">Vincular lead</p>
      <p className="mb-2 text-xs text-foreground/55">
        Escolha o lead que fechou: os dados da ficha de cadastro preenchem o formulário sozinhos.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onFocus={() => setAberto(true)}
          placeholder="Buscar por empresa, nome, telefone ou CNPJ…"
          className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-foreground outline-none focus:border-accent"
        />
      </div>
      {aberto && (
        <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface">
          {lista === null ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-foreground/50">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
            </p>
          ) : lista.length === 0 ? (
            <p className="px-3 py-3 text-xs text-foreground/50">Nenhuma ficha de cadastro encontrada.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lista.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onEscolher(f)
                      setAberto(false)
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/[0.06]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{f.empresa || 'Sem nome'}</span>
                      <span className="block truncate text-xs text-foreground/50">
                        {[f.contato, f.whatsapp, f.cnpj ? formatarCnpj(f.cnpj) : '', f.cidade].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-foreground/45">
                      {f.enviada_em ? `ficha ${dataBr(f.enviada_em)}` : ''}
                      {f.vinculado_a && <span className="block text-warning">já vinculado</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Cadastro do cliente de tráfego — mesmo formulário pra criar e pra editar.
 *
 * Só "Empresa" é obrigatório: o cliente é cadastrado no dia do fechamento, quando muita coisa
 * (CNPJ, e-mail, cidade) ainda não chegou. O resto entra depois, pela própria tela de detalhe.
 */
export function ModalCliente({
  aberto,
  cliente,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  /** Null = criando. */
  cliente?: GcClienteLista | null
  onFechar: () => void
  onSalvo: (id: string) => void
}) {
  const { data: perfis } = useTeamProfiles()
  const [salvando, setSalvando] = React.useState(false)
  const [form, setForm] = React.useState<GcClienteEntrada>({})
  const [ficha, setFicha] = React.useState<GcFichaParaVincular | null>(null)

  // Reabrir o modal com outro cliente tem que trocar o conteúdo do formulário — sem isso ele
  // continuaria mostrando quem foi aberto na primeira vez.
  React.useEffect(() => {
    if (!aberto) return
    setForm({
      nome_empresa: cliente?.nome_empresa ?? '',
      nome_contato: cliente?.nome_contato ?? '',
      whatsapp_contato: cliente?.whatsapp_contato ?? '',
      email_contato: cliente?.email_contato ?? '',
      cnpj: cliente?.cnpj ?? '',
      cidade: cliente?.cidade ?? '',
      segmento: cliente?.segmento ?? '',
      responsavel_id: cliente?.responsavel_id ?? '',
      status: cliente?.status ?? 'ativo',
      prioridade: cliente?.prioridade ?? 'media',
      fora_dos_totais: cliente?.fora_dos_totais ?? false,
      data_inicio: soData(cliente?.data_inicio),
      observacoes_gerais: cliente?.observacoes_gerais ?? '',
      ja_em_andamento: false,
    })
    setFicha(null)
  }, [aberto, cliente])

  // Lead escolhido: os dados da ficha de cadastro entram no formulário. O que a ficha não traz fica como estava.
  const vincular = (f: GcFichaParaVincular) => {
    if (f.vinculado_a && !window.confirm(`Essa ficha já está vinculada ao cliente "${f.vinculado_a}". Vincular mesmo assim?`)) return
    setFicha(f)
    setForm((atual) => ({
      ...atual,
      cliente_externo_id: f.id,
      nome_empresa: f.empresa || atual.nome_empresa,
      nome_contato: f.contato || atual.nome_contato,
      whatsapp_contato: f.whatsapp || atual.whatsapp_contato,
      email_contato: f.email || atual.email_contato,
      cnpj: f.cnpj ? formatarCnpj(f.cnpj) : atual.cnpj,
      cidade: f.cidade || atual.cidade,
      observacoes_gerais:
        !atual.observacoes_gerais?.trim() && f.endereco ? `Endereço: ${f.endereco}` : atual.observacoes_gerais,
    }))
  }
  const desvincular = () => {
    setFicha(null)
    setForm((atual) => ({ ...atual, cliente_externo_id: null }))
  }

  const mudar = (campo: keyof GcClienteEntrada) => (valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }))

  const salvar = async () => {
    if (!form.nome_empresa?.trim()) {
      toast.error('Informe o nome da empresa')
      return
    }
    // Cliente sem dono é cliente que ninguém acompanha: é o responsável que aparece na lista de
    // pendências e nos filtros. O servidor também recusa, mas avisar aqui evita a ida e volta.
    if (!form.responsavel_id) {
      toast.error('Escolha o responsável pelo cliente')
      return
    }
    setSalvando(true)
    try {
      const salvo = cliente
        ? await gestaoClientes.atualizar(cliente.id, form)
        : await gestaoClientes.criar(form)
      toast.success(cliente ? 'Cliente atualizado' : 'Cliente cadastrado com a jornada criada')
      onSalvo(salvo.id)
      onFechar()
    } catch (err) {
      toast.error('Falha ao salvar: ' + (err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const opcoesResponsavel = [
    { value: '', label: '— Escolha o responsável —' },
    ...(perfis ?? [])
      .map((p) => ({ value: p.id, label: (p.name && p.name.trim()) || p.email }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      size="xl"
      title={cliente ? 'Editar cliente' : 'Novo cliente'}
      description={
        cliente ? undefined : 'A jornada padrão e o checklist de cada etapa são criados junto.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={salvar} loading={salvando}>
            {cliente ? 'Salvar' : 'Cadastrar'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {!cliente && (
          <div className="sm:col-span-2">
            <VincularLead vinculada={ficha} onEscolher={vincular} onDesvincular={desvincular} />
          </div>
        )}
        <div className="sm:col-span-2">
          <Input
            label="Empresa *"
            value={form.nome_empresa ?? ''}
            onChange={(e) => mudar('nome_empresa')(e.target.value)}
            placeholder="Nome que aparece na lista e no portal do cliente"
          />
        </div>
        <Input
          label="Contato"
          value={form.nome_contato ?? ''}
          onChange={(e) => mudar('nome_contato')(e.target.value)}
          placeholder="Quem decide do lado do cliente"
        />
        <Input
          label="WhatsApp"
          value={form.whatsapp_contato ?? ''}
          onChange={(e) => mudar('whatsapp_contato')(e.target.value)}
          placeholder="(00) 00000-0000"
        />
        <Input
          label="E-mail"
          type="email"
          value={form.email_contato ?? ''}
          onChange={(e) => mudar('email_contato')(e.target.value)}
        />
        <Input
          label="CNPJ"
          value={form.cnpj ?? ''}
          onChange={(e) => mudar('cnpj')(e.target.value)}
        />
        <Input
          label="Cidade"
          value={form.cidade ?? ''}
          onChange={(e) => mudar('cidade')(e.target.value)}
        />
        <Input
          label="Segmento"
          value={form.segmento ?? ''}
          onChange={(e) => mudar('segmento')(e.target.value)}
          placeholder="Odontologia, advocacia, posto…"
        />
        <Select
          label="Responsável *"
          options={opcoesResponsavel}
          value={form.responsavel_id ?? ''}
          onChange={(e) => mudar('responsavel_id')(e.target.value)}
        />
        <Select
          label="Status"
          options={STATUS.map((s) => ({ value: s.valor, label: s.label }))}
          value={form.status ?? 'ativo'}
          onChange={(e) => mudar('status')(e.target.value)}
        />
        <Select
          label="Prioridade de atendimento"
          hint="define a ordem da fila na lista de clientes"
          options={PRIORIDADES.map((p) => ({ value: p.valor, label: p.label }))}
          value={form.prioridade ?? 'media'}
          onChange={(e) => mudar('prioridade')(e.target.value)}
        />
        <CampoData
          label="Início"
          value={form.data_inicio ?? null}
          onChange={(v) => setForm((f) => ({ ...f, data_inicio: v }))}
        />
        {!cliente && (
          <div className="sm:col-span-2">
            <span className="mb-1.5 block text-xs font-medium text-foreground/70">Esse cliente é…</span>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de cliente">
              {[
                {
                  valor: false,
                  titulo: 'Cliente novo',
                  ajuda: 'Começa agora: a jornada nasce do zero, a partir do fechamento.',
                },
                {
                  valor: true,
                  titulo: 'Cliente já em andamento',
                  ajuda: 'Já passou pela implantação antes do módulo: as etapas até o Go-live ficam como concluídas.',
                },
              ].map((o) => {
                const marcado = (form.ja_em_andamento ?? false) === o.valor
                return (
                  <button
                    key={o.titulo}
                    type="button"
                    role="radio"
                    aria-checked={marcado}
                    onClick={() => setForm((f) => ({ ...f, ja_em_andamento: o.valor }))}
                    className={
                      'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ' +
                      (marcado ? 'border-accent/60 bg-accent/[0.06]' : 'border-line hover:border-accent/30')
                    }
                  >
                    <span
                      className={
                        'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ' +
                        (marcado ? 'border-accent' : 'border-line')
                      }
                    >
                      {marcado && <span className="h-2 w-2 rounded-full bg-accent" />}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{o.titulo}</span>
                      <span className="block text-xs text-foreground/55">{o.ajuda}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <Textarea
            label="Observações"
            rows={3}
            value={form.observacoes_gerais ?? ''}
            onChange={(e) => mudar('observacoes_gerais')(e.target.value)}
            placeholder="Combinados, particularidades do cliente, o que o time precisa saber antes de falar com ele."
          />
        </div>
      </div>
    </Modal>
  )
}
