import * as React from 'react'
import { toast } from 'sonner'
import { LogOut, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Tabs } from '@/components/ui/Tabs'
import { EngeSemSessao, engeApi, engeToken, type EngeUsuario } from '@/api/engeEnvio'
import { useEngeTudo } from '@/components/engeenvio/shared'
import { Painel } from '@/components/engeenvio/Painel'
import { Empreendimentos } from '@/components/engeenvio/Empreendimentos'
import { Avisos } from '@/components/engeenvio/Avisos'
import { Configuracoes } from '@/components/engeenvio/Configuracoes'
import { ModelosReguas } from '@/components/engeenvio/ModelosReguas'
import { UsuarioModal } from '@/components/engeenvio/UsuarioModal'

/**
 * Enge Envio — /engeenvio.
 *
 * A Enge Services administra as garantias de empreendimentos novos (itens com 3 meses, 1, 2, 3 e
 * 5 anos, mais o CVCB anual) e precisa avisar o síndico por e-mail antes de cada vencimento — o
 * e-mail é o aviso que vale juridicamente. Aqui ela cadastra os empreendimentos, escolhe o dia de
 * cada aviso e o sistema manda sozinho, guardando o comprovante de cada envio.
 *
 * Login próprio (e-mail + senha só desta ferramenta), como o açougue do Mercado Nunes.
 */

type Aba = 'painel' | 'empreendimentos' | 'avisos' | 'modelos' | 'config'

export function EngeEnvioPage() {
  const [usuario, setUsuario] = React.useState<EngeUsuario | null>(null)
  const [carregandoSessao, setCarregandoSessao] = React.useState(true)

  React.useEffect(() => {
    document.title = 'Enge Envio'
    if (!engeToken.get()) {
      setCarregandoSessao(false)
      return
    }
    engeApi
      .me()
      .then(setUsuario)
      .catch(() => engeToken.clear())
      .finally(() => setCarregandoSessao(false))
  }, [])

  if (carregandoSessao) {
    return (
      <Moldura>
        <p className="py-10 text-center text-sm text-foreground/50">Carregando…</p>
      </Moldura>
    )
  }
  if (!usuario) return <TelaLogin onEntrar={setUsuario} />
  return (
    <Sistema
      usuario={usuario}
      onUsuarioAtualizado={setUsuario}
      onSair={() => {
        engeToken.clear()
        setUsuario(null)
      }}
    />
  )
}

function Moldura({ children, direita }: { children: React.ReactNode; direita?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-foreground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-foreground">Enge Envio</h1>
            <p className="text-xs text-foreground/50">Enge Services · avisos de garantia dos empreendimentos</p>
          </div>
          {direita}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</main>
    </div>
  )
}

function TelaLogin({ onEntrar }: { onEntrar: (u: EngeUsuario) => void }) {
  const [temUsuario, setTemUsuario] = React.useState<boolean | null>(null)
  const [email, setEmail] = React.useState('')
  const [nome, setNome] = React.useState('')
  const [senha, setSenha] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    engeApi
      .status()
      .then((s) => setTemUsuario(s.temUsuario))
      .catch(() => setTemUsuario(true))
  }, [])

  const primeiroAcesso = temUsuario === false

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    try {
      const r = primeiroAcesso
        ? await engeApi.primeiroAcesso(email.trim(), nome.trim(), senha)
        : await engeApi.login(email.trim(), senha)
      engeToken.set(r.token)
      onEntrar(r.usuario)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Moldura>
      <form onSubmit={enviar} className="mx-auto mt-8 max-w-sm space-y-3 rounded-xl border border-line bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">{primeiroAcesso ? 'Criar o primeiro acesso' : 'Entrar'}</h2>
        <p className="text-xs text-foreground/50">
          {primeiroAcesso
            ? 'Ninguém tem acesso ainda. Crie o primeiro e-mail e senha desta ferramenta.'
            : 'Use o e-mail e a senha do Enge Envio.'}
        </p>
        {primeiroAcesso && <Input id="ee-l-nome" label="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />}
        <Input id="ee-l-email" type="email" label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <Input
          id="ee-l-senha"
          type="password"
          label="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          autoComplete={primeiroAcesso ? 'new-password' : 'current-password'}
          required
        />
        <Button type="submit" className="w-full" loading={enviando}>
          {primeiroAcesso ? 'Criar acesso' : 'Entrar'}
        </Button>
      </form>
    </Moldura>
  )
}

const ABAS: { value: Aba; label: string }[] = [
  { value: 'painel', label: 'Painel' },
  { value: 'empreendimentos', label: 'Empreendimentos' },
  { value: 'avisos', label: 'Avisos enviados' },
  { value: 'modelos', label: 'Modelos e réguas' },
  { value: 'config', label: 'Configurações' },
]

function Sistema({
  usuario,
  onSair,
  onUsuarioAtualizado,
}: {
  usuario: EngeUsuario
  onSair: () => void
  onUsuarioAtualizado: (u: EngeUsuario) => void
}) {
  const [minhaConta, setMinhaConta] = React.useState(false)
  const [aba, setAba] = React.useState<Aba>('painel')
  const [empAberto, setEmpAberto] = React.useState<string | null>(null)
  const { data, isLoading, error } = useEngeTudo()

  React.useEffect(() => {
    if (error instanceof EngeSemSessao) onSair()
  }, [error, onSair])

  const abrirEmpreendimento = (id: string) => {
    setEmpAberto(id)
    setAba('empreendimentos')
  }

  return (
    <Moldura
      direita={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMinhaConta(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground/60 hover:bg-elevate/[0.05] hover:text-foreground"
            title="Minha conta: nome, e-mail e senha"
          >
            <UserRound className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{usuario.nome || usuario.email}</span>
            <span className="sm:hidden">Minha conta</span>
          </button>
          <Button variant="ghost" size="sm" leftIcon={<LogOut className="h-3.5 w-3.5" />} onClick={onSair}>
            Sair
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Tabs
          value={aba}
          onChange={(v) => {
            setAba(v as Aba)
            if (v === 'empreendimentos') setEmpAberto(null)
          }}
          items={ABAS}
        />
        {isLoading && <p className="py-10 text-center text-sm text-foreground/50">Carregando…</p>}
        {error && !(error instanceof EngeSemSessao) && <p className="text-sm text-danger">{(error as Error).message}</p>}
        {data && aba === 'painel' && <Painel dados={data} onAbrirEmpreendimento={abrirEmpreendimento} />}
        {data && aba === 'empreendimentos' && <Empreendimentos dados={data} selecionado={empAberto} onSelecionar={setEmpAberto} />}
        {data && aba === 'avisos' && <Avisos dados={data} onAbrirEmpreendimento={abrirEmpreendimento} />}
        {aba === 'modelos' && <ModelosReguas />}
        {aba === 'config' && <Configuracoes usuario={usuario} onUsuarioAtualizado={onUsuarioAtualizado} />}
        <UsuarioModal usuario={minhaConta ? usuario : null} ehEu onFechar={() => setMinhaConta(false)} onSalvo={onUsuarioAtualizado} />
      </div>
    </Moldura>
  )
}
