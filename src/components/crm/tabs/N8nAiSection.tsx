import * as React from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Download, Loader2, Radio, Sparkles, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn, slugify } from '@/lib/utils'
import { Section } from '../ClientDrawer'
import { n8nFlowApi, type N8nFlowState } from '@/api/n8nFlow'
import type { Client } from '@/types/client'

export function N8nAiSection({ client }: { client: Client }) {
  const [state, setState] = React.useState<N8nFlowState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<'generate' | 'save' | null>(null)
  const [notes, setNotes] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [promptOpen, setPromptOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    n8nFlowApi
      .get(client.id)
      .then((s) => {
        if (cancelled) return
        setState(s)
        setPrompt(s.flow?.prompt ?? '')
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [client.id])

  const generate = async () => {
    setBusy('generate')
    try {
      const s = await n8nFlowApi.generate(client.id, notes.trim() || undefined)
      setState(s)
      setPrompt(s.flow?.prompt ?? '')
      toast.success('IA do n8n gerada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar')
    } finally {
      setBusy(null)
    }
  }

  const savePrompt = async () => {
    setBusy('save')
    try {
      await n8nFlowApi.savePrompt(client.id, prompt)
      const s = await n8nFlowApi.get(client.id)
      setState(s)
      setPrompt(s.flow?.prompt ?? prompt)
      toast.success('Prompt salvo e fluxo atualizado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setBusy(null)
    }
  }

  const download = () => {
    if (!state?.flow) return
    const blob = new Blob([JSON.stringify(state.flow.json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(client.company || client.name || 'ia')}-n8n.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const flow = state?.flow ?? null
  const channel = state?.channel ?? null
  const dirty = flow ? prompt !== flow.prompt : false

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-accent" />
          IA de atendimento (n8n)
        </span>
      }
    >
      {loading ? (
        <div className="grid place-items-center py-8 text-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-foreground/55">
            A IA lê o briefing, monta o prompt do agente para este cliente e gera o fluxo do n8n pronto para importar
            (texto, áudio, foto, vídeo e documento).
          </p>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Observações para a IA (opcional): tom de voz, regras especiais, o que evitar…"
            className="w-full rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 text-xs outline-none focus:border-accent"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={generate}
              loading={busy === 'generate'}
              disabled={!channel}
              leftIcon={busy !== 'generate' ? <Sparkles className="h-4 w-4" /> : undefined}
            >
              {flow ? 'Gerar novamente' : 'Gerar IA para o n8n'}
            </Button>
            {flow && (
              <Button variant="secondary" onClick={download} leftIcon={<Download className="h-4 w-4" />}>
                Baixar arquivo do n8n
              </Button>
            )}
          </div>

          {/* Canal conectado */}
          {channel ? (
            <div className="rounded-lg border border-line bg-elevate/[0.03] p-3 text-xs">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground/80">
                <Radio className="h-3.5 w-3.5 text-accent" />
                Canal conectado à IA
              </div>
              <div className="space-y-0.5 text-foreground/65">
                <div>
                  Servidor: <b className="text-foreground/85">{channel.serverName}</b> · tipo{' '}
                  <b className="text-foreground/85">{channel.sessionType}</b>
                </div>
                {channel.numbers.length > 0 && (
                  <div>
                    Número(s): <b className="text-foreground/85">{channel.numbers.join(', ')}</b>
                  </div>
                )}
                <div className="text-foreground/45">
                  As mensagens são recebidas e enviadas pelo token deste canal (API {channel.apiId.slice(0, 8)}…).
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-xs text-foreground/80">
              Este cliente ainda não tem canal/API do tenant. Crie o tenant (canal + API) para poder gerar a IA — o token do
              canal é usado para enviar e receber mensagens.
            </div>
          )}

          {flow && (
            <>
              <p className="text-[11px] text-foreground/45">
                Agente <b>{flow.agentName}</b> · gerado em {new Date(flow.generatedAt).toLocaleString('pt-BR')}. No NX, aponte o
                webhook do canal para o nó <code>Webhook NX</code> do n8n (caminho <code>{flow.webhookPath}</code>). No n8n, selecione
                sua credencial OpenAI nos nós indicados na nota do fluxo.
              </p>

              {flow.warnings.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-xs text-foreground/80">
                  <div className="mb-1 font-medium text-warning">Confirmar antes de usar ({flow.warnings.length})</div>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {flow.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="rounded-lg border border-line">
                <button
                  type="button"
                  onClick={() => setPromptOpen((o) => !o)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium"
                >
                  {promptOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Prompt do agente (editável)
                </button>
                {promptOpen && (
                  <div className={cn('space-y-2 border-t border-line p-3')}>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={18}
                      className="w-full rounded-lg border border-line bg-elevate/[0.02] px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-accent"
                    />
                    {dirty && (
                      <Button variant="primary" onClick={savePrompt} loading={busy === 'save'}>
                        Salvar prompt e atualizar fluxo
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  )
}
