import * as React from 'react'
import { toast } from 'sonner'
import { Building2, Copy, ExternalLink, Globe, MessageSquare, Phone, Search, UserCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { db } from '@/services/db'
import { api } from '@/services/api'
import { copyToClipboard } from '@/lib/clipboard'
import { SITE_ONLY_CONFIG, briefingLinkFor, buildSiteBriefingMessage } from '@/lib/briefingSite'
import { asText, cn, normalizeText, normalizeWhatsappNumber } from '@/lib/utils'
import type { Client } from '@/types/client'

/** Etapas antes do Briefing: o cliente que recebe o briefing de site pula direto pra "Briefing". */
const PRE_BRIEFING_STAGES = ['lead', 'welcome', 'contract']

type Modo = 'novo' | 'existente'

/**
 * "Briefing de site" do Pipeline: gera o mesmo link de briefing do onboarding (/briefing/:token),
 * mas com a config `siteOnly` — o formulário pergunta só o que precisa pra criar o site.
 * O cliente cai na etapa Briefing e, quando responde, segue o fluxo normal (Iniciar configuração).
 */
export function SiteBriefingModal({
  open,
  onClose,
  clients,
  onOpenClient,
}: {
  open: boolean
  onClose: () => void
  clients: Client[]
  onOpenClient: (id: string) => void
}) {
  const [modo, setModo] = React.useState<Modo>('novo')
  const [nome, setNome] = React.useState('')
  const [empresa, setEmpresa] = React.useState('')
  const [whats, setWhats] = React.useState('')
  const [busca, setBusca] = React.useState('')
  const [escolhido, setEscolhido] = React.useState<string | null>(null)
  const [enviarWhats, setEnviarWhats] = React.useState(true)
  const [salvando, setSalvando] = React.useState(false)
  const [gerado, setGerado] = React.useState<{ clientId: string; name: string; link: string } | null>(null)

  React.useEffect(() => {
    if (!open) return
    setModo('novo'); setNome(''); setEmpresa(''); setWhats(''); setBusca(''); setEscolhido(null)
    setEnviarWhats(true); setSalvando(false); setGerado(null)
  }, [open])

  const candidatos = React.useMemo(() => {
    const q = normalizeText(busca)
    return clients
      .filter((c) => !c.archivedAt)
      .filter((c) => !q || normalizeText(`${asText(c.name)} ${asText(c.company)}`).includes(q))
      .sort((a, b) => asText(a.company).localeCompare(asText(b.company), 'pt-BR'))
      .slice(0, 30)
  }, [clients, busca])

  const clienteEscolhido = escolhido ? clients.find((c) => c.id === escolhido) : undefined
  // Quem já tem um briefing em andamento/respondido não pode trocar pra "só site": o link novo
  // sobrescreveria as respostas do briefing de atendimento quando o cliente enviasse.
  const temBriefing = (c: Client) => (c.briefingStatus ?? 'not_sent') !== 'not_sent'

  const numeroDigitado = whats.replace(/\D/g, '')
  const podeGerar =
    modo === 'novo'
      ? nome.trim().length >= 2 && empresa.trim().length >= 2 && numeroDigitado.length >= 10
      : Boolean(clienteEscolhido && !temBriefing(clienteEscolhido))

  const gerar = async () => {
    if (!podeGerar || salvando) return
    setSalvando(true)
    try {
      let client: Client | null | undefined
      if (modo === 'novo') {
        client = await db.createClientAndWait({
          name: nome.trim(),
          company: empresa.trim(),
          email: '',
          phone: whats.trim(),
          responsavel: undefined,
          stage: 'briefing',
        })
        if (!client) return
      } else {
        client = clienteEscolhido
      }
      if (!client) return

      const numero = normalizeWhatsappNumber(modo === 'novo' ? whats : client.briefingNumber || client.phone || '')
      const token = crypto.randomUUID()
      db.updateClient(client.id, {
        briefingConfig: SITE_ONLY_CONFIG,
        briefingToken: token,
        briefingStatus: 'sent',
        briefingSentAt: new Date().toISOString(),
        briefingApprovedAt: undefined,
        briefingRevisionNote: undefined,
        ...(numero.length >= 12 ? { briefingNumber: numero } : {}),
        ...(PRE_BRIEFING_STAGES.includes(client.stage) ? { stage: 'briefing' as const } : {}),
      })
      db.addLog(client.id, 'Briefing de site enviado', 'Link do briefing só de site gerado pelo Pipeline')

      const link = briefingLinkFor(token)
      if (enviarWhats && numero.length >= 12) {
        try {
          await api.post('/api/whatsapp/send', {
            number: numero,
            text: buildSiteBriefingMessage(client.name || 'cliente', link),
          })
          db.addLog(client.id, 'Briefing enviado no WhatsApp', numero)
          toast.success('Briefing de site enviado no WhatsApp do cliente')
        } catch (err) {
          toast.error('Link gerado, mas falhou o envio no WhatsApp: ' + (err instanceof Error ? err.message : 'erro'))
        }
      } else {
        toast.success('Link do briefing de site gerado')
      }
      setGerado({ clientId: client.id, name: client.name || 'cliente', link })
    } finally {
      setSalvando(false)
    }
  }

  const copiar = async (texto: string, ok: string) => {
    if (await copyToClipboard(texto)) toast.success(ok)
    else toast.error('Não foi possível copiar')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Briefing de site"
      description="Mesmo briefing de sempre, só com as perguntas pra criação do site."
      size="md"
    >
      {gerado ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-foreground/40">Link do briefing</div>
            <div className="break-all text-sm text-foreground">{gerado.link}</div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void copiar(gerado.link, 'Link copiado')}>
              Copiar link
            </Button>
            <Button
              variant="secondary"
              leftIcon={<MessageSquare className="h-4 w-4" />}
              onClick={() => void copiar(buildSiteBriefingMessage(gerado.name, gerado.link), 'Mensagem copiada')}
            >
              Copiar mensagem
            </Button>
            <Button
              leftIcon={<ExternalLink className="h-4 w-4" />}
              onClick={() => { onOpenClient(gerado.clientId); onClose() }}
            >
              Abrir cliente
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            {([['novo', 'Cliente novo'], ['existente', 'Cliente já cadastrado']] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setModo(v)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                  modo === v
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line bg-surface text-foreground/55 hover:border-accent/30 hover:text-foreground/80',
                )}
              >
                {l}
              </button>
            ))}
          </div>

          {modo === 'novo' ? (
            <div className="space-y-3">
              <Input label="Nome do contato *" leftIcon={<UserCircle2 className="h-4 w-4" />} value={nome} onChange={(e) => setNome(e.target.value)} />
              <Input label="Empresa *" leftIcon={<Building2 className="h-4 w-4" />} value={empresa} onChange={(e) => setEmpresa(e.target.value)} />
              <Input
                label="WhatsApp do cliente (com DDD) *"
                leftIcon={<Phone className="h-4 w-4" />}
                value={whats}
                onChange={(e) => setWhats(e.target.value)}
                inputMode="tel"
                placeholder="(48) 99999-9999"
              />
              <p className="text-[11px] text-foreground/45">O cliente entra no Pipeline direto na etapa Briefing.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                placeholder="Buscar por nome ou empresa…"
                leftIcon={<Search className="h-4 w-4" />}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                {candidatos.length === 0 && (
                  <li className="px-3 py-4 text-center text-xs text-foreground/45">Nenhum cliente encontrado.</li>
                )}
                {candidatos.map((c) => {
                  const bloqueado = temBriefing(c)
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={bloqueado}
                        onClick={() => setEscolhido(c.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                          escolhido === c.id ? 'bg-accent/10' : 'hover:bg-elevate/[0.04]',
                          bloqueado && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{asText(c.company, '—')}</span>
                          <span className="block truncate text-[11px] text-foreground/45">{asText(c.name)}</span>
                        </span>
                        {bloqueado && <span className="shrink-0 text-[10px] text-foreground/45">já tem briefing</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="text-[11px] text-foreground/45">
                Clientes que já receberam o briefing de atendimento ficam bloqueados aqui — pra eles, cadastre
                o site como cliente novo.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground/80">
            <input type="checkbox" checked={enviarWhats} onChange={(e) => setEnviarWhats(e.target.checked)} className="h-4 w-4 accent-[#4F8EF7]" />
            Enviar o link no WhatsApp do cliente
          </label>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button onClick={() => void gerar()} disabled={!podeGerar || salvando} leftIcon={<Globe className="h-4 w-4" />}>
              {salvando ? 'Gerando…' : 'Gerar briefing de site'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
