import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { engeApi, type EngeSmtp, type EngeUsuario } from '@/api/engeEnvio'
import { Cartao } from './shared'

const VARIAVEIS = ['{sindico}', '{empreendimento}', '{item}', '{prazo}', '{vencimento}', '{dias}', '{construtora}']

export function Configuracoes({ usuario }: { usuario: EngeUsuario }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <EmailEnvio />
      <ModeloEmail />
      <Acessos usuario={usuario} />
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

function ModeloEmail() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['engeenvio', 'config'], queryFn: engeApi.config })
  const [assunto, setAssunto] = React.useState('')
  const [corpo, setCorpo] = React.useState('')
  const [previa, setPrevia] = React.useState<{ assunto: string; html: string } | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (data) {
      setAssunto(data.assunto)
      setCorpo(data.corpo)
    }
  }, [data])

  // Pré-visualização com um pequeno atraso pra não chamar a API a cada tecla.
  React.useEffect(() => {
    if (!assunto && !corpo) return
    const t = setTimeout(() => {
      engeApi.previa({ assunto, corpo }).then(setPrevia).catch(() => undefined)
    }, 400)
    return () => clearTimeout(t)
  }, [assunto, corpo])

  const salvar = async () => {
    setSalvando(true)
    try {
      await engeApi.salvarConfig({ assunto, corpo })
      toast.success('Modelo salvo')
      await qc.invalidateQueries({ queryKey: ['engeenvio', 'config'] })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Cartao titulo="Modelo do e-mail" className="xl:row-span-2">
      <div className="space-y-3 p-4">
        <Input id="ee-m-ass" label="Assunto" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
        <Textarea id="ee-m-corpo" label="Mensagem" value={corpo} onChange={(e) => setCorpo(e.target.value)} className="min-h-[240px]" />
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground/70">Variáveis (trocadas pelos dados de cada garantia)</p>
          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS.map((v) => (
              <code key={v} className="rounded border border-line bg-elevate/[0.04] px-1.5 py-0.5 text-xs text-foreground/80">
                {v}
              </code>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-foreground/40">O botão “Estou ciente deste aviso” entra sozinho no fim do e-mail.</p>
        </div>
        <div className="flex justify-end">
          <Button loading={salvando} onClick={salvar}>
            Salvar modelo
          </Button>
        </div>
        {previa && (
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-medium text-foreground/70">Pré-visualização (dados de exemplo)</p>
            <p className="text-sm font-medium text-foreground">{previa.assunto}</p>
            <div className="rounded-lg border border-line bg-white p-4" dangerouslySetInnerHTML={{ __html: previa.html }} />
          </div>
        )}
      </div>
    </Cartao>
  )
}

function Acessos({ usuario }: { usuario: EngeUsuario }) {
  const qc = useQueryClient()
  const { data: usuarios = [] } = useQuery({ queryKey: ['engeenvio', 'usuarios'], queryFn: engeApi.usuarios })
  const [nome, setNome] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [senha, setSenha] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

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
              <span className="block text-sm text-foreground">{u.nome || u.email}</span>
              {u.nome && <span className="block break-words text-xs text-foreground/50">{u.email}</span>}
            </span>
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
    </Cartao>
  )
}
