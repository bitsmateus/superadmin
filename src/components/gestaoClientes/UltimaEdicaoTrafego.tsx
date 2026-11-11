import * as React from 'react'
import { Check, ChevronDown, Copy, History, MessageSquareText, PencilLine, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Input'
import { Painel } from '@/components/trafego/format'
import { useAuth } from '@/hooks/useAuth'
import { cn, formatDateTimeShort } from '@/lib/utils'
import { gcTrafego, type GcEdicaoTrafego } from '@/services/gcTrafego'

/**
 * "Última edição" da aba Tráfego: depois de mexer nas campanhas, o gestor registra o que mudou.
 * A mais recente fica em destaque; as anteriores ficam no histórico, fechado por padrão.
 */
export function UltimaEdicaoTrafego({ clienteId }: { clienteId: string }) {
  const { profile } = useAuth()
  const [edicoes, setEdicoes] = React.useState<GcEdicaoTrafego[] | null>(null)
  const [escrevendo, setEscrevendo] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  const [salvando, setSalvando] = React.useState(false)
  const [historicoAberto, setHistoricoAberto] = React.useState(false)

  const carregar = React.useCallback(() => {
    gcTrafego.edicoes(clienteId).then(setEdicoes).catch((err) => {
      setEdicoes([])
      toast.error((err as Error).message)
    })
  }, [clienteId])
  React.useEffect(carregar, [carregar])

  const salvar = async () => {
    const t = texto.trim()
    if (!t) return toast.error('Escreva o que foi alterado no tráfego.')
    setSalvando(true)
    try {
      const nova = await gcTrafego.registrarEdicao(clienteId, t)
      setEdicoes((l) => [nova, ...(l ?? [])])
      setTexto('')
      setEscrevendo(false)
      if (nova.erroIa) toast.warning(`Edição registrada, mas a mensagem para o cliente não saiu: ${nova.erroIa}`)
      else toast.success('Edição registrada e mensagem para o cliente pronta')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  const excluir = async (e: GcEdicaoTrafego) => {
    if (!window.confirm('Excluir este registro de edição?')) return
    try {
      await gcTrafego.excluirEdicao(e.id)
      setEdicoes((l) => (l ?? []).filter((x) => x.id !== e.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const trocar = (e: GcEdicaoTrafego) => setEdicoes((l) => (l ?? []).map((x) => (x.id === e.id ? { ...x, ...e } : x)))

  const podeExcluir = (e: GcEdicaoTrafego) => !!profile && (e.autor_id === profile.id || profile.role === 'admin')
  const [ultima, ...anteriores] = edicoes ?? []

  const quem = (e: GcEdicaoTrafego) => (
    <span className="text-[11px] text-foreground/45">
      {formatDateTimeShort(e.created_at)}{e.autor_nome ? ` · ${e.autor_nome}` : ''}
    </span>
  )

  return (
    <Painel
      title={<span className="flex items-center gap-1.5"><PencilLine className="h-4 w-4 text-foreground/50" /> Última edição</span>}
      action={!escrevendo && (
        <Button variant="secondary" size="sm" onClick={() => setEscrevendo(true)}>Registrar edição</Button>
      )}
    >
      {escrevendo && (
        <div className="mb-3 space-y-2">
          <Textarea
            rows={3}
            autoFocus
            placeholder="O que foi alterado? A IA usa isso para montar a mensagem para o cliente. Ex.: pausei o anúncio 2, subi o orçamento da campanha de leads para R$ 40/dia, troquei o público…"
            value={texto}
            disabled={salvando}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void salvar() }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={salvando} onClick={() => { setEscrevendo(false); setTexto('') }}>Cancelar</Button>
            <Button size="sm" loading={salvando} onClick={() => void salvar()}>Salvar</Button>
          </div>
        </div>
      )}

      {edicoes === null ? (
        <p className="text-xs text-foreground/45">Carregando…</p>
      ) : !ultima ? (
        !escrevendo && (
          <p className="text-xs text-foreground/50">
            Nenhuma edição registrada. Depois de mexer nas campanhas, registre aqui o que mudou para todo mundo acompanhar.
          </p>
        )
      ) : (
        <>
          <div className="group">
            <p className="whitespace-pre-wrap text-sm text-foreground">{ultima.texto}</p>
            <div className="mt-1 flex items-center gap-2">
              {quem(ultima)}
              {podeExcluir(ultima) && (
                <button type="button" onClick={() => void excluir(ultima)} title="Excluir" className="text-foreground/30 hover:text-danger">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <MensagemParaCliente edicao={ultima} onMudou={trocar} />
          </div>

          {anteriores.length > 0 && (
            <div className="mt-3 border-t border-line pt-2">
              <button
                type="button"
                onClick={() => setHistoricoAberto((v) => !v)}
                className="flex w-full items-center gap-1.5 text-xs font-medium text-foreground/60 hover:text-foreground"
              >
                <History className="h-3.5 w-3.5" />
                Histórico de edições ({anteriores.length})
                <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', historicoAberto && 'rotate-180')} />
              </button>
              {historicoAberto && (
                <ul className="mt-2 space-y-3">
                  {anteriores.map((e) => (
                    <li key={e.id} className="border-l-2 border-line pl-3">
                      <p className="whitespace-pre-wrap text-sm text-foreground/80">{e.texto}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {quem(e)}
                        {podeExcluir(e) && (
                          <button type="button" onClick={() => void excluir(e)} title="Excluir" className="text-foreground/30 hover:text-danger">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <MensagemParaCliente edicao={e} onMudou={trocar} fechada />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Painel>
  )
}

/**
 * A mensagem de WhatsApp para o cliente, escrita pela IA a partir da edição. O gestor revisa, ajusta
 * se quiser e copia para mandar. Nada é enviado sozinho.
 */
function MensagemParaCliente({ edicao, onMudou, fechada }: {
  edicao: GcEdicaoTrafego; onMudou: (e: GcEdicaoTrafego) => void; fechada?: boolean
}) {
  const [aberta, setAberta] = React.useState(!fechada)
  const [editando, setEditando] = React.useState(false)
  const [texto, setTexto] = React.useState(edicao.mensagem_cliente)
  const [ocupado, setOcupado] = React.useState<'gerar' | 'salvar' | null>(null)
  const [copiado, setCopiado] = React.useState(false)
  React.useEffect(() => setTexto(edicao.mensagem_cliente), [edicao.mensagem_cliente])

  const gerar = async () => {
    setOcupado('gerar')
    try {
      onMudou(await gcTrafego.gerarMensagemCliente(edicao.id))
      setEditando(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const salvar = async () => {
    setOcupado('salvar')
    try {
      onMudou(await gcTrafego.salvarMensagemCliente(edicao.id, texto))
      setEditando(false)
      toast.success('Mensagem salva')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setOcupado(null)
    }
  }
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(edicao.mensagem_cliente)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 1500)
    } catch {
      toast.error('Não consegui copiar. Selecione o texto e copie manualmente.')
    }
  }

  const tem = !!edicao.mensagem_cliente.trim()
  return (
    <div className="mt-2 rounded-lg border border-line bg-elevate/[0.03]">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-foreground/70 hover:text-foreground"
      >
        <MessageSquareText className="h-3.5 w-3.5" /> Mensagem para o cliente
        {!tem && <span className="font-normal text-foreground/40">· ainda não gerada</span>}
        <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', aberta && 'rotate-180')} />
      </button>
      {aberta && (
        <div className="space-y-2 px-3 pb-3">
          {editando ? (
            <Textarea rows={6} value={texto} disabled={ocupado === 'salvar'} onChange={(e) => setTexto(e.target.value)} />
          ) : tem ? (
            <p className="whitespace-pre-wrap rounded-md bg-card px-3 py-2 text-sm text-foreground">{edicao.mensagem_cliente}</p>
          ) : (
            <p className="text-xs text-foreground/50">A IA monta o recado para o cliente com base no que foi editado.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {editando ? (
              <>
                <Button size="sm" loading={ocupado === 'salvar'} onClick={() => void salvar()}>Salvar mensagem</Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditando(false); setTexto(edicao.mensagem_cliente) }}>Cancelar</Button>
              </>
            ) : tem ? (
              <>
                <Button size="sm" leftIcon={copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} onClick={() => void copiar()}>
                  {copiado ? 'Copiada' : 'Copiar'}
                </Button>
                <Button variant="ghost" size="sm" leftIcon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => setEditando(true)}>Editar</Button>
                <Button variant="ghost" size="sm" loading={ocupado === 'gerar'} leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void gerar()}>
                  Gerar de novo
                </Button>
              </>
            ) : (
              <Button size="sm" loading={ocupado === 'gerar'} leftIcon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => void gerar()}>
                Gerar mensagem
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
