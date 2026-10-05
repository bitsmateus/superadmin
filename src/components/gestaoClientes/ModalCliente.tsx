import * as React from 'react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { DatePickerField } from '@/components/comercial/DatePickerField'
import { useTeamProfiles } from '@/hooks/useTeamProfiles'
import {
  gestaoClientes, type GcClienteEntrada, type GcClienteLista, type GcStatusCliente,
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
      data_inicio: soData(cliente?.data_inicio),
      observacoes_gerais: cliente?.observacoes_gerais ?? '',
    })
  }, [aberto, cliente])

  const mudar = (campo: keyof GcClienteEntrada) => (valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }))

  const salvar = async () => {
    if (!form.nome_empresa?.trim()) {
      toast.error('Informe o nome da empresa')
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
    { value: '', label: '— Sem responsável —' },
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
          label="Responsável"
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
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground/70">Início</label>
          <DatePickerField
            value={form.data_inicio ?? ''}
            onChange={(v) => setForm((f) => ({ ...f, data_inicio: v }))}
          />
        </div>
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
