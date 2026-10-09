import * as React from 'react'
import { Loader2, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { trafegoService, type MensagemChat } from '@/services/trafego'

const EXEMPLOS = [
  'Por que você sugeriu isso?',
  'Que dados sustentam essa sugestão?',
  'O que pode dar errado se eu fizer isso?',
]

/** Conversa com a IA sobre UMA sugestão: explicar o porquê, tirar dúvidas, contestar. Fica só nesta tela. */
export function ChatSugestao({ dia, sugestaoId }: { dia: string; sugestaoId: string }) {
  const [mensagens, setMensagens] = React.useState<MensagemChat[]>([])
  const [texto, setTexto] = React.useState('')
  const [enviando, setEnviando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const fimRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => { fimRef.current?.scrollIntoView({ block: 'nearest' }) }, [mensagens, enviando])

  const enviar = async (conteudo: string) => {
    const msg = conteudo.trim()
    if (!msg || enviando) return
    setErro(null); setTexto(''); setEnviando(true)
    const historico = mensagens
    setMensagens([...historico, { role: 'user', content: msg }])
    try {
      const { resposta } = await trafegoService.conversarSugestao(dia, sugestaoId, msg, historico)
      setMensagens((m) => [...m, { role: 'assistant', content: resposta }])
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-elevate/[0.03] p-3">
      <p className="mb-2 text-xs text-foreground/50">
        Converse com a IA sobre esta sugestão. Ela responde com base nos dados da conta e não altera nada no Meta.
      </p>
      {mensagens.length === 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {EXEMPLOS.map((e) => (
            <button key={e} type="button" onClick={() => void enviar(e)}
              className="rounded-full border border-line px-2.5 py-1 text-xs text-foreground/70 hover:bg-elevate/[0.06] max-sm:py-2 max-sm:text-left">{e}</button>
          ))}
        </div>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {mensagens.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <p className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm max-sm:max-w-[92%]',
              m.role === 'user' ? 'bg-accent/10 text-foreground' : 'bg-card text-foreground ring-1 ring-line')}>{m.content}</p>
          </div>
        ))}
        {enviando && (
          <p className="inline-flex items-center gap-1.5 text-xs text-foreground/50"><Loader2 className="h-3.5 w-3.5 animate-spin" />A IA está analisando…</p>
        )}
        <div ref={fimRef} />
      </div>
      {erro && <p className="mt-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{erro}</p>}
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(texto) }}>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pergunte ou explique o contexto (ex.: essa campanha é de visita ao perfil)"
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm placeholder:text-foreground/30 focus:border-accent focus:outline-none"
        />
        <button type="submit" disabled={!texto.trim() || enviando}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white disabled:opacity-40 max-sm:w-9 max-sm:shrink-0 max-sm:justify-center max-sm:px-0">
          <Send className="h-3.5 w-3.5" /><span className="max-sm:sr-only">Enviar</span>
        </button>
      </form>
    </div>
  )
}
