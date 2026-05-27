import * as React from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Globe,
  KeyRound,
  ListChecks,
  Mail,
  MessageSquare,
  Monitor,
  Pencil,
  Phone,
  PlusCircle,
  Send,
  Server as ServerIcon,
  Smartphone,
  Sparkles,
  StickyNote,
  Trash2,
  UserCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Section, FieldLabel } from '../ClientDrawer'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useCurrentUser } from '@/hooks/useClients'
import { db } from '@/services/db'
import { useServerById } from '@/store/authStore'
import { copyToClipboard } from '@/lib/clipboard'
import { asText, cn, formatDate, initials } from '@/lib/utils'
import { timeAgo } from '@/lib/time'
import type { Client, ClientAccess } from '@/types/client'

// Default accesses always shown when the client has none
const DEFAULT_ACCESS_NAMES = ['Facebook', 'Instagram']

function getAccesses(client: Client): ClientAccess[] {
  if (client.accesses && client.accesses.length > 0) return client.accesses
  return DEFAULT_ACCESS_NAMES.map((name, i) => ({
    id: `default-${i}`,
    name,
  }))
}

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

  const togglePlatform = (flag: 'platformApp' | 'platformWeb' | 'platformChat') => {
    db.updateClient(client.id, { [flag]: !client[flag] })
  }

  return (
    <div className="space-y-5">
      {/* Dados do cliente */}
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

          {/* E-mail de suporte */}
          <div className="sm:col-span-2">
            <FieldLabel>E-mail de suporte</FieldLabel>
            <div className="mt-1 flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
              <span className="text-sm text-foreground/85">
                {client.supportEmail ?? (
                  <span className="text-foreground/35">Sem informação</span>
                )}
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

          {/* Plataformas */}
          <div className="sm:col-span-2">
            <FieldLabel>Criado em</FieldLabel>
            <div className="mt-1.5 flex items-center gap-2">
              {([
                { flag: 'platformApp', label: 'App', icon: <Smartphone className="h-3 w-3" /> },
                { flag: 'platformWeb', label: 'Web', icon: <Monitor className="h-3 w-3" /> },
                { flag: 'platformChat', label: 'Chat', icon: <MessageSquare className="h-3 w-3" /> },
              ] as const).map(({ flag, label, icon }) => (
                <button
                  key={flag}
                  type="button"
                  onClick={() => togglePlatform(flag)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all',
                    client[flag]
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-line bg-surface text-foreground/40 hover:border-accent/20 hover:text-foreground/65',
                  )}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <FieldLabel>Entrada</FieldLabel>
            <p className="mt-1 text-sm text-foreground/85">
              {formatDate(client.createdAt)}{' '}
              <span className="text-foreground/40">({timeAgo(client.createdAt)})</span>
            </p>
          </div>
        </div>
      </Section>

      {/* Acessos */}
      <AccessesSection client={client} />

      {/* Tenant vinculado */}
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
              <span className="rounded-md bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-accent/20">
                {tenantServer.name}
              </span>
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
          </div>
        </Section>
      )}

      {/* Notas */}
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
              className="min-h-[80px] flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15"
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

      {/* Timeline */}
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

// ─── Acessos ────────────────────────────────────────────────────────────────

function AccessesSection({ client }: { client: Client }) {
  const [addOpen, setAddOpen] = React.useState(false)
  const accesses = getAccesses(client)

  const saveAccess = (entry: Omit<ClientAccess, 'id'>) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    const next = [...current, { ...entry, id: db.newId() }]
    db.updateClient(client.id, { accesses: next })
  }

  const removeAccess = (id: string) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    db.updateClient(client.id, { accesses: current.filter((a) => a.id !== id) })
  }

  const updateAccess = (id: string, patch: Partial<ClientAccess>) => {
    const current = client.accesses && client.accesses.length > 0
      ? client.accesses
      : DEFAULT_ACCESS_NAMES.map((name, i) => ({ id: `default-${i}`, name }))
    db.updateClient(client.id, {
      accesses: current.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })
  }

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5 text-accent" />
          Acessos
        </span>
      }
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setAddOpen(true)}
          leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
        >
          Adicionar acesso
        </Button>
      }
    >
      <ul className="space-y-2">
        {accesses.map((a) => (
          <AccessRow
            key={a.id}
            access={a}
            onRemove={() => removeAccess(a.id)}
            onUpdate={(patch) => updateAccess(a.id, patch)}
          />
        ))}
      </ul>

      <AddAccessModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={saveAccess}
      />
    </Section>
  )
}

function AccessRow({
  access,
  onRemove,
  onUpdate,
}: {
  access: ClientAccess
  onRemove: () => void
  onUpdate: (patch: Partial<ClientAccess>) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [showPass, setShowPass] = React.useState(false)
  const hasDetails = Boolean(access.emailOrPhone || access.password || access.url)

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-elevate/[0.03]"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/40" />
        )}
        <span className="flex-1 text-sm font-medium text-foreground">{access.name}</span>
        {!hasDetails && (
          <span className="text-[11px] text-foreground/35">Sem informação</span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="rounded-md p-1 text-foreground/30 opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 transition-opacity"
          aria-label="Remover acesso"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3 space-y-2.5">
          <AccessDetailRow
            icon={<Mail className="h-3.5 w-3.5" />}
            label="E-mail / Telefone"
            value={access.emailOrPhone}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ emailOrPhone: v })}
            copyable
          />
          <AccessDetailRow
            icon={<KeyRound className="h-3.5 w-3.5" />}
            label="Senha"
            value={access.password}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ password: v })}
            secret
            showSecret={showPass}
            onToggleSecret={() => setShowPass((s) => !s)}
            copyable
          />
          <AccessDetailRow
            icon={<Globe className="h-3.5 w-3.5" />}
            label="Link"
            value={access.url}
            placeholder="Sem informação"
            onSave={(v) => onUpdate({ url: v })}
            href={access.url}
          />
        </div>
      )}
    </li>
  )
}

function AccessDetailRow({
  icon,
  label,
  value,
  placeholder,
  onSave,
  copyable,
  secret,
  showSecret,
  onToggleSecret,
  href,
}: {
  icon: React.ReactNode
  label: string
  value?: string
  placeholder?: string
  onSave: (v: string) => void
  copyable?: boolean
  secret?: boolean
  showSecret?: boolean
  onToggleSecret?: () => void
  href?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value ?? '')

  React.useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [value, editing])

  const commit = () => {
    onSave(draft.trim())
    setEditing(false)
  }

  const display = secret && !showSecret && value
    ? '••••••••'
    : (value || <span className="text-foreground/35">{placeholder}</span>)

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-foreground/40">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-foreground/35 mb-0.5">{label}</div>
        {editing ? (
          <input
            autoFocus
            type={secret && !showSecret ? 'password' : 'text'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
            }}
            className="w-full rounded-md border border-accent/40 bg-surface px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex items-center gap-1 text-left text-sm text-foreground/85 hover:text-foreground transition-colors"
          >
            {display}
            <Pencil className="h-3 w-3 shrink-0 text-foreground/25 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {secret && value && onToggleSecret && (
          <button
            type="button"
            onClick={onToggleSecret}
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label={showSecret ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        {copyable && value && (
          <button
            type="button"
            onClick={async () => {
              const ok = await copyToClipboard(value)
              if (ok) toast.success(`${label} copiado`)
            }}
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label={`Copiar ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1 text-foreground/35 hover:bg-elevate/[0.06] hover:text-foreground"
            aria-label="Abrir link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  )
}

function AddAccessModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (entry: Omit<ClientAccess, 'id'>) => void
}) {
  const [name, setName] = React.useState('')
  const [emailOrPhone, setEmailOrPhone] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [url, setUrl] = React.useState('')

  React.useEffect(() => {
    if (!open) return
    setName('')
    setEmailOrPhone('')
    setPassword('')
    setUrl('')
  }, [open])

  const submit = () => {
    if (!name.trim()) {
      toast.error('Informe o nome do acesso.')
      return
    }
    onSave({
      name: name.trim(),
      emailOrPhone: emailOrPhone.trim() || undefined,
      password: password.trim() || undefined,
      url: url.trim() || undefined,
    })
    onClose()
    toast.success('Acesso adicionado')
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar acesso"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit}>Adicionar</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Nome *"
          placeholder="Ex: Instagram, Painel Admin…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftIcon={<KeyRound className="h-4 w-4" />}
        />
        <Input
          label="E-mail / Telefone"
          placeholder="usuario@email.com ou (11) 99999-9999"
          value={emailOrPhone}
          onChange={(e) => setEmailOrPhone(e.target.value)}
          leftIcon={<Phone className="h-4 w-4" />}
        />
        <Input
          label="Senha"
          type="text"
          placeholder="Senha de acesso"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<KeyRound className="h-4 w-4" />}
        />
        <Input
          label="Link"
          placeholder="https://..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          leftIcon={<Globe className="h-4 w-4" />}
        />
      </div>
    </Modal>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function iconForAction(action: string): React.ReactNode {
  const a = action.toLowerCase()
  if (a.includes('contrato')) return <FileText className="h-3 w-3" />
  if (a.includes('briefing')) return <MessageSquare className="h-3 w-3" />
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
