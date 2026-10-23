import * as React from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { engeApi } from '@/api/engeEnvio'
import { dataBr, dataHoraBr } from '@/lib/engeEnvio'

/**
 * /engeenvio/ciente/:token — o síndico chega aqui pelo botão do e-mail de aviso. Abrir a página
 * não marca nada (leitores de e-mail costumam abrir links sozinhos); só o botão registra o ciente,
 * com nome, data, hora e IP.
 */
export function EngeCientePage() {
  const { token = '' } = useParams()
  const [aviso, setAviso] = React.useState<Awaited<ReturnType<typeof engeApi.ciente>> | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [nome, setNome] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)

  React.useEffect(() => {
    document.title = 'Confirmação de aviso'
    engeApi
      .ciente(token)
      .then(setAviso)
      .catch((e: Error) => setErro(e.message))
  }, [token])

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    try {
      const r = await engeApi.confirmarCiente(token, nome)
      setAviso((a) => (a ? { ...a, ...r } : a))
    } catch (err) {
      setErro((err as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-bg px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-line bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Enge Services · aviso de garantia</p>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        {!aviso && !erro && <p className="text-sm text-foreground/50">Carregando…</p>}
        {aviso && (
          <>
            <div>
              <h1 className="text-base font-semibold text-foreground">{aviso.item}</h1>
              <p className="text-sm text-foreground/60">
                {aviso.empreendimento} · vence em {dataBr(aviso.vencimento)}
              </p>
              <p className="mt-1 text-xs text-foreground/40">Aviso enviado em {dataHoraBr(aviso.enviadoEm)}</p>
            </div>
            {aviso.cienteEm ? (
              <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Ciente confirmado por {aviso.cienteNome} em {dataHoraBr(aviso.cienteEm)}. Obrigado!
                </span>
              </div>
            ) : (
              <form onSubmit={confirmar} className="space-y-3">
                <Input id="ee-c-nome" label="Seu nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required />
                <Button type="submit" className="w-full" loading={enviando}>
                  Estou ciente deste aviso
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
