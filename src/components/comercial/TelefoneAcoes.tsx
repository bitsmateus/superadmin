import * as React from 'react'
import { createPortal } from 'react-dom'
import { Copy, Loader2, Phone, PhoneCall } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { copyToClipboard } from '@/lib/clipboard'
import { useOutsideClose } from '@/hooks/useOutsideClose'
import { cn } from '@/lib/utils'

/**
 * Botãozinho de telefone ao lado do número do lead: abre "Copiar número" e "Ligar pela 3C".
 * "Ligar" pede pra 3C discar pelo ramal de quem está logado (o servidor acha o ramal pelo nome e
 * guarda o token da 3C). A pessoa atende no webphone da 3C, que precisa estar aberto e livre.
 */

interface MeuRamal {
  configurado: boolean
  ramal: string | null
}

/** Uma consulta só por sessão do navegador: o ramal não muda enquanto a pessoa usa o painel. */
let ramalPromessa: Promise<MeuRamal> | null = null
function buscarMeuRamal(): Promise<MeuRamal> {
  if (!ramalPromessa) {
    ramalPromessa = api.get<MeuRamal>('/api/ligacoes-3c/meu-ramal').catch(() => {
      ramalPromessa = null
      return { configurado: false, ramal: null }
    })
  }
  return ramalPromessa
}

function digitos(v: string): string {
  return (v ?? '').replace(/\D/g, '')
}

export function TelefoneAcoes({ telefone, className }: { telefone: string; className?: string }) {
  const [aberto, setAberto] = React.useState(false)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)
  const [meu, setMeu] = React.useState<MeuRamal | null>(null)
  const [ligando, setLigando] = React.useState(false)
  const botao = React.useRef<HTMLButtonElement>(null)
  const menu = React.useRef<HTMLDivElement>(null)
  useOutsideClose(menu, aberto, () => setAberto(false))

  const temNumero = digitos(telefone).length >= 8
  if (!temNumero) return null

  const abrir = (e: React.MouseEvent) => {
    e.stopPropagation()
    const r = botao.current?.getBoundingClientRect()
    if (r) {
      const largura = 230
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - largura - 8)) })
    }
    setAberto((a) => !a)
    void buscarMeuRamal().then(setMeu)
  }

  const copiar = async () => {
    const ok = await copyToClipboard(digitos(telefone))
    if (ok) toast.success('Número copiado')
    else toast.error('Não deu pra copiar o número')
    setAberto(false)
  }

  const ligar = async () => {
    setLigando(true)
    try {
      await api.post('/api/ligacoes-3c/ligar', { telefone })
      toast.success('Ligando pela 3C — atenda no seu webphone')
      setAberto(false)
    } catch (e) {
      toast.error((e as Error).message || 'A 3C não conseguiu ligar')
    } finally {
      setLigando(false)
    }
  }

  const podeLigar = !!meu?.configurado && !!meu?.ramal

  return (
    <>
      <button
        ref={botao}
        type="button"
        onClick={abrir}
        title="Copiar ou ligar"
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md text-foreground/35 transition-colors hover:bg-elevate/[0.08] hover:text-accent',
          aberto && 'bg-accent/10 text-accent',
          className,
        )}
      >
        <Phone className="h-3.5 w-3.5" />
      </button>
      {aberto && pos &&
        createPortal(
          <div
            ref={menu}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[100] w-[230px] overflow-hidden rounded-lg border border-line bg-card py-1 shadow-lg"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="truncate px-3 pb-1 pt-1.5 text-[11px] tabular-nums text-foreground/45">{telefone}</p>
            <button
              type="button"
              onClick={copiar}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-elevate/[0.06]"
            >
              <Copy className="h-3.5 w-3.5 text-foreground/50" />
              Copiar número
            </button>
            <button
              type="button"
              onClick={ligar}
              disabled={!podeLigar || ligando}
              title={
                meu === null
                  ? 'Carregando…'
                  : !meu.configurado
                    ? 'Integração com a 3C não configurada'
                    : !meu.ramal
                      ? 'Seu usuário não tem ramal na 3C'
                      : undefined
              }
              className="flex w-full items-center gap-2 px-3 py-2 whitespace-nowrap text-left text-sm text-foreground hover:bg-elevate/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ligando ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" /> : <PhoneCall className="h-3.5 w-3.5 text-accent" />}
              Ligar pela 3C
              {meu?.ramal && <span className="ml-auto text-[11px] text-foreground/40">ramal {meu.ramal}</span>}
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
