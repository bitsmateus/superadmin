import * as React from 'react'
import { toast } from 'sonner'
import { api } from '@/services/api'

type Step = 'welcome' | 'form' | 'done'

interface FormState {
  company: string
  cnpj: string
  cpf: string
  paymentDay: string
  needsNF: string
  nfNumber: string
  nfEmail: string
  address: string
}

const EMPTY: FormState = {
  company: '',
  cnpj: '',
  cpf: '',
  paymentDay: '',
  needsNF: '',
  nfNumber: '',
  nfEmail: '',
  address: '',
}

export function FichaPublicPage() {
  const [step, setStep] = React.useState<Step>('welcome')
  const [f, setF] = React.useState<FormState>(EMPTY)
  const [submitting, setSubmitting] = React.useState(false)

  const set = (patch: Partial<FormState>) => setF((cur) => ({ ...cur, ...patch }))

  const submit = async () => {
    const required: [keyof FormState, string][] = [
      ['company', 'Nome da empresa'],
      ['cnpj', 'CNPJ'],
      ['cpf', 'CPF do responsável'],
      ['paymentDay', 'Melhor dia de pagamento'],
      ['needsNF', 'Nota Fiscal'],
      ['nfNumber', 'Número para NF+Boleto'],
      ['nfEmail', 'E-mail para NF+Boleto'],
      ['address', 'Endereço completo'],
    ]
    for (const [k, label] of required) {
      if (!String(f[k]).trim()) {
        toast.error(`Preencha: ${label}`)
        return
      }
    }
    setSubmitting(true)
    try {
      await api.post('/api/public/ficha', {
        company: f.company.trim(),
        cnpj: f.cnpj.trim(),
        cpfResponsavel: f.cpf.trim(),
        paymentDay: f.paymentDay,
        needsNF: f.needsNF === 'Sim',
        nfNumber: f.nfNumber.trim(),
        nfEmail: f.nfEmail.trim(),
        address: f.address.trim(),
      })
      setStep('done')
    } catch (err) {
      toast.error('Falha ao enviar: ' + (err instanceof Error ? err.message : 'Erro'))
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
        {step === 'welcome' && (
          <div className="rounded-2xl bg-white p-8 shadow-xl">
            <h1 className="text-3xl font-bold text-slate-800">Boas-vindas</h1>
            <p className="mt-4 text-sm font-semibold text-slate-700">
              Parabéns por dar esse passo rumo à evolução! 🚀
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Ficamos muito felizes em ter você aqui! Preencher essa ficha de cadastro é o
              primeiro passo de uma jornada de crescimento, aprendizado e transformação.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-500">
              Você está mais perto de alcançar seus objetivos — e nós estamos aqui para caminhar
              com você nessa trajetória.
            </p>
            <p className="mt-3 text-sm font-semibold text-slate-700">Vamos juntos!</p>
            <button
              type="button"
              onClick={() => setStep('form')}
              className="mt-6 rounded-lg bg-[#2F5BFF] px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-white hover:bg-[#2348d8]"
            >
              Iniciar ficha
            </button>
          </div>
        )}

        {step === 'form' && (
          <div className="rounded-2xl bg-white p-8 shadow-xl">
            <h1 className="mb-6 text-2xl font-bold text-slate-800">Ficha de cadastro</h1>
            <div className="space-y-5">
              <Field label="Nome da empresa" required>
                <Text value={f.company} onChange={(v) => set({ company: v })} />
              </Field>
              <Field label="CNPJ" required>
                <Text value={f.cnpj} onChange={(v) => set({ cnpj: v })} />
              </Field>
              <Field label="CPF do responsável" required>
                <Text value={f.cpf} onChange={(v) => set({ cpf: v })} />
              </Field>
              <Field label="Melhor dia de pagamento" required>
                <Select
                  value={f.paymentDay}
                  onChange={(v) => set({ paymentDay: v })}
                  options={['10', '20']}
                />
              </Field>
              <Field label="Sua empresa precisa de Nota Fiscal?" required>
                <Select
                  value={f.needsNF}
                  onChange={(v) => set({ needsNF: v })}
                  options={['Sim', 'Não']}
                />
              </Field>
              <Field label="Número para envio de NF+BOLETO" required>
                <Text value={f.nfNumber} onChange={(v) => set({ nfNumber: v })} />
              </Field>
              <Field label="E-mail para envio de NF+BOLETO" required>
                <Text type="email" value={f.nfEmail} onChange={(v) => set({ nfEmail: v })} />
              </Field>
              <Field label="Endereço completo" required hint="Rua, Número, Bairro, Cidade, Estado">
                <Text value={f.address} onChange={(v) => set({ address: v })} />
              </Field>
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
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-green-100 text-3xl">
              ✅
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Ficha enviada!</h1>
            <p className="mt-3 text-sm text-slate-500">
              Recebemos seus dados. Em breve nossa equipe entra em contato com os próximos passos.
              Obrigado! 🚀
            </p>
          </div>
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
  type = 'text',
}: {
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
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
  options: string[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#2F5BFF] focus:ring-1 focus:ring-[#2F5BFF]"
    >
      <option value=""></option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}
