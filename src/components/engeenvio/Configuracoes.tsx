import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { engeApi, type EngeNx, type EngeSmtp, type EngeUsuario } from '@/api/engeEnvio'
import { Cartao } from './shared'
import { UsuarioModal } from './UsuarioModal'

export function Configuracoes({ usuario, onUsuarioAtualizado }: { usuario: EngeUsuario; onUsuarioAtualizado: (u: EngeUsuario) => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <EmailEnvio />
      <WhatsAppNx />
      <Acessos usuario={usuario} onUsuarioAtualizado={onUsuarioAtualizado} />
    </div>
  )
}

function EmailEnvio() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['engeenvio', 'config'], queryFn: engeApi.config })
  const [smtp, setSmtp] = React.useState<EngeSmtp>({})
  const [copia, setCopia] = React.useState('')
  const [teste, setTeste] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [testando, setTestando] = React.useState(false)

  React.useEffect(() => {
    if (data) {
      setSmtp({ port: 587, ...data.smtp, password: '' })
      setCopia(data.copiaOculta)
    }
  }, [data])

  const set = (k: keyof EngeSmtp) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSmtp((s) => ({ ...s, [k]: k === 'port' ? Number(e.target.value) : e.target.value }))

  const salvar = async () => {
    setSalvando(true)
    try {
      const r = await engeApi.salvarConfig({ smtp, copiaOculta: copia })
      toast.success(r.smtpOk ? 'E-mail de envio salvo' : 'Salvo, mas ainda faltam dados para enviar')
      await qc.invalidateQueries({ queryKey: ['engeenvio', 'config'] })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const testar = async () => {
    setTestando(true)
    try {
      await engeApi.testarEnvio(teste)
      toast.success(`E-mail de teste enviado para ${teste}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTestando(false)
    }
  }

  return (
    <Cartao titulo="E-mail de envio">
      <div className="space-y-3 p-4">
        <p className="text-xs text-foreground/50">
          Os avisos saem desta conta, no nome da Enge. Use os dados de SMTP do provedor de e-mail (Hostinger, Google Workspace, Outlook…).
        </p>
        {data && !data.smtpOk && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Enquanto isto não estiver preenchido, nenhum aviso sai — eles ficam com erro e dá para reenviar depois.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="ee-s-nome" label="Nome do remetente" placeholder="Enge Services" value={smtp.fromName ?? ''} onChange={set('fromName')} />
          <Input id="ee-s-from" label="E-mail do remetente" placeholder="garantias@..." value={smtp.fromEmail ?? ''} onChange={set('fromEmail')} />
          <Input id="ee-s-host" label="Servidor SMTP" placeholder="smtp.hostinger.com" value={smtp.host ?? ''} onChange={set('host')} />
          <Input id="ee-s-port" type="number" label="Porta" value={smtp.port ?? 587} onChange={set('port')} />
          <Input id="ee-s-user" label="Usuário" value={smtp.user ?? ''} onChange={set('user')} autoComplete="off" />
          <Input
            id="ee-s-pass"
            type="password"
            label="Senha"
            placeholder={data?.smtp.temSenha ? '•••••• (salva — deixe vazio para manter)' : ''}
            value={smtp.password ?? ''}
            onChange={set('password')}
            autoComplete="new-password"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground/80">
          <input id="ee-s-ssl" type="checkbox" checked={Boolean(smtp.secure)} onChange={(e) => setSmtp((s) => ({ ...s, secure: e.target.checked }))} />
          Conexão segura SSL (normalmente porta 465)
        </label>
        <Input
          id="ee-s-cc"
          label="Cópia oculta para a equipe"
          hint="Recebe uma cópia de todo aviso enviado. Separe por vírgula."
          value={copia}
          onChange={(e) => setCopia(e.target.value)}
        />
        <div className="flex justify-end">
          <Button loading={salvando} onClick={salvar}>
            Salvar
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <Input
            id="ee-s-teste"
            type="email"
            label="Mandar um e-mail de teste para"
            value={teste}
            onChange={(e) => setTeste(e.target.value)}
            containerClassName="flex-1 min-w-[200px]"
          />
          <Button variant="secondary" loading={testando} disabled={!teste} onClick={testar}>
            Enviar teste
          </Button>
        </div>
      </div>
    </Cartao>
  )
}

/**
 * Conexão da Enge na NX (Z-PRO) — o WhatsApp sai pelo número dela. Número não oficial aceita
 * mensagem livre; número oficial (WABA) fora da janela de 24h só aceita template aprovado na Meta.
 */
function WhatsAppNx() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['engeenvio', 'config'], queryFn: engeApi.config })
  const [nx, setNx] = React.useState<EngeNx>({})
  const [numeroTeste, setNumeroTeste] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [testando, setTestando] = React.useState(false)

  React.useEffect(() => {
    if (data) {
      setNx({ ...data.nx, token: '' })
    }
  }, [data])

  const set = (k: keyof EngeNx) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setNx((n) => ({ ...n, [k]: e.target.value }))

  const salvar = async () => {
    setSalvando(true)
    try {
      const r = await engeApi.salvarConfig({
        nx: { apiId: nx.apiId, token: nx.token, baseUrl: nx.baseUrl, modo: nx.modo },
      })
      toast.success(r.nxOk ? 'WhatsApp salvo' : 'Salvo, mas ainda faltam dados para enviar')
      await qc.invalidateQueries({ queryKey: ['engeenvio', 'config'] })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const testar = async () => {
    setTestando(true)
    try {
      await engeApi.testarWhatsApp(numeroTeste)
      toast.success('Mensagem de teste enviada')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setTestando(false)
    }
  }

  return (
    <Cartao titulo="WhatsApp pela NX">
      <div className="space-y-3 p-4">
        <p className="text-xs text-foreground/50">
          Os avisos marcados com WhatsApp saem pela conexão da Enge na NX Systems, para o número do responsável cadastrado no
          empreendimento. O API ID e o token ficam na NX, em Configurações › API.
        </p>
        {data && !data.nxOk && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            Sem a conexão preenchida, os avisos marcados com WhatsApp ficam com erro nesse canal (o e-mail sai normalmente).
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input id="ee-nx-api" label="API ID" value={nx.apiId ?? ''} onChange={set('apiId')} autoComplete="off" />
          <Input
            id="ee-nx-token"
            type="password"
            label="Token"
            placeholder={data?.nx.temToken ? '•••••• (salvo — deixe vazio para manter)' : ''}
            value={nx.token ?? ''}
            onChange={set('token')}
            autoComplete="new-password"
          />
          <Input
            id="ee-nx-url"
            label="Endereço da API"
            value={nx.baseUrl ?? ''}
            onChange={set('baseUrl')}
            containerClassName="sm:col-span-2"
          />
          <div className="sm:col-span-2">
            <Select
              id="ee-nx-modo"
              label="Tipo de número"
              value={nx.modo ?? 'texto'}
              onChange={set('modo')}
              options={[
                { value: 'texto', label: 'Mensagem livre (número comum / WhatsApp Web)' },
                { value: 'template', label: 'Template aprovado (API oficial da Meta)' },
              ]}
            />
          </div>
        </div>

        <p className="rounded-lg border border-line bg-elevate/[0.03] px-3 py-2 text-xs text-foreground/60">
          {nx.modo === 'template'
            ? 'Número oficial: em cada modelo (aba Modelos e réguas) você informa o nome do template aprovado na Meta e as variáveis dele.'
            : 'O texto de cada mensagem fica nos modelos (aba Modelos e réguas).'}
        </p>

        <div className="flex justify-end">
          <Button loading={salvando} onClick={salvar}>
            Salvar
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
          <Input
            id="ee-nx-teste"
            label="Mandar uma mensagem de teste para"
            placeholder="(43) 99999-9999"
            value={numeroTeste}
            onChange={(e) => setNumeroTeste(e.target.value)}
            containerClassName="flex-1 min-w-[200px]"
          />
          <Button variant="secondary" loading={testando} disabled={!numeroTeste} onClick={testar}>
            Enviar teste
          </Button>
        </div>
      </div>
    </Cartao>
  )
}

function Acessos({ usuario, onUsuarioAtualizado }: { usuario: EngeUsuario; onUsuarioAtualizado: (u: EngeUsuario) => void }) {
  const qc = useQueryClient()
  const { data: usuarios = [] } = useQuery({ queryKey: ['engeenvio', 'usuarios'], queryFn: engeApi.usuarios })
  const [nome, setNome] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [senha, setSenha] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [editando, setEditando] = React.useState<EngeUsuario | null>(null)

  const recarregar = () => qc.invalidateQueries({ queryKey: ['engeenvio', 'usuarios'] })

  const criar = async (e: React.FormEvent) => {
    e.preventDefault()
    setSalvando(true)
    try {
      await engeApi.criarUsuario(email, nome, senha)
      toast.success('Acesso criado')
      setNome('')
      setEmail('')
      setSenha('')
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const remover = async (id: string) => {
    try {
      await engeApi.removerUsuario(id)
      toast.success('Acesso removido')
      await recarregar()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Cartao titulo="Quem acessa">
      <ul className="divide-y divide-line">
        {usuarios.map((u) => (
          <li key={u.id} className="flex items-center gap-2 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-foreground">
                {u.nome || u.email}
                {u.id === usuario.id && <span className="ml-1.5 text-xs text-foreground/40">(você)</span>}
              </span>
              {u.nome && <span className="block break-words text-xs text-foreground/50">{u.email}</span>}
            </span>
            <button
              type="button"
              onClick={() => setEditando(u)}
              className="rounded p-1 text-foreground/40 hover:text-accent"
              aria-label={`Editar acesso de ${u.email}`}
              title="Editar nome, e-mail ou senha"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {u.id !== usuario.id && (
              <button
                type="button"
                onClick={() => remover(u.id)}
                className="rounded p-1 text-foreground/40 hover:text-danger"
                aria-label={`Remover acesso de ${u.email}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={criar} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3">
        <Input id="ee-u-nome" label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Input id="ee-u-email" type="email" label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          id="ee-u-senha"
          type="password"
          label="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete="new-password"
          required
        />
        <div className="flex justify-end sm:col-span-3">
          <Button type="submit" variant="secondary" loading={salvando}>
            Criar acesso
          </Button>
        </div>
      </form>
      <UsuarioModal
        usuario={editando}
        ehEu={editando?.id === usuario.id}
        onFechar={() => setEditando(null)}
        onSalvo={(u) => u.id === usuario.id && onUsuarioAtualizado(u)}
      />
    </Cartao>
  )
}
