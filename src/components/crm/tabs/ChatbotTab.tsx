import * as React from 'react'
import { toast } from 'sonner'
import { Bot, Download, Loader2, Send, Sparkles, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Section } from '../ClientDrawer'
import { chatbotFlowApi, type ChatbotFlowState } from '@/api/chatbotFlow'
import type { Client } from '@/types/client'
import type { FlowSpec, FlowStep } from '@/types/chatbotFlow'
import { slugify } from '@/lib/utils'

const TYPE_LABEL: Record<FlowStep['type'], string> = {
  ask: 'Pergunta',
  menu: 'Menu',
  end: 'Encerramento',
}

function errorsOf(err: unknown): string[] {
  const body = (err as { body?: { errors?: string[] } })?.body
  return Array.isArray(body?.errors) ? body!.errors! : []
}

export function ChatbotTab({ client }: { client: Client }) {
  const [data, setData] = React.useState<ChatbotFlowState | null>(null)
  const [edited, setEdited] = React.useState<FlowSpec | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<'generate' | 'save' | 'publish' | null>(null)
  const [errors, setErrors] = React.useState<string[]>([])

  const hasBriefingFlow = Boolean(client.briefingData?.chatbotFlow)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    chatbotFlowApi
      .get(client.id)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setEdited(d.spec)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [client.id])

  const generate = async () => {
    setBusy('generate')
    setErrors([])
    try {
      const r = await chatbotFlowApi.generate(client.id)
      setData((d) => ({
        spec: r.spec,
        json: r.json,
        warnings: r.warnings,
        generatedAt: new Date().toISOString(),
        publishedAt: d?.publishedAt ?? null,
      }))
      setEdited(r.spec)
      toast.success('Fluxo gerado com IA')
    } catch (err) {
      const errs = errorsOf(err)
      setErrors(errs)
      toast.error(err instanceof Error ? err.message : 'Falha ao gerar')
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!edited) return
    setBusy('save')
    setErrors([])
    try {
      const r = await chatbotFlowApi.saveSpec(client.id, edited)
      setData((d) => ({
        spec: r.spec,
        json: r.json,
        warnings: r.warnings,
        generatedAt: d?.generatedAt ?? new Date().toISOString(),
        publishedAt: d?.publishedAt ?? null,
      }))
      setEdited(r.spec)
      toast.success('Fluxo salvo')
    } catch (err) {
      setErrors(errorsOf(err))
      toast.error(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setBusy(null)
    }
  }

  const download = () => {
    if (!data?.json) return
    const blob = new Blob([JSON.stringify(data.json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slugify(client.company || client.name || 'fluxo')}-chatbot.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const publish = async () => {
    setBusy('publish')
    try {
      await chatbotFlowApi.publish(client.id)
      setData((d) => (d ? { ...d, publishedAt: new Date().toISOString() } : d))
      toast.success('Fluxo enviado ao tenant')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao enviar')
    } finally {
      setBusy(null)
    }
  }

  // Edição inline (imutável)
  const patchStep = (i: number, patch: Partial<FlowStep>) => {
    setEdited((s) =>
      s ? { ...s, steps: s.steps.map((st, x) => (x === i ? ({ ...st, ...patch } as FlowStep) : st)) } : s,
    )
  }
  const patchOption = (si: number, oi: number, patch: { label?: string; transferToQueue?: string }) => {
    setEdited((s) => {
      if (!s) return s
      const steps = s.steps.map((st, x) => {
        if (x !== si || st.type !== 'menu') return st
        return { ...st, options: st.options.map((o, y) => (y === oi ? { ...o, ...patch } : o)) }
      })
      return { ...s, steps }
    })
  }

  const dirty = JSON.stringify(edited) !== JSON.stringify(data?.spec ?? null)
  const nameOf = (id?: string) => edited?.steps.find((s) => s.id === id)?.name ?? id ?? '—'

  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-sm text-foreground/50">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Section
        title={
          <span className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-accent" />
            Fluxo do chatbot
          </span>
        }
      >
        <div className="space-y-3">
          {/* Ações */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={generate}
              loading={busy === 'generate'}
              leftIcon={busy !== 'generate' ? <Sparkles className="h-4 w-4" /> : undefined}
            >
              {edited ? 'Gerar novamente' : 'Gerar fluxo com IA'}
            </Button>
            {edited && (
              <>
                <Button variant="secondary" onClick={download} leftIcon={<Download className="h-4 w-4" />}>
                  Baixar JSON
                </Button>
                <Button
                  variant="secondary"
                  onClick={publish}
                  loading={busy === 'publish'}
                  leftIcon={busy !== 'publish' ? <Send className="h-4 w-4" /> : undefined}
                >
                  Enviar para o tenant
                </Button>
              </>
            )}
            {dirty && (
              <Button variant="primary" onClick={save} loading={busy === 'save'}>
                Salvar edições
              </Button>
            )}
          </div>

          {/* Carimbos */}
          {(data?.generatedAt || data?.publishedAt) && (
            <p className="text-[11px] text-foreground/45">
              {data?.generatedAt && <>Gerado em {new Date(data.generatedAt).toLocaleString('pt-BR')}. </>}
              {data?.publishedAt && <>Enviado em {new Date(data.publishedAt).toLocaleString('pt-BR')}.</>}
            </p>
          )}

          {/* Erros */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger/[0.06] p-3 text-xs text-danger">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertCircle className="h-3.5 w-3.5" /> Erros ({errors.length})
              </div>
              <ul className="list-disc space-y-0.5 pl-5">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Avisos */}
          {(data?.warnings?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/[0.07] p-3 text-xs text-foreground/80">
              <div className="mb-1 font-medium text-warning">Avisos ({data!.warnings.length})</div>
              <ul className="list-disc space-y-0.5 pl-5">
                {data!.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Vazio */}
          {!edited && (
            <p className="text-xs text-foreground/50">
              {hasBriefingFlow
                ? 'Clique em "Gerar fluxo com IA" para criar o roteiro a partir do briefing.'
                : 'O briefing ainda não tem a seção "Fluxo do chatbot" preenchida. Peça ao cliente para preencher, ou gere mesmo assim (a IA usa o restante do briefing).'}
            </p>
          )}
        </div>
      </Section>

      {/* Preview em árvore (editável) */}
      {edited && (
        <Section title={`Roteiro (${edited.steps.length} passos)`}>
          <div className="space-y-2">
            {edited.steps.map((step, i) => (
              <div key={step.id} className="rounded-lg border border-line bg-elevate/[0.02] p-3">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {TYPE_LABEL[step.type]}
                  </span>
                  <span className="text-xs font-medium text-foreground/80">{step.name}</span>
                  {step.id === edited.start && (
                    <span className="text-[10px] uppercase tracking-wider text-foreground/40">início</span>
                  )}
                </div>
                <textarea
                  value={step.message}
                  onChange={(e) => patchStep(i, { message: e.target.value })}
                  rows={2}
                  className="w-full rounded border border-line bg-card px-2 py-1.5 text-xs text-foreground/90 focus:border-accent/40 focus:outline-none"
                />
                {step.type === 'menu' && (
                  <ul className="mt-2 space-y-1">
                    {step.options.map((o, oi) => (
                      <li key={oi} className="flex items-center gap-2 text-xs">
                        <input
                          value={o.label}
                          onChange={(e) => patchOption(i, oi, { label: e.target.value })}
                          className="flex-1 rounded border border-line bg-card px-2 py-1 text-foreground/90 focus:border-accent/40 focus:outline-none"
                        />
                        {o.transferToQueue !== undefined ? (
                          <span className="flex shrink-0 items-center gap-1 text-foreground/40">
                            → fila:
                            <input
                              value={o.transferToQueue}
                              onChange={(e) => patchOption(i, oi, { transferToQueue: e.target.value })}
                              title="Nome do setor ou id da fila"
                              className="w-28 rounded border border-line bg-card px-1.5 py-0.5 text-foreground/90 focus:border-accent/40 focus:outline-none"
                            />
                          </span>
                        ) : (
                          <span className="shrink-0 text-foreground/40">→ {nameOf(o.next)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {step.type === 'ask' && (
                  <p className="mt-1 text-[11px] text-foreground/45">→ {nameOf(step.next)}</p>
                )}
                {step.type === 'end' && step.transferToQueue !== undefined && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-foreground/45">
                    → transfere para fila:
                    <input
                      value={step.transferToQueue}
                      onChange={(e) => patchStep(i, { transferToQueue: e.target.value } as Partial<FlowStep>)}
                      title="Nome do setor ou id da fila"
                      className="w-28 rounded border border-line bg-card px-1.5 py-0.5 text-foreground/90 focus:border-accent/40 focus:outline-none"
                    />
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
