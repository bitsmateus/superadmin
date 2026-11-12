import * as React from 'react'
import { Check, ChevronDown, Copy, History, MessageSquareText, PencilLine, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Painel } from '@/components/trafego/format'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { gcTrafego, type GcMensagemCliente } from '@/services/gcTrafego'

/** Atalhos de pedido (o gestor pode escrever qualquer outra coisa). Mesmos de server/src/lib/gcMensagemTrafego.ts. */
const ATALHOS = ['Resultado da semana', 'Resultado do mês', 'O que mudamos nas campanhas', 'Pedir recarga de saldo']

/**
 * "Mensagem para o cliente" da aba Tráfego: o gestor escreve o que quer dizer (ou clica num atalho) e
 * a IA monta o recado de WhatsApp com os números reais do cliente (Meta, Google Ads, saldo e as
 * edições registradas). A última fica em destaque; as anteriores, no histórico minimizado.
 */
export function MensagemClienteTrafego({ clienteId }: { clienteId: string }) {
  const [mensagens, setMensagens] = React.useState<GcMensagemCliente[] | null>(null)
  const [pedido, setPedido] = React.useState('')
  const [gerando, setGerando] = React.useState(false)
  const [historicoAberto, setHistoricoAberto] = React.useState(false)

  React.useEffect(() => {
    gcTrafego.mensagens(clienteId).then(setMensagens).catch(() => setMensagens([]))
  }, [clienteId])

  const gerar = async (texto: string) => {
    const t = texto.trim()
    if (!t) return toast.error('Escreva o que a mensagem tem que dizer.')
    setGerando(true)
    try {
      const nova = await gcTrafego.gerarMensagem(clienteId, t)
      setMensagens((l) => [nova, ...(l ?? [])])
      setPedido('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setGerando(false)
    }
  }
  const trocar = (m: GcMensagemCliente) => setMensagens((l) => (l ?? []).map((x) => (x.id === m.id ? m : x)))
  const excluir = async (m: GcMensagemCliente) => {
    if (!window.confirm('Excluir esta mensagem?')) return
    try {
      await gcTrafego.excluirMensagem(m.id)
      setMensagens((l) => (l ?? []).filter((x) => x.id !== m.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const [ultima, ...anteriores] = mensagens ?? []
  return (
    <Painel title={<span className="flex items-center gap-1.5"><MessageSquareText className="h-4 w-4 text-foreground/50" /> Mensagem para o cliente</span>}>
      <div className="space-y-2">
        <Textarea
          rows={2}
          placeholder="O que a mensagem tem que dizer? Ex.: resultado da semana, que subimos o orçamento da campanha de leads, lembrar de pagar o boleto…"
          value={pedido}
          disabled={gerando}
          onChange={(e) => setPedido(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void gerar(pedido) }}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {ATALHOS.map((a) => (
            <button
              key={a}
              type="button"
              disabled={gerando}
              onClick={() => void gerar(a)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-foreground/70 transition-colors hover:border-accent hover:text-foreground disabled:opacity-50"
            >
              {a}
            </button>
          ))}
          <Button size="sm" className="ml-auto" loading={gerando} disabled={!pedido.trim()} leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void gerar(pedido)}>
            Gerar mensagem
          </Button>
        </div>
        <p className="text-[11px] text-foreground/40">A IA usa os números do Meta e do Google Ads, o saldo e as edições registradas. Não inventa número; você revisa e copia.</p>
      </div>

      {ultima && (
        <div className="mt-3">
          <CartaoMensagem mensagem={ultima} onMudou={trocar} onExcluir={() => void excluir(ultima)} />
        </div>
      )}

      {anteriores.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setHistoricoAberto((v) => !v)}
            className="flex w-full items-center gap-1.5 text-xs font-medium text-foreground/60 hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" /> Mensagens anteriores ({anteriores.length})
            <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', historicoAberto && 'rotate-180')} />
          </button>
          {historicoAberto && (
            <ul className="mt-2 space-y-3">
              {anteriores.map((m) => (
                <li key={m.id}>
                  <CartaoMensagem mensagem={m} onMudou={trocar} onExcluir={() => void excluir(m)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Painel>
  )
}

function CartaoMensagem({ mensagem: m, onMudou, onExcluir }: { mensagem: GcMensagemCliente; onMudou: (m: GcMensagemCliente) => void; onExcluir: () => void }) {
  const [editando, setEditando] = React.useState(false)
  const [texto, setTexto] = React.useState(m.mensagem)
  const [salvando, setSalvando] = React.useState(false)
  const [copiado, setCopiado] = React.useState(false)
  React.useEffect(() => setTexto(m.mensagem), [m.mensagem])

  const salvar = async () => {
    setSalvando(true)
    try {
      onMudou(await gcTrafego.salvarMensagem(m.id, texto))
      setEditando(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(m.mensagem)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      toast.error('Não consegui copiar. Selecione o texto e copie manualmente.')
    }
  }

  return (
    <div className="rounded-lg border border-line bg-elevate/[0.03] p-3">
      <p className="mb-1.5 text-[11px] text-foreground/45">
        Pedido: <span className="text-foreground/70">{m.pedido}</span> · {formatDateTimeShort(m.created_at)}{m.autor_nome ? ` · ${m.autor_nome}` : ''}
      </p>
      {editando ? (
        <Textarea rows={7} value={texto} disabled={salvando} onChange={(e) => setTexto(e.target.value)} />
      ) : (
        <p className="whitespace-pre-wrap rounded-md bg-card px-3 py-2 text-sm text-foreground">{m.mensagem}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {editando ? (
          <>
            <Button size="sm" loading={salvando} onClick={() => void salvar()}>Salvar</Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditando(false); setTexto(m.mensagem) }}>Cancelar</Button>
          </>
        ) : (
          <>
            <Button size="sm" leftIcon={copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void copiar()}>
              {copiado ? 'Copiada' : 'Copiar'}
            </Button>
            <Button variant="ghost" size="sm" leftIcon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => setEditando(true)}>Editar</Button>
            <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={onExcluir}>Excluir</Button>
          </>
        )}
      </div>
    </div>
  )
}
