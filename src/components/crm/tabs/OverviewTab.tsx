import * as React from 'react'
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Cpu,
  FileText,
  ListChecks,
  Mail,
  MessageSquare,
  Pencil,
  PlugZap,
  Send,
  Server as ServerIcon,
  Sparkles,
  StickyNote,
  UserCircle2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { useServerById } from '@/store/authStore'
import { copyToClipboard } from '@/lib/clipboard'
import { asText, cn, formatDate, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { Client } from '@/types/client'

export function OverviewTab({ client }: { client: Client }) {
  const [user] = useCurrentUser()
  const [noteText, setNoteText] = React.useState('')
  const [noteInternal, setNoteInternal] = React.useState(false)
  const tenantServer = useServerById(client.tenantServerId)

  const addNote = () => {
    const trimmed = noteText.trim()
    if (!trimmed) return
    if (!user) {
      toast.error('Defina seu nome em Configurações antes de registrar notas.')
      return
    }
    db.addNote(client.id, trimmed, user, noteInternal)
    db.addLog(client.id, noteInternal ? 'Nota interna registrada' : 'Nota registrada')
    setNoteText('')
    setNoteInternal(false)
    toast.success('Nota registrada')
  }

  return (
    <div className="space-y-5">
      <Section title="Dados do cliente">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InlineField
            label="E-mail"
            value={client.email}
            onSave={(v) =>
              db.updateClient(client.id, { email: v }) &&
              db.addLog(client.id, 'E-mail atualizado')
            }
          />
          <InlineField
            label="Telefone"
            value={client.phone}
            onSave={(v) =>
              db.updateClient(client.id, { phone: v }) &&
              db.addLog(client.id, 'Telefone atualizado')
            }
          />
          <InlineField
            label="Empresa"
            value={client.company}
            onSave={(v) =>
              db.updateClient(client.id, { company: v }) &&
              db.addLog(client.id, 'Empresa atualizada')
            }
          />
          <InlineField
            label="Responsável"
            value={client.responsavel ?? ''}
            placeholder="Sem responsável"
            onSave={(v) =>
              db.updateClient(client.id, { responsavel: v }) &&
              db.addLog(client.id, 'Responsável atualizado')
            }
          />
          <div className="sm:col-span-2">
            <FieldLabel>Entrada</FieldLabel>
            <p className="mt-1 text-sm text-foreground/85">
              {formatDate(client.createdAt)}{' '}
              <span className="text-foreground/40">({timeAgo(client.createdAt)})</span>
            </p>
          </div>
        </div>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-accent" />
            Tipo de implementação
          </span>
        }
      >
        <p className="mb-3 text-xs text-foreground/55">
          Marque o que se aplica a esse cliente. Aparece nos painéis
          correspondentes do Dashboard.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ImplementationToggle
            label="API Oficial"
            description="WhatsApp API Oficial"
            icon={<PlugZap className="h-4 w-4" />}
            checked={!!client.hasApiOficial}
            onChange={(v) => {
              db.updateClient(client.id, { hasApiOficial: v })
              db.addLog(
                client.id,
                v ? 'Marcado como API Oficial' : 'Removido marcador API Oficial',
              )
            }}
          />
          <ImplementationToggle
            label="IA integrada"
            description="Atendimento com IA"
            icon={<Bot className="h-4 w-4" />}
            checked={!!client.hasIa}
            onChange={(v) => {
              db.updateClient(client.id, { hasIa: v })
              db.addLog(
                client.id,
                v ? 'Marcado como uso de IA' : 'Removido marcador IA',
              )
            }}
          />
          <ImplementationToggle
            label="Automação externa"
            description="n8n, Make, Zapier…"
            icon={<Cpu className="h-4 w-4" />}
            checked={!!client.hasAutomacaoExterna}
            onChange={(v) => {
              db.updateClient(client.id, { hasAutomacaoExterna: v })
              db.addLog(
                client.id,
                v
                  ? 'Marcado como automação externa'
                  : 'Removido marcador automação externa',
              )
            }}
          />
        </div>
      </Section>

      {(client.tenantId || client.supportEmail) && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <ServerIcon className="h-3.5 w-3.5 text-accent" />
              Tenant vinculado
            </span>
          }
          action={
            tenantServer ? (
              <Badge tone="info">{tenantServer.name}</Badge>
            ) : client.tenantServerId ? (
              <Badge tone="neutral">{client.tenantServerId}</Badge>
            ) : null
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>Nome do tenant</FieldLabel>
              <p className="mt-1 text-sm text-foreground/85">
                {client.tenantName ?? client.tenantId ?? '—'}
              </p>
            </div>
            <div>
              <FieldLabel>ID</FieldLabel>
              <p className="mt-1 text-sm text-foreground/85">
                <code className="text-foreground/70">{client.tenantId ?? '—'}</code>
              </p>
            </div>
            <div className="sm:col-span-2">
              <FieldLabel>E-mail de suporte</FieldLabel>
              <div className="mt-1 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-foreground/40" />
                <span className="text-sm text-foreground/85">
                  {client.supportEmail ?? '—'}
                </span>
                {client.supportEmail && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(client.supportEmail!)
                      if (ok) toast.success('E-mail copiado')
                      else toast.error('Não foi possível copiar')
                    }}
                    className="rounded-md p-1 text-foreground/40 hover:bg-elevate/[0.06] hover:text-foreground"
                    aria-label="Copiar e-mail"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Section>
      )}

      <Section
        title={
          <span className="flex items-center gap-2">
            <StickyNote className="h-3.5 w-3.5 text-accent" />
            Mensagens registradas
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Registre aqui mensagens trocadas, observações ou qualquer informação relevante…"
              className="min-h-[80px] flex-1 resize-y rounded-lg border border-elevate/10 bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-foreground/65 cursor-pointer">
              <input
                type="checkbox"
                checked={noteInternal}
                onChange={(e) => setNoteInternal(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#4F8EF7]"
              />
              <StickyNote className="h-3.5 w-3.5" />
              Nota interna (só o time vê)
            </label>
            <Button
              size="sm"
              onClick={addNote}
              disabled={!noteText.trim()}
              leftIcon={<MessageSquare className="h-3.5 w-3.5" />}
            >
              {noteInternal ? 'Registrar nota interna' : 'Registrar mensagem'}
            </Button>
          </div>

          {(client.notes ?? []).length === 0 ? (
            <p className="text-xs text-foreground/40">Nenhuma mensagem ainda.</p>
          ) : (
            <ul className="space-y-2">
              {(client.notes ?? []).map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    'rounded-lg border p-3',
                    n.internal
                      ? 'border-warning/30 bg-warning/[0.06]'
                      : 'border-line bg-elevate/[0.02]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-[10px] font-medium text-foreground/85 ring-1 ring-line">
                      {initials(n.author) || (
                        <UserCircle2 className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                          {asText(n.author, '—')}
                          {n.internal && (
                            <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                              <StickyNote className="h-3 w-3" />
                              interna
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-foreground/40">
                          {timeAgo(n.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/85">
                        {asText(n.text)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Timeline de atividades
          </span>
        }
      >
        {(client.logs ?? []).length === 0 ? (
          <p className="text-xs text-foreground/40">Sem atividade ainda.</p>
        ) : (
          <ol className="space-y-2.5">
            {(client.logs ?? []).map((log) => (
              <li key={log.id} className="flex items-start gap-3">
                <span className="mt-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-elevate/[0.04] text-foreground/55 ring-1 ring-line">
                  {iconForAction(log.action)}
                </span>
                <div className="min-w-0 flex-1 rounded-md border border-line bg-elevate/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground/90">
                      {asText(log.action)}
                    </span>
                    <span className="text-[10px] text-foreground/40">
                      {timeAgo(log.createdAt)}
                    </span>
                  </div>
                  {log.detail && (
                    <p className="mt-0.5 text-xs text-foreground/55">
                      {asText(log.detail)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}

function iconForAction(action: string): React.ReactNode {
  const a = action.toLowerCase()
  if (a.includes('contrato')) return <FileText className="h-3 w-3" />
  if (a.includes('briefing'))
    return <MessageSquare className="h-3 w-3" />
  if (a.includes('cobrança') || a.includes('pagamento') || a.includes('asaas'))
    return <ArrowRight className="h-3 w-3" />
  if (a.includes('checklist') || a.includes('entrega'))
    return <ListChecks className="h-3 w-3" />
  if (a.includes('follow-up') || a.includes('mensagem'))
    return <Send className="h-3 w-3" />
  if (a.includes('etapa')) return <ArrowRight className="h-3 w-3" />
  if (a.includes('nota')) return <StickyNote className="h-3 w-3" />
  return <Check className="h-3 w-3" />
}

function InlineField({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {editing ? (
        <div className="mt-1">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(value)
                setEditing(false)
              }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            'group mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors',
            'hover:border-line hover:bg-elevate/[0.02]',
          )}
        >
          <span className={value ? 'text-foreground/90' : 'text-foreground/40'}>
            {value || placeholder || '—'}
          </span>
          <Pencil className="h-3 w-3 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </div>
  )
}

function ImplementationToggle({
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  label: string
  description: string
  icon: React.ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        checked
          ? 'border-accent/40 bg-accent/[0.06]'
          : 'border-line bg-elevate/[0.02] hover:bg-elevate/[0.04]',
      )}
    >
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 transition-colors',
          checked
            ? 'bg-accent/15 text-accent ring-accent/30'
            : 'bg-elevate/[0.04] text-foreground/55 ring-line',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {checked && <Check className="h-3.5 w-3.5 text-accent" />}
        </div>
        <p className="mt-0.5 text-[11px] text-foreground/55">{description}</p>
      </div>
    </button>
  )
}
