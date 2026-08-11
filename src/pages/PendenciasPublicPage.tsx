import * as React from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, ExternalLink, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { computeReadiness } from '@/constants/readiness'
import type {
  BriefingConfig,
  BriefingData,
  BriefingStatus,
  MetaVerificationStatus,
  PartnerAccessStatus,
} from '@/types/client'

/**
 * Portal público de pendências.
 *
 * O cliente abre um link e completa SÓ o que ficou faltando — sem refazer o
 * briefing inteiro. Ao enviar, os dados entram no briefing e o card destrava
 * sozinho na fila de configuração, acabando com o vai-e-volta no WhatsApp.
 */

interface PendingClient {
  id: string
  name: string
  company: string
  briefing_status: BriefingStatus | null
  briefing_data: BriefingData | null
  briefing_config: BriefingConfig | null
  contract_signed_at: string | null
  payment_status: 'pending' | 'paid' | 'overdue' | null
}

/** Estado do formulário — só os campos que o portal sabe coletar. */
interface FormState {
  site: string
  /** Cliente sem site — grava um marcador pra pendência não ficar eterna. */
  noSite: boolean
  whatsappNumbers: string
  numeroDedicado: string
  displayName: string
  verificacao: MetaVerificationStatus
  partnerAccess: PartnerAccessStatus
  channels: Record<string, { email: string; password: string }>
  aiCompanyDescription: string
  aiServices: string
  aiAttendanceFlow: string
  aiExternalWhatToQuery: string
  externalAutomationInfo: string
}

const emptyForm: FormState = {
  site: '',
  noSite: false,
  whatsappNumbers: '',
  numeroDedicado: '',
  displayName: '',
  verificacao: 'nao_iniciada',
  partnerAccess: 'pendente',
  channels: {},
  aiCompanyDescription: '',
  aiServices: '',
  aiAttendanceFlow: '',
  aiExternalWhatToQuery: '',
  externalAutomationInfo: '',
}

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  messenger: 'Facebook / Messenger',
  olx: 'OLX',
  mercadolivre: 'Mercado Livre',
}

export function PendenciasPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [client, setClient] = React.useState<PendingClient | null | undefined>(undefined)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [sending, setSending] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!token) { setClient(null); return }
    try {
      const row = await api.get<PendingClient>(`/api/public/pendencias/${token}`)
      setClient(row)
      // Pré-preenche com o que já existe, pra o cliente só corrigir/completar.
      const oa = row.briefing_data?.officialApi
      setForm((f) => ({
        ...f,
        numeroDedicado: oa?.numeroDedicado ?? '',
        displayName: oa?.displayNamePretendido ?? '',
        verificacao: oa?.verificacaoNegocioStatus ?? 'nao_iniciada',
        partnerAccess: oa?.partnerAccessStatus ?? 'pendente',
      }))
    } catch {
      setClient(null)
    }
  }, [token])

  React.useEffect(() => { void load() }, [load])

  if (client === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">
        Carregando…
      </div>
    )
  }

  if (!token || !client) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Link inválido</h1>
          <p className="mt-2 text-sm text-slate-500">
            Confira o link com a nossa equipe — ele pode ter expirado.
          </p>
        </div>
      </div>
    )
  }

  const readiness = computeReadiness({
    briefingConfig: client.briefing_config ?? undefined,
    briefingData: client.briefing_data ?? undefined,
    briefingStatus: client.briefing_status ?? undefined,
    contractSignedAt: client.contract_signed_at ?? undefined,
    paymentStatus: client.payment_status ?? undefined,
  })
  // O cliente só vê o que bloqueia a configuração — avisos internos
  // (contrato, financeiro) não entram aqui.
  const pending = readiness.blockers
  const ids = new Set(pending.map((p) => p.id))

  if (pending.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">
            Tudo certo por aqui!
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Recebemos tudo o que precisávamos da {client.company || 'sua empresa'}.
            Nossa equipe já pode iniciar a configuração e vai entrar em contato
            para agendar a ativação.
          </p>
        </div>
      </div>
    )
  }

  const setChannel = (key: string, patch: { email?: string; password?: string }) => {
    setForm((f) => ({
      ...f,
      channels: {
        ...f.channels,
        [key]: {
          email: patch.email ?? f.channels[key]?.email ?? '',
          password: patch.password ?? f.channels[key]?.password ?? '',
        },
      },
    }))
  }

  /** Monta só o que foi preenchido — o back ignora o resto. */
  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {}

    if (ids.has('site')) {
      if (form.noSite) patch.site = 'Não possui site'
      else if (form.site.trim()) patch.site = form.site.trim()
    }

    if (ids.has('whatsapp_number')) {
      const nums = form.whatsappNumbers
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (nums.length > 0) patch.whatsappNumbers = nums
    }

    const oa: Record<string, unknown> = {}
    if (ids.has('api_numero_dedicado') && form.numeroDedicado.trim()) {
      oa.numeroDedicado = form.numeroDedicado.trim()
    }
    if (ids.has('api_display_name') && form.displayName.trim()) {
      oa.displayNamePretendido = form.displayName.trim()
    }
    if (ids.has('api_verificacao') && form.verificacao !== 'nao_iniciada') {
      oa.verificacaoNegocioStatus = form.verificacao
    }
    if (ids.has('api_partner_access') && form.partnerAccess === 'concedido') {
      oa.partnerAccessStatus = form.partnerAccess
    }
    if (Object.keys(oa).length > 0) patch.officialApi = oa

    const channels: Record<string, { email: string; password: string }> = {}
    for (const [key, v] of Object.entries(form.channels)) {
      if (!ids.has(`channel_${key}`)) continue
      if (v.email.trim() && v.password.trim()) {
        channels[key] = { email: v.email.trim(), password: v.password.trim() }
      }
    }
    if (Object.keys(channels).length > 0) patch.channelAccess = channels

    if (ids.has('ia_answers')) {
      if (form.aiCompanyDescription.trim()) patch.aiCompanyDescription = form.aiCompanyDescription.trim()
      if (form.aiServices.trim()) patch.aiServices = form.aiServices.trim()
      if (form.aiAttendanceFlow.trim()) patch.aiAttendanceFlow = form.aiAttendanceFlow.trim()
    }
    if (ids.has('ia_integration') && form.aiExternalWhatToQuery.trim()) {
      patch.aiExternalWhatToQuery = form.aiExternalWhatToQuery.trim()
    }
    if (ids.has('external_automation') && form.externalAutomationInfo.trim()) {
      patch.externalAutomationInfo = form.externalAutomationInfo.trim()
    }
    return patch
  }

  const submit = async () => {
    const patch = buildPatch()
    if (Object.keys(patch).length === 0) {
      toast.error('Preencha ao menos um item antes de enviar.')
      return
    }
    setSending(true)
    try {
      await api.post(`/api/public/pendencias/${token}`, { patch })
      const before = pending.length
      await load()
      // Se sobrou alguma coisa, o formulário recarrega com o que falta.
      toast.success(
        before === Object.keys(patch).length
          ? 'Informações enviadas!'
          : 'Informações enviadas — obrigado!',
      )
      setForm((f) => ({ ...f, channels: {} }))
    } catch (err) {
      toast.error('Falha ao enviar: ' + (err instanceof Error ? err.message : 'erro'))
    } finally {
      setSending(false)
    }
  }

  // Pendências que não dá pra resolver aqui (exigem o briefing completo).
  const briefingOnly = pending.filter((p) =>
    ['briefing_missing', 'briefing_pending', 'users_missing'].includes(p.id),
  )
  const solvableHere = pending.filter((p) => !briefingOnly.includes(p))

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#4F8EF7] text-sm font-semibold text-white">
            {(client.company || client.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {client.company || client.name}
            </div>
            <div className="text-xs text-slate-500">
              Pendências para iniciar a configuração
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            Faltam <strong>{pending.length}</strong>{' '}
            {pending.length === 1 ? 'informação' : 'informações'} para começarmos
            a configuração. Preencha abaixo — pode enviar aos poucos, o que já
            foi enviado fica salvo.
          </p>
        </div>

        {briefingOnly.length > 0 && (
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold">Complete no formulário de briefing</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {briefingOnly.map((b) => (
                <li key={b.id}>• {b.ask}</li>
              ))}
            </ul>
            <a
              href={`/briefing/${token}`}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#4F8EF7] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F7DE0]"
            >
              Abrir briefing
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        )}

        {solvableHere.length > 0 && (
          <div className="space-y-4">
            {ids.has('site') && (
              <Card
                title="Site da empresa"
                hint="Usamos como referência do negócio — e a Meta pede na verificação da API Oficial."
              >
                <Input
                  value={form.site}
                  onChange={(v) => setForm({ ...form, site: v, noSite: false })}
                  placeholder="https://www.suaempresa.com.br"
                />
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={form.noSite}
                    onChange={(e) =>
                      setForm({ ...form, noSite: e.target.checked, site: '' })
                    }
                    className="h-4 w-4 accent-[#4F8EF7]"
                  />
                  Não temos site
                </label>
              </Card>
            )}

            {ids.has('whatsapp_number') && (
              <Card
                title="Número de WhatsApp"
                hint="Números que serão conectados ao sistema, com DDD. Um por linha."
              >
                <Textarea
                  value={form.whatsappNumbers}
                  onChange={(v) => setForm({ ...form, whatsappNumbers: v })}
                  rows={3}
                  placeholder={'Ex:\n11 99999-0000\n11 98888-0000'}
                />
              </Card>
            )}

            {(ids.has('api_numero_dedicado') ||
              ids.has('api_display_name') ||
              ids.has('api_verificacao') ||
              ids.has('api_partner_access')) && (
              <Card
                title="API Oficial do WhatsApp (Meta)"
                hint="Esta etapa vem antes do chatbot e da IA — sem ela, a configuração não avança."
              >
                <div className="space-y-3">
                  {ids.has('api_numero_dedicado') && (
                    <Field
                      label="Número dedicado para a API Oficial"
                      hint="Precisa estar SEM WhatsApp ou WhatsApp Business ativo. Se estiver em uso, é necessário apagar a conta antes."
                    >
                      <Input
                        value={form.numeroDedicado}
                        onChange={(v) => setForm({ ...form, numeroDedicado: v })}
                        placeholder="Ex: 11 3333-0000"
                      />
                    </Field>
                  )}
                  {ids.has('api_display_name') && (
                    <Field
                      label="Nome que aparecerá no WhatsApp (display name)"
                      hint="É o nome que seus clientes vão ver. Precisa ter relação com a empresa — a Meta aprova ou recusa."
                    >
                      <Input
                        value={form.displayName}
                        onChange={(v) => setForm({ ...form, displayName: v })}
                        placeholder="Ex: Clínica Bem Estar"
                      />
                    </Field>
                  )}
                  {ids.has('api_verificacao') && (
                    <Field
                      label="Verificação do negócio na Meta"
                      hint="Feita no Gerenciador de Negócios (business.facebook.com) → Configurações → Central de Segurança."
                    >
                      <Select
                        value={form.verificacao}
                        onChange={(v) =>
                          setForm({ ...form, verificacao: v as MetaVerificationStatus })
                        }
                        options={[
                          { value: 'nao_iniciada', label: 'Ainda não iniciei' },
                          { value: 'em_analise', label: 'Enviei — está em análise' },
                          { value: 'aprovada', label: 'Já foi aprovada' },
                        ]}
                      />
                    </Field>
                  )}
                  {ids.has('api_partner_access') && (
                    <Field
                      label="Acesso de parceiro (partner access)"
                      hint="No Gerenciador de Negócios → Configurações → Parceiros → Adicionar parceiro, informando o ID que nossa equipe enviou."
                    >
                      <Select
                        value={form.partnerAccess}
                        onChange={(v) =>
                          setForm({ ...form, partnerAccess: v as PartnerAccessStatus })
                        }
                        options={[
                          { value: 'pendente', label: 'Ainda não concedi' },
                          { value: 'concedido', label: 'Já concedi o acesso' },
                        ]}
                      />
                    </Field>
                  )}
                </div>
              </Card>
            )}

            {Object.keys(CHANNEL_LABELS)
              .filter((key) => ids.has(`channel_${key}`))
              .map((key) => (
                <Card
                  key={key}
                  title={`Acesso — ${CHANNEL_LABELS[key]}`}
                  hint="Precisamos do login para conectar o canal ao sistema."
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="E-mail ou usuário">
                      <Input
                        value={form.channels[key]?.email ?? ''}
                        onChange={(v) => setChannel(key, { email: v })}
                        placeholder="email@empresa.com"
                      />
                    </Field>
                    <Field label="Senha">
                      <Input
                        value={form.channels[key]?.password ?? ''}
                        onChange={(v) => setChannel(key, { password: v })}
                        placeholder="••••••••"
                      />
                    </Field>
                  </div>
                </Card>
              ))}

            {ids.has('ia_answers') && (
              <Card
                title="Informações para a IA"
                hint="É com isso que treinamos o atendimento automático."
              >
                <div className="space-y-3">
                  <Field label="O que a empresa faz e para quem atende">
                    <Textarea
                      value={form.aiCompanyDescription}
                      onChange={(v) => setForm({ ...form, aiCompanyDescription: v })}
                      rows={3}
                      placeholder="Ex: Somos uma clínica de estética que atende mulheres entre 25 e 50 anos…"
                    />
                  </Field>
                  <Field label="Principais serviços ou produtos">
                    <Textarea
                      value={form.aiServices}
                      onChange={(v) => setForm({ ...form, aiServices: v })}
                      rows={4}
                      placeholder={'Ex:\n- Limpeza de pele\n- Botox\n- Depilação a laser'}
                    />
                  </Field>
                  <Field label="Como a IA deve conduzir a conversa">
                    <Textarea
                      value={form.aiAttendanceFlow}
                      onChange={(v) => setForm({ ...form, aiAttendanceFlow: v })}
                      rows={4}
                      placeholder={'Ex: 1. Saudar pelo nome\n2. Perguntar o que procura\n3. Oferecer agendamento'}
                    />
                  </Field>
                </div>
              </Card>
            )}

            {ids.has('ia_integration') && (
              <Card
                title="Integração da IA com o seu sistema"
                hint="O que a IA precisa consultar em tempo real (pedidos, estoque, agenda…)."
              >
                <Textarea
                  value={form.aiExternalWhatToQuery}
                  onChange={(v) => setForm({ ...form, aiExternalWhatToQuery: v })}
                  rows={4}
                  placeholder={'Ex:\n- Status do pedido pelo CPF\n- Estoque de um produto'}
                />
              </Card>
            )}

            {ids.has('external_automation') && (
              <Card
                title="Automação externa"
                hint="Integrações, credenciais ou dados necessários."
              >
                <Textarea
                  value={form.externalAutomationInfo}
                  onChange={(v) => setForm({ ...form, externalAutomationInfo: v })}
                  rows={4}
                  placeholder="Descreva as integrações necessárias…"
                />
              </Card>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F8EF7] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#3F7DE0] disabled:opacity-60"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Enviar informações
            </button>
            <p className="pb-8 text-center text-xs text-slate-400">
              Seus dados são usados apenas para configurar o seu atendimento.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}

// ── UI ────────────────────────────────────────────────────────────────────────

function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {hint && <span className="mb-1.5 block text-[11px] text-slate-400">{hint}</span>}
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#4F8EF7] focus:outline-none focus:ring-4 focus:ring-[#4F8EF7]/15'

function Input({
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
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(inputCls, 'h-11')}
    />
  )
}

function Textarea({
  value,
  onChange,
  rows,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows ?? 3}
      placeholder={placeholder}
      className={inputCls}
    />
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputCls, 'h-11')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
