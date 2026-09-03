import * as React from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Copy, ExternalLink } from 'lucide-react'
import { publicTemplateRequestApi } from '@/api/templateRequests'
import type {
  RequestTarget,
  TemplateButton,
  TemplateButtonType,
  TemplateRequestPublicData,
  TemplateVariable,
} from '@/types/templateRequest'

type Step = 'loading' | 'invalid' | 'no-numbers' | 'welcome' | 'form' | 'done' | 'already'

const BUTTON_TYPE_LABEL: Record<TemplateButtonType, string> = {
  QUICK_REPLY: 'Resposta rápida',
  URL: 'Link',
  COPY_CODE: 'Copiar código',
}

/** Variáveis prontas — insere a variável E já preenche um exemplo plausível, pra quem não sabe
 *  o que colocar no exemplo (a Meta exige um exemplo pra cada variável). */
const VARIABLE_PRESETS: { label: string; example: string }[] = [
  { label: 'Nome', example: 'Maria' },
  { label: 'Saudação', example: 'Bom dia' },
  { label: 'Empresa', example: 'Sua Empresa' },
  { label: 'Pedido/Código', example: '12345' },
  { label: 'Data', example: '15/03' },
  { label: 'Valor', example: 'R$ 150,00' },
]

// Mesma heurística do backend (server/src/lib/metaGraph.ts#suggestCategory) — só pra mostrar um
// indicativo em tempo real, quem decide de verdade é o servidor na hora de criar.
const MARKETING_WORDS = ['promo', 'promoção', 'promocao', 'desconto', 'oferta', 'aproveite', 'novidade', 'imperdível', 'imperdivel', 'black friday', 'cupom', 'condição especial', 'condicao especial']
const AUTH_WORDS = ['código', 'codigo', 'otp', 'verificação', 'verificacao', 'autenticação', 'autenticacao', 'senha temporária', 'senha temporaria']
type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'
function detectCategory(body: string): TemplateCategory {
  const t = (body ?? '').toLowerCase()
  if (AUTH_WORDS.some((k) => t.includes(k))) return 'AUTHENTICATION'
  if (MARKETING_WORDS.some((k) => t.includes(k))) return 'MARKETING'
  return 'UTILITY'
}
const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  UTILITY: 'Utilidade',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticação',
}
const CATEGORY_STYLE: Record<TemplateCategory, string> = {
  UTILITY: 'bg-blue-100 text-blue-700',
  MARKETING: 'bg-purple-100 text-purple-700',
  AUTHENTICATION: 'bg-amber-100 text-amber-700',
}

export function TemplateRequestPublicPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [step, setStep] = React.useState<Step>('loading')
  const [data, setData] = React.useState<TemplateRequestPublicData | null>(null)
  const [resultTargets, setResultTargets] = React.useState<RequestTarget[]>([])

  const [purpose, setPurpose] = React.useState('')
  const [header, setHeader] = React.useState('')
  const [body, setBody] = React.useState('')
  const [footer, setFooter] = React.useState('')
  const [examples, setExamples] = React.useState<Record<number, string>>({})
  const [buttons, setButtons] = React.useState<TemplateButton[]>([])
  const [selectedWabaIds, setSelectedWabaIds] = React.useState<string[]>([])
  const [submitting, setSubmitting] = React.useState(false)
  const [submitError, setSubmitError] = React.useState('')
  const bodyRef = React.useRef<HTMLTextAreaElement>(null)
  const cursorRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    let cancelled = false
    publicTemplateRequestApi
      .get(token)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setSelectedWabaIds(d.numbers.map((n) => n.wabaId))
        if (d.status === 'submitted') {
          setResultTargets(d.targets)
          setStep('already')
        } else if (d.numbers.length === 0) {
          setStep('no-numbers')
        } else {
          if (d.status === 'failed') {
            setPurpose(d.purpose ?? '')
            toast.message('A última tentativa falhou em todos os números — revise e envie de novo.')
          }
          setStep('welcome')
        }
      })
      .catch(() => !cancelled && setStep('invalid'))
    return () => {
      cancelled = true
    }
  }, [token])

  const toggleNumber = (wabaId: string) =>
    setSelectedWabaIds((ids) => (ids.includes(wabaId) ? ids.filter((id) => id !== wabaId) : [...ids, wabaId]))

  const variablePositions = React.useMemo(() => {
    const out = new Set<number>()
    const re = /\{\{\s*(\d+)\s*\}\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) out.add(Number(m[1]))
    return [...out].sort((a, b) => a - b)
  }, [body])

  // Insere sempre onde o cursor estava no textarea — guardado em cursorRef (atualizado a cada
  // clique/digitação/seleção), não em document.activeElement, que já deixou de ser o textarea no
  // instante do clique no botão "+ Inserir variável" (o foco vai pro botão).
  const insertVariable = (presetExample?: string) => {
    const next = (variablePositions[variablePositions.length - 1] ?? 0) + 1
    const token_ = `{{${next}}}`
    const pos = cursorRef.current ?? body.length
    setBody(body.slice(0, pos) + token_ + body.slice(pos))
    if (presetExample) setExamples((ex) => ({ ...ex, [next]: presetExample }))
    const newPos = pos + token_.length
    cursorRef.current = newPos
    requestAnimationFrame(() => {
      const el = bodyRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(newPos, newPos)
      }
    })
  }
  const trackCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    cursorRef.current = e.currentTarget.selectionStart
  }

  const addButton = (type: TemplateButtonType) => {
    if (buttons.length >= 3) {
      toast.error('Até 3 botões por template.')
      return
    }
    setButtons((b) => [...b, { type }])
  }
  const patchButton = (i: number, patch: Partial<TemplateButton>) =>
    setButtons((b) => b.map((btn, x) => (x === i ? { ...btn, ...patch } : btn)))
  const removeButton = (i: number) => setButtons((b) => b.filter((_, x) => x !== i))

  const preview = React.useMemo(() => {
    let text = body
    for (const pos of variablePositions) {
      text = text.replace(new RegExp(`\\{\\{\\s*${pos}\\s*\\}\\}`, 'g'), examples[pos]?.trim() || `[exemplo ${pos}]`)
    }
    return text
  }, [body, variablePositions, examples])

  const submit = async () => {
    if (!purpose.trim()) return toast.error('Conte o propósito da mensagem.')
    if (!body.trim()) return toast.error('Escreva o texto da mensagem.')
    if (selectedWabaIds.length === 0) return toast.error('Escolha em quais números criar o modelo.')
    const trimmedBody = body.trim()
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmedBody)) {
      return toast.error('A mensagem não pode começar com uma variável — escreva um texto fixo antes.')
    }
    if (/\{\{\s*\d+\s*\}\}$/.test(trimmedBody)) {
      return toast.error('A mensagem não pode terminar com uma variável — escreva um texto fixo depois (ex.: uma saudação).')
    }
    const missing = variablePositions.find((p) => !examples[p]?.trim())
    if (missing) return toast.error(`Preencha o exemplo da variável {{${missing}}}.`)
    for (const btn of buttons) {
      if (btn.type === 'URL' && !btn.urlBase?.trim()) return toast.error('Preencha o link do botão.')
      if (btn.type === 'URL' && btn.dynamic && !btn.example?.trim()) return toast.error('Preencha um exemplo pro final do link.')
      if (btn.type === 'COPY_CODE' && !btn.example?.trim()) return toast.error('Preencha um código de exemplo.')
    }

    const variables: TemplateVariable[] = variablePositions.map((position) => ({ position, example: examples[position]?.trim() || '' }))

    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await publicTemplateRequestApi.submit(token, {
        purpose: purpose.trim(),
        header: header.trim() || undefined,
        body: trimmedBody,
        footer: footer.trim() || undefined,
        variables,
        buttons,
        wabaIds: selectedWabaIds,
      })
      setResultTargets(res.targets)
      setStep('done')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Falha ao enviar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-screen w-full px-4 py-10"
      style={{ background: 'linear-gradient(135deg, #1E1B6B 0%, #2B2FB5 55%, #2F5BFF 100%)' }}
    >
      <div className="mx-auto max-w-2xl">
        {step === 'loading' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-xl">
            <p className="text-sm text-slate-500">Carregando…</p>
          </div>
        )}

        {step === 'invalid' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-xl">
            <h1 className="text-2xl font-bold text-slate-800">Link inválido</h1>
            <p className="mt-3 text-sm text-slate-500">
              Esse link não existe mais ou expirou. Fale com a NX Digital pra gerar um novo.
            </p>
          </div>
        )}

        {step === 'no-numbers' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-3xl">📵</div>
            <h1 className="text-2xl font-bold text-slate-800">Não encontramos seu WhatsApp oficial</h1>
            <p className="mt-3 text-sm text-slate-500">
              Ainda não localizamos um número do WhatsApp oficial conectado à sua conta. Fale com nosso suporte pra gente
              configurar antes de criar o modelo de mensagem.
            </p>
          </div>
        )}

        {step === 'already' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-blue-100 text-3xl">📄</div>
            <h1 className="text-2xl font-bold text-slate-800">Template já enviado</h1>
            <p className="mt-3 text-sm text-slate-500">
              "{data?.templateName || data?.purpose}" já foi enviado pra aprovação da Meta. Precisa de outro modelo? Peça um
              novo link.
            </p>
            <TargetsSummary targets={resultTargets} />
          </div>
        )}

        {step === 'welcome' && (
          <div className="rounded-2xl bg-white p-8 shadow-xl">
            <h1 className="text-3xl font-bold text-slate-800">Vamos criar seu modelo de mensagem</h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              Olá{data?.clientName ? `, ${data.clientName}` : ''}! Pra mandar mensagens automáticas no WhatsApp (ex.: confirmação
              de pedido, aviso de entrega), o WhatsApp exige um modelo aprovado antes.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Preencha abaixo como você quer essa mensagem — a gente cuida de enviar pra aprovação. Leva de alguns minutos a 24h.
            </p>
            <button
              type="button"
              onClick={() => setStep('form')}
              className="mt-6 rounded-lg bg-[#2F5BFF] px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#2348d8]"
            >
              Começar
            </button>
          </div>
        )}

        {step === 'form' && (
          <div className="rounded-2xl bg-white p-8 shadow-xl">
            <h1 className="mb-6 text-2xl font-bold text-slate-800">Modelo de mensagem</h1>

            <div className="space-y-5">
              {(data?.numbers.length ?? 0) > 1 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-700">
                    Em quais números criar esse modelo? <span className="text-red-500">*</span>
                  </p>
                  <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    {data!.numbers.map((n) => (
                      <label key={n.wabaId} className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={selectedWabaIds.includes(n.wabaId)}
                          onChange={() => toggleNumber(n.wabaId)}
                        />
                        {n.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <Field label="Qual o propósito dessa mensagem?" required hint="Ex.: Confirmação de pedido, aviso de entrega...">
                <Text value={purpose} onChange={setPurpose} placeholder="Confirmação de pedido" />
              </Field>

              <Field label="Cabeçalho (opcional)" hint="Título curto em negrito, no topo da mensagem. Sem variável.">
                <Text value={header} onChange={(v) => setHeader(v.slice(0, 60))} placeholder="Ex.: Pedido confirmado" />
                <span className="mt-1 block text-right text-[11px] text-slate-400">{header.length}/60</span>
              </Field>

              <Field label="Texto da mensagem" required hint="Use variáveis quando algo mudar a cada envio (ex.: nome do cliente).">
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onSelect={trackCursor}
                  onClick={trackCursor}
                  onKeyUp={trackCursor}
                  rows={4}
                  maxLength={1024}
                  placeholder="Olá! Seu pedido foi confirmado e chega em breve."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
                />
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => insertVariable()}
                    className="rounded-md border border-[#2F5BFF]/30 bg-[#2F5BFF]/5 px-3 py-1.5 text-xs font-medium text-[#2F5BFF] hover:bg-[#2F5BFF]/10"
                  >
                    + Inserir variável
                  </button>
                  <span className="mx-1 text-slate-300">·</span>
                  {VARIABLE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => insertVariable(p.example)}
                      className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:border-[#2F5BFF] hover:text-[#2F5BFF]"
                    >
                      {p.label}
                    </button>
                  ))}
                  <span className="ml-auto text-[11px] text-slate-400">{body.length}/1024</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  A mensagem não pode começar nem terminar com uma variável — o WhatsApp exige texto fixo nas pontas.
                </p>
              </Field>

              {variablePositions.length > 0 && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-600">Exemplo de cada variável (obrigatório)</p>
                  {variablePositions.map((pos) => (
                    <label key={pos} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0 font-mono text-slate-500">{`{{${pos}}}`}</span>
                      <input
                        value={examples[pos] ?? ''}
                        onChange={(e) => setExamples((ex) => ({ ...ex, [pos]: e.target.value }))}
                        placeholder="Ex.: Maria"
                        className="h-9 flex-1 rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
                      />
                    </label>
                  ))}
                </div>
              )}

              <Field label="Rodapé (opcional)" hint="Linha pequena e cinza no final da mensagem. Sem variável.">
                <Text value={footer} onChange={(v) => setFooter(v.slice(0, 60))} placeholder="Ex.: Não responda esta mensagem" />
                <span className="mt-1 block text-right text-[11px] text-slate-400">{footer.length}/60</span>
              </Field>

              <div>
                <p className="mb-1.5 text-sm font-medium text-slate-700">Botões (opcional, até 3)</p>
                <div className="space-y-3">
                  {buttons.map((btn, i) => (
                    <ButtonEditor key={i} button={btn} onChange={(patch) => patchButton(i, patch)} onRemove={() => removeButton(i)} />
                  ))}
                </div>
                {buttons.length < 3 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['QUICK_REPLY', 'URL', 'COPY_CODE'] as TemplateButtonType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => addButton(t)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-[#2F5BFF] hover:text-[#2F5BFF]"
                      >
                        + {BUTTON_TYPE_LABEL[t]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {body.trim() && (
                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-700">Prévia</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CATEGORY_STYLE[detectCategory(body)]}`}>
                      {CATEGORY_LABEL[detectCategory(body)]}
                    </span>
                  </div>
                  <WhatsAppPreview header={header} body={preview} footer={footer} buttons={buttons} />
                </div>
              )}

              {submitError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{submitError}</div>
              )}
            </div>

            <div className="mt-7 flex justify-end">
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="rounded-lg bg-[#2F5BFF] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#2348d8] disabled:opacity-60"
              >
                {submitting ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-xl">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-green-100 text-3xl">✅</div>
            <h1 className="text-2xl font-bold text-slate-800">Modelo enviado!</h1>
            <p className="mt-3 text-sm text-slate-500">
              Mandamos seu modelo pra aprovação do WhatsApp. Isso leva de alguns minutos a 24h — nossa equipe te avisa assim que
              estiver liberado. Obrigado! 🚀
            </p>
            <TargetsSummary targets={resultTargets} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Bolha de mensagem igual a uma mensagem recebida no WhatsApp (é assim que o cliente final vê
 *  quando a empresa manda o template) — fundo de conversa, balão branco com "rabinho", cabeçalho
 *  em negrito, rodapé cinza pequeno, hora, e os botões como linhas coladas embaixo do balão, cada
 *  um com o ícone que o WhatsApp usa (link, copiar) — resposta rápida não tem ícone no WhatsApp. */
function WhatsAppPreview({
  header,
  body,
  footer,
  buttons,
}: {
  header: string
  body: string
  footer: string
  buttons: TemplateButton[]
}) {
  const now = React.useMemo(() => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), [])
  return (
    <div className="rounded-xl p-4" style={{ background: '#e5ddd5' }}>
      <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
        <div className="px-3 pb-1.5 pt-2">
          {header.trim() && <p className="mb-1 text-[14.5px] font-bold leading-snug text-slate-900">{header}</p>}
          <p className="whitespace-pre-wrap text-[14.5px] leading-snug text-slate-900">{body || '—'}</p>
          {footer.trim() && <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{footer}</p>}
          <div className="mt-1 flex justify-end">
            <span className="text-[11px] text-slate-400">{now}</span>
          </div>
        </div>
        {buttons.map((b, i) => (
          <div
            key={i}
            className="flex items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-[13.5px] font-medium text-[#00a5f4]"
          >
            {b.type === 'URL' && <ExternalLink className="h-3.5 w-3.5" />}
            {b.type === 'COPY_CODE' && <Copy className="h-3.5 w-3.5" />}
            {b.text || BUTTON_TYPE_LABEL[b.type]}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Resultado por número (quando o tenant tem mais de um WhatsApp conectado, cada um pode ter
 *  dado certo ou errado independente dos outros). */
function TargetsSummary({ targets }: { targets: RequestTarget[] }) {
  if (targets.length <= 1) return null
  return (
    <div className="mt-5 space-y-1.5 text-left">
      {targets.map((t) => (
        <div
          key={t.wabaId}
          className={`rounded-lg border px-3 py-2 text-xs ${
            t.status === 'submitted' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <span className="font-medium">{t.status === 'submitted' ? '✅' : '❌'} {t.label}</span>
          {t.status === 'failed' && t.errorMessage && <p className="mt-0.5 text-[11px]">{t.errorMessage}</p>}
        </div>
      ))}
    </div>
  )
}

function ButtonEditor({
  button,
  onChange,
  onRemove,
}: {
  button: TemplateButton
  onChange: (patch: Partial<TemplateButton>) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">{BUTTON_TYPE_LABEL[button.type]}</span>
        <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:underline">
          Remover
        </button>
      </div>
      <div className="space-y-2">
        {button.type !== 'COPY_CODE' && (
          <input
            value={button.text ?? ''}
            onChange={(e) => onChange({ text: e.target.value.slice(0, 25) })}
            placeholder={button.type === 'QUICK_REPLY' ? 'Ex.: Sim, quero' : 'Ex.: Ver pedido'}
            maxLength={25}
            className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
          />
        )}
        {button.type === 'URL' && (
          <>
            <input
              value={button.urlBase ?? ''}
              onChange={(e) => onChange({ urlBase: e.target.value })}
              placeholder="https://seusite.com.br/pedido/"
              className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
            />
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={Boolean(button.dynamic)} onChange={(e) => onChange({ dynamic: e.target.checked })} />
              O final do link muda a cada envio (ex.: número do pedido)
            </label>
            {button.dynamic && (
              <input
                value={button.example ?? ''}
                onChange={(e) => onChange({ example: e.target.value })}
                placeholder="Exemplo do final do link, ex.: 12345"
                className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
              />
            )}
          </>
        )}
        {button.type === 'COPY_CODE' && (
          <input
            value={button.example ?? ''}
            onChange={(e) => onChange({ example: e.target.value.slice(0, 15) })}
            placeholder="Código de exemplo, ex.: PROMO10"
            maxLength={15}
            className="h-9 w-full rounded-md border border-slate-300 px-2.5 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
          />
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {hint && <span className="mb-1 block text-xs text-slate-400">{hint}</span>}
      {children}
    </label>
  )
}

function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
    />
  )
}
