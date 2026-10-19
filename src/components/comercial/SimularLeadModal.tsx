import * as React from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api } from '@/services/api'

export interface SimularLeadModalProps {
  open: boolean
  onClose: () => void
  onCreated: (leadId: string) => void
}

interface TemplateOpcao { name: string; language: string; bodyText: string; variableCount: number }

const PADRAO = 'primeiro_dia'
const OUTRO = '__outro__'
/** Assinatura padrão da boas-vindas ({{2}} do primeiro_dia). */
const ASSINATURA = 'Arthur'

const primeiroNome = (nome: string) => {
  const p = nome.trim().split(/\s+/)[0] ?? ''
  return p ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR') : ''
}

/** Simula a chegada de um lead do tráfego pago: cria o lead em Novos Leads e manda um template
 * (padrão: o de boas-vindas) pro telefone informado — use o seu pra testar. */
export function SimularLeadModal({ open, onClose, onCreated }: SimularLeadModalProps) {
  const [nome, setNome] = React.useState('')
  const [telefone, setTelefone] = React.useState('')
  const [templates, setTemplates] = React.useState<TemplateOpcao[]>([])
  const [escolha, setEscolha] = React.useState(PADRAO)
  const [manualNome, setManualNome] = React.useState('')
  const [manualIdioma, setManualIdioma] = React.useState('pt_BR')
  const [manualQtd, setManualQtd] = React.useState(1)
  // Valor digitado de cada variável; vazio = usa o padrão (1 = primeiro nome do lead, 2 = assinatura).
  const [vars, setVars] = React.useState<string[]>([])
  const [sending, setSending] = React.useState(false)
  const [result, setResult] = React.useState<{ enviada: boolean; erro: string | null } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setResult(null)
    api.get<{ templates: TemplateOpcao[] }>('/api/lead-rows/simular-trafego/templates')
      .then((r) => setTemplates(r.templates))
      .catch(() => setTemplates([]))
  }, [open])

  const selecionado = templates.find((t) => t.name === escolha)
  const manual = escolha === OUTRO
  const templateName = manual ? manualNome.trim() : escolha
  const idioma = manual ? manualIdioma.trim() : selecionado?.language ?? 'en'
  const qtd = manual ? manualQtd : selecionado ? selecionado.variableCount : 2

  const padraoDe = (i: number) => (i === 0 ? primeiroNome(nome) || 'aí' : i === 1 ? ASSINATURA : '')
  const valores = Array.from({ length: qtd }, (_, i) => (vars[i]?.trim() ? vars[i].trim() : padraoDe(i)))

  const preview = selecionado?.bodyText
    ? selecionado.bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => valores[Number(n) - 1] || `{{${n}}}`)
    : ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!templateName) { toast.error('Informe o nome do template.'); return }
    if (valores.some((v) => !v)) { toast.error('Preencha todas as variáveis.'); return }
    setSending(true)
    setResult(null)
    try {
      const r = await api.post<{ id: string; enviada: boolean; erro: string | null }>(
        '/api/lead-rows/simular-trafego',
        { nome, telefone, template: templateName, language: idioma, params: valores },
      )
      setResult({ enviada: r.enviada, erro: r.erro })
      if (r.enviada) toast.success('Lead criado e mensagem enviada.')
      else toast.error('Lead criado, mas a mensagem não saiu.')
      onCreated(r.id)
    } catch (err) {
      toast.error('Falha ao simular: ' + (err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const input = 'mt-1 w-full rounded-md bg-elevate/[0.05] px-2.5 py-2 text-sm text-foreground outline-none'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Simular lead do tráfego"
      description="Cria um lead de teste em Novos Leads e envia o template escolhido de verdade pro telefone abaixo."
      size="md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs text-foreground/50">
          Nome do lead
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Maria da Silva" className={input} required />
        </label>
        <label className="block text-xs text-foreground/50">
          Telefone (WhatsApp)
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="11999999999" inputMode="tel" className={input} required />
        </label>

        <label className="block text-xs text-foreground/50">
          Template
          <select value={escolha} onChange={(e) => { setEscolha(e.target.value); setVars([]) }} className={input}>
            {!templates.some((t) => t.name === PADRAO) && <option value={PADRAO}>{PADRAO} (padrão)</option>}
            {templates.map((t) => (
              <option key={t.name} value={t.name}>{t.name} · {t.language}{t.name === PADRAO ? ' (padrão)' : ''}</option>
            ))}
            <option value={OUTRO}>Outro (digitar o nome)…</option>
          </select>
        </label>

        {manual && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_5rem]">
            <label className="col-span-2 block text-xs text-foreground/50 sm:col-span-1">
              Nome do template
              <input value={manualNome} onChange={(e) => setManualNome(e.target.value)} placeholder="retorno_proposta_2" className={input} />
            </label>
            <label className="block text-xs text-foreground/50">
              Idioma
              <input value={manualIdioma} onChange={(e) => setManualIdioma(e.target.value)} className={input} />
            </label>
            <label className="block text-xs text-foreground/50">
              Variáveis
              <input type="number" min={0} max={10} value={manualQtd} onChange={(e) => setManualQtd(Math.max(0, Number(e.target.value) || 0))} className={input} />
            </label>
          </div>
        )}

        {qtd > 0 && (
          <div className="space-y-2">
            {Array.from({ length: qtd }, (_, i) => (
              <label key={i} className="block text-xs text-foreground/50">
                {`Variável {{${i + 1}}}`}{i === 0 ? ' (primeiro nome)' : i === 1 ? ' (assinatura)' : ''}
                <input
                  value={vars[i] ?? ''}
                  onChange={(e) => setVars((prev) => { const n = [...prev]; n[i] = e.target.value; return n })}
                  placeholder={padraoDe(i) || 'Obrigatória'}
                  className={input}
                />
              </label>
            ))}
          </div>
        )}

        {preview && (
          <div className="rounded-md border border-line bg-elevate/[0.03] p-2.5 text-xs leading-relaxed text-foreground/70">
            <div className="mb-1 font-semibold text-foreground/50">Prévia</div>
            <p className="whitespace-pre-wrap">{preview}</p>
          </div>
        )}

        {result && (
          <p className={result.enviada ? 'text-sm text-emerald-600' : 'break-words text-sm text-red-500'}>
            {result.enviada ? 'Mensagem enviada. Confira o WhatsApp e o selo no card do lead.' : `Não enviou: ${result.erro}`}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Fechar</Button>
          <Button type="submit" size="sm" disabled={sending}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {sending ? 'Enviando…' : 'Criar e enviar'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
