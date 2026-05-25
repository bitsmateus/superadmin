import * as React from 'react'
import {
  CheckCircle2,
  Copy,
  Edit3,
  MessageSquare,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useMessageTemplates } from '@/hooks/useTickets'
import { ticketsService } from '@/services/tickets'
import { copyToClipboard } from '@/lib/clipboard'
import type { MessageTemplate } from '@/types/ticket'

const SCOPE_LABEL: Record<MessageTemplate['scope'], string> = {
  all: 'Todos',
  ticket: 'Ticket',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
}

export function TemplatesPage() {
  const templates = useMessageTemplates()
  const [search, setSearch] = React.useState('')
  const [scopeFilter, setScopeFilter] = React.useState<MessageTemplate['scope'] | 'all'>('all')
  const [editing, setEditing] = React.useState<MessageTemplate | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<MessageTemplate | null>(null)

  const filtered = React.useMemo(() => {
    return templates.filter((t) => {
      if (scopeFilter !== 'all' && t.scope !== scopeFilter && t.scope !== 'all') return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (t.name + ' ' + t.content + ' ' + (t.category ?? '') + ' ' + (t.shortcut ?? '')).toLowerCase().includes(q)
    })
  }, [templates, search, scopeFilter])

  const copyContent = async (content: string) => {
    const ok = await copyToClipboard(content)
    if (ok) toast.success('Template copiado')
    else toast.error('Falha ao copiar')
  }

  return (
    <>
      <TopBar
        title="Templates de mensagem"
        subtitle={`${templates.length} respostas prontas`}
        rightSlot={
          <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>
            Novo template
          </Button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nome, conteúdo, atalho…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            containerClassName="max-w-sm"
          />
          <Select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
            options={[
              { value: 'all', label: 'Todos escopos' },
              { value: 'ticket', label: 'Ticket' },
              { value: 'email', label: 'E-mail' },
              { value: 'whatsapp', label: 'WhatsApp' },
            ]}
            className="max-w-[180px]"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="h-5 w-5" />}
            title={templates.length === 0 ? 'Sem templates ainda' : 'Nada encontrado'}
            description={
              templates.length === 0
                ? 'Crie respostas prontas pra responder mais rápido. Use variáveis tipo {nome}, {empresa}.'
                : 'Tente outra busca.'
            }
            action={
              <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>
                Criar template
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filtered.map((t) => (
              <li
                key={t.id}
                className="group rounded-xl border border-line bg-card p-4 transition-colors hover:border-accent/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-foreground truncate">{t.name}</h3>
                      {t.shortcut && (
                        <code className="rounded bg-elevate/[0.06] px-1.5 py-0.5 text-[10px] text-accent">
                          {t.shortcut}
                        </code>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge tone="info">{SCOPE_LABEL[t.scope]}</Badge>
                      {t.category && <Badge tone="neutral">{t.category}</Badge>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyContent(t.content)}
                      title="Copiar"
                      className="rounded-md p-1.5 text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setEditing(t)}
                      title="Editar"
                      className="rounded-md p-1.5 text-foreground/55 hover:bg-elevate/[0.06] hover:text-foreground"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleting(t)}
                      title="Remover"
                      className="rounded-md p-1.5 text-foreground/40 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-elevate/[0.02] p-3 text-xs text-foreground/75 leading-relaxed">
                  {t.content}
                </pre>
              </li>
            ))}
          </ul>
        )}

        <p className="rounded-lg border border-line bg-elevate/[0.02] px-4 py-3 text-xs text-foreground/55">
          <strong className="text-foreground/80">Variáveis suportadas:</strong>{' '}
          <code className="text-accent">{'{nome}'}</code>{' '}
          <code className="text-accent">{'{empresa}'}</code>{' '}
          <code className="text-accent">{'{ticket_numero}'}</code>{' '}
          <code className="text-accent">{'{assunto}'}</code> — substituídas
          automaticamente quando o template é colado dentro de um ticket.
        </p>
      </div>

      <TemplateEditor
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        initial={editing}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remover template"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (deleting) {
                  await ticketsService.deleteTemplate(deleting.id)
                  setDeleting(null)
                  toast.success('Template removido')
                }
              }}
            >
              Remover
            </Button>
          </>
        }
      >
        <p className="text-sm text-foreground/75">
          Remover <strong className="text-foreground">{deleting?.name}</strong>? Esta
          ação não pode ser desfeita.
        </p>
      </Modal>
    </>
  )
}

function TemplateEditor({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  initial: MessageTemplate | null
}) {
  const [name, setName] = React.useState('')
  const [content, setContent] = React.useState('')
  const [scope, setScope] = React.useState<MessageTemplate['scope']>('all')
  const [category, setCategory] = React.useState('')
  const [shortcut, setShortcut] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setContent(initial.content)
      setScope(initial.scope)
      setCategory(initial.category ?? '')
      setShortcut(initial.shortcut ?? '')
    } else {
      setName('')
      setContent('')
      setScope('all')
      setCategory('')
      setShortcut('')
    }
  }, [open, initial])

  const submit = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error('Preencha nome e conteúdo.')
      return
    }
    setSaving(true)
    await ticketsService.upsertTemplate({
      id: initial?.id,
      name: name.trim(),
      content,
      scope,
      category: category.trim() || undefined,
      shortcut: shortcut.trim() || undefined,
    })
    setSaving(false)
    toast.success('Template salvo')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar template' : 'Novo template'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Saudação inicial"
          />
          <Input
            label="Atalho (opcional)"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder="/oi"
            hint="Digite o atalho no campo de resposta pra inserir."
          />
          <Select
            label="Escopo"
            value={scope}
            onChange={(e) => setScope(e.target.value as MessageTemplate['scope'])}
            options={[
              { value: 'all', label: 'Todos canais' },
              { value: 'ticket', label: 'Ticket' },
              { value: 'email', label: 'E-mail' },
              { value: 'whatsapp', label: 'WhatsApp' },
            ]}
          />
          <Input
            label="Categoria (opcional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Saudação, Cobrança, Fechamento…"
          />
        </div>
        <Textarea
          label="Conteúdo"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder={
            'Olá {nome}! Aqui é o suporte da NX, recebi seu ticket #{ticket_numero} sobre {assunto}. Já estou olhando, qualquer dúvida me chama por aqui mesmo.'
          }
        />
        <p className="text-[11px] text-foreground/45">
          Variáveis:{' '}
          <code className="text-accent">{'{nome}'}</code>{' '}
          <code className="text-accent">{'{empresa}'}</code>{' '}
          <code className="text-accent">{'{ticket_numero}'}</code>{' '}
          <code className="text-accent">{'{assunto}'}</code>
        </p>

        {content && (
          <div className="rounded-lg border border-line bg-elevate/[0.02] p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-foreground/45">
              Preview (variáveis fictícias)
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground/80">
              {previewWithFakes(content)}
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

function previewWithFakes(content: string): string {
  return content
    .replace(/\{nome\}/g, 'João')
    .replace(/\{empresa\}/g, 'Acme Ltda')
    .replace(/\{ticket_numero\}/g, '42')
    .replace(/\{assunto\}/g, 'WhatsApp não conecta')
}

/** Helper export pra ser usado no FinanceTab / TicketDetail. */
export function applyTemplate(
  content: string,
  vars: { nome?: string; empresa?: string; ticket_numero?: string | number; assunto?: string },
): string {
  return content
    .replace(/\{nome\}/g, vars.nome ?? '')
    .replace(/\{empresa\}/g, vars.empresa ?? '')
    .replace(/\{ticket_numero\}/g, String(vars.ticket_numero ?? ''))
    .replace(/\{assunto\}/g, vars.assunto ?? '')
}
