import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { engeApi, type EngeUsuario } from '@/api/engeEnvio'

/**
 * Editar um acesso: nome, e-mail e senha. Na própria conta, trocar a senha pede a senha atual;
 * na de outra pessoa, a senha nova simplesmente substitui (redefinição por quem administra).
 */
export function UsuarioModal({
  usuario,
  ehEu,
  onFechar,
  onSalvo,
}: {
  usuario: EngeUsuario | null
  ehEu: boolean
  onFechar: () => void
  onSalvo?: (u: EngeUsuario) => void
}) {
  const qc = useQueryClient()
  const [nome, setNome] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [senha, setSenha] = React.useState('')
  const [confirmar, setConfirmar] = React.useState('')
  const [senhaAtual, setSenhaAtual] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)

  React.useEffect(() => {
    if (!usuario) return
    setNome(usuario.nome ?? '')
    setEmail(usuario.email)
    setSenha('')
    setConfirmar('')
    setSenhaAtual('')
  }, [usuario])

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!usuario) return
    if (senha && senha !== confirmar) return toast.error('A confirmação não bate com a senha nova.')
    setSalvando(true)
    try {
      const salvo = await engeApi.editarUsuario(usuario.id, {
        nome,
        email,
        ...(senha ? { senha, ...(ehEu ? { senhaAtual } : {}) } : {}),
      })
      toast.success(senha ? 'Dados e senha atualizados' : 'Dados atualizados')
      await qc.invalidateQueries({ queryKey: ['engeenvio', 'usuarios'] })
      onSalvo?.(salvo)
      onFechar()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      open={Boolean(usuario)}
      onClose={onFechar}
      size="sm"
      title={ehEu ? 'Minha conta' : 'Editar acesso'}
      footer={
        <>
          <Button variant="secondary" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="ee-form-usuario" loading={salvando}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="ee-form-usuario" onSubmit={salvar} className="space-y-3 text-foreground">
        <Input id="ee-us-nome" label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
        <Input id="ee-us-email" type="email" label="E-mail (usado para entrar)" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-xs font-medium text-foreground/70">
            {ehEu ? 'Mudar minha senha' : 'Redefinir a senha'}{' '}
            <span className="font-normal text-foreground/40">(deixe em branco para manter a atual)</span>
          </p>
          {ehEu && senha && (
            <Input
              id="ee-us-atual"
              type="password"
              label="Senha atual"
              value={senhaAtual}
              onChange={(e) => setSenhaAtual(e.target.value)}
              autoComplete="current-password"
              required
            />
          )}
          <Input
            id="ee-us-senha"
            type="password"
            label="Senha nova"
            hint="Pelo menos 6 caracteres"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
          />
          {senha && (
            <Input
              id="ee-us-confirmar"
              type="password"
              label="Confirme a senha nova"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              autoComplete="new-password"
              error={confirmar && confirmar !== senha ? 'As senhas não são iguais' : undefined}
              required
            />
          )}
        </div>
      </form>
    </Modal>
  )
}
