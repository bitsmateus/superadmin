import * as React from 'react'
import { Loader2, Send, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Drawer } from '@/components/ui/Drawer'
import { Button } from '@/components/ui/Button'
import { BotaoCopiar, TextoIa } from '@/components/gestaoClientes/TextoIa'
import { gcIa, type GcMensagemChat } from '@/services/gcTrafego'
import { cn } from '@/lib/utils'

const ATALHOS = [
  'Me dá um relatório dos últimos 7 dias pra mandar pro cliente',
  'O que eu faço agora pra melhorar o resultado desse cliente?',
  'Quais criativos estão funcionando e por quê?',
  'Cria 3 roteiros de Reels com base no que mais deu alcance',
  'Escreve 3 copies de anúncio novas pra testar',
  'Compara este mês com o anterior',
]

const chaveConversa = (id: string) => `gc-assistente-${id}`

/**
 * Assistente de IA dentro da ficha do cliente: a conversa leva junto (no servidor) tudo o que se
 * sabe do cliente — tráfego, metas, briefing, Instagram, histórico. A conversa fica só neste
 * navegador (sessionStorage), por cliente: é rascunho de trabalho, não registro.
 */
export function AssistenteIa({ aberto, onFechar, clienteId, nome }: { aberto: boolean; onFechar: () => void; clienteId: string; nome: string }) {
  const [msgs, setMsgs] = React.useState<GcMensagemChat[]>(() => {
    try {
      return JSON.parse(window.sessionStorage.getItem(chaveConversa(clienteId)) ?? '[]') as GcMensagemChat[]
    } catch {
      return []
    }
  })
  const [texto, setTexto] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const fimRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    try { window.sessionStorage.setItem(chaveConversa(clienteId), JSON.stringify(msgs.slice(-40))) } catch { /* sem armazenamento */ }
    fimRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, clienteId])

  const enviar = async (pergunta: string) => {
    const p = pergunta.trim()
    if (!p || enviando) return
    const historico = msgs
    setMsgs([...historico, { role: 'user', content: p }])
    setTexto('')
    setEnviando(true)
    try {
      const r = await gcIa.chat(clienteId, p, historico)
      setMsgs((m) => [...m, { role: 'assistant', content: r.resposta }])
    } catch (e) {
      toast.error((e as Error).message)
      setMsgs((m) => m.slice(0, -1))
      setTexto(p)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Drawer
      open={aberto}
      onClose={onFechar}
      width="min(96vw, 720px)"
      title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /> Assistente IA · {nome}</span>}
    >
      <div className="flex h-full flex-col px-5 pb-4">
        <div className="flex-1 space-y-3 overflow-y-auto py-4">
          {msgs.length === 0 && (
            <div className="space-y-3 py-4">
              <p className="text-sm text-foreground/60">
                Pergunte qualquer coisa sobre este cliente. Eu já sei os números do Meta, as metas, o briefing, o Instagram e as notas da equipe.
              </p>
              <div className="flex flex-wrap gap-2">
                {ATALHOS.map((a) => (
                  <button key={a} type="button" onClick={() => void enviar(a)} className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-foreground/75 hover:border-accent hover:text-foreground">
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[90%] rounded-2xl px-3.5 py-2.5',
                m.role === 'user' ? 'bg-accent text-white' : 'border border-line bg-card')}>
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                ) : (
                  <>
                    <TextoIa texto={m.content} />
                    <div className="mt-1 flex justify-end"><BotaoCopiar texto={m.content} /></div>
                  </>
                )}
              </div>
            </div>
          ))}
          {enviando && (
            <div className="flex items-center gap-2 text-sm text-foreground/50"><Loader2 className="h-4 w-4 animate-spin" /> Analisando os dados do cliente…</div>
          )}
          <div ref={fimRef} />
        </div>
        <div className="border-t border-line pt-3">
          <div className="flex items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void enviar(texto)
                }
              }}
              rows={2}
              placeholder="Pergunte sobre resultados, relatórios, criativos… (Enter envia)"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm placeholder:text-foreground/30 focus:border-accent focus:outline-none"
            />
            <Button loading={enviando} disabled={!texto.trim()} leftIcon={<Send className="h-4 w-4" />} onClick={() => void enviar(texto)}>Enviar</Button>
          </div>
          {msgs.length > 0 && (
            <button type="button" onClick={() => setMsgs([])} className="mt-2 inline-flex items-center gap-1 text-xs text-foreground/45 hover:text-foreground">
              <Trash2 className="h-3 w-3" /> Limpar conversa
            </button>
          )}
        </div>
      </div>
    </Drawer>
  )
}
