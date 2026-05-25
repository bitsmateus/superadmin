import * as React from 'react'
import { Navigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  Folder,
  HelpCircle,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/TopBar'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs } from '@/components/ui/Tabs'
import { useTicketCategories, useKbArticles } from '@/hooks/useTickets'
import { ticketsService } from '@/services/tickets'
import { useAuth } from '@/hooks/useAuth'
import { canManageUsers } from '@/services/supabase'
import { supabase } from '@/services/supabase'
import { cn, slugify } from '@/lib/utils'
import type {
  KbArticle,
  TicketCategory,
  TicketPriority,
  TicketTriageStep,
  TriageOption,
} from '@/types/ticket'

export function KnowledgeBasePage() {
  const { profile, loading } = useAuth()
  const [tab, setTab] = React.useState<'articles' | 'categories' | 'triage'>('articles')

  if (loading) return null
  if (!canManageUsers(profile?.role)) return <Navigate to="/" replace />

  return (
    <>
      <TopBar
        title="Central de conhecimento"
        subtitle="Categorias, artigos, vídeos e triagem do portal de suporte"
      />

      <div className="px-8 py-6 space-y-5">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          items={[
            {
              value: 'articles',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" />
                  Artigos
                </span>
              ),
            },
            {
              value: 'categories',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Folder className="h-3.5 w-3.5" />
                  Categorias
                </span>
              ),
            },
            {
              value: 'triage',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Triagem
                </span>
              ),
            },
          ]}
        />

        {tab === 'articles' && <ArticlesTab />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'triage' && <TriageEditorTab />}
      </div>
    </>
  )
}

// =====================================================================
// Aba — Artigos
// =====================================================================

function ArticlesTab() {
  const articles = useKbArticles()
  const categories = useTicketCategories()
  const [search, setSearch] = React.useState('')
  const [editing, setEditing] = React.useState<KbArticle | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<KbArticle | null>(null)

  const filtered = React.useMemo(() => {
    if (!search.trim()) return articles
    const q = search.toLowerCase()
    return articles.filter((a) =>
      (a.title + ' ' + (a.summary ?? '') + ' ' + (a.bodyMarkdown ?? '') + ' ' + a.tags.join(' '))
        .toLowerCase()
        .includes(q),
    )
  }, [articles, search])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar artigos…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          containerClassName="max-w-sm"
        />
        <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>
          Novo artigo
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-5 w-5" />}
          title={articles.length === 0 ? 'Nenhum artigo ainda' : 'Nada encontrado'}
          description={
            articles.length === 0
              ? 'Crie artigos com texto + vídeo. O portal /suporte sugere automaticamente conforme a triagem.'
              : 'Tente outra busca.'
          }
          action={
            <Button onClick={() => setCreating(true)} leftIcon={<Plus className="h-4 w-4" />}>
              Criar artigo
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((a) => {
            const cat = categories.find((c) => c.id === a.categoryId)
            return (
              <li
                key={a.id}
                className="group rounded-xl border border-line bg-card p-4 transition-colors hover:border-accent/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-white truncate">{a.title}</h3>
                      {!a.published && <Badge tone="warning">Rascunho</Badge>}
                      {a.videoUrl && (
                        <Badge tone="info">
                          <Video className="h-3 w-3 mr-1" /> Vídeo
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/40">/{a.slug}</div>
                    {cat && (
                      <div className="mt-1">
                        <Badge tone="neutral">{cat.name}</Badge>
                      </div>
                    )}
                    {a.summary && (
                      <p className="mt-2 line-clamp-2 text-xs text-white/65">
                        {a.summary}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/45">
                      {a.viewsCount > 0 && <span>👁 {a.viewsCount}</span>}
                      {a.helpfulCount > 0 && (
                        <span className="text-success">👍 {a.helpfulCount}</span>
                      )}
                      {a.notHelpfulCount > 0 && (
                        <span className="text-danger">👎 {a.notHelpfulCount}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setEditing(a)}
                      title="Editar"
                      className="rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleting(a)}
                      title="Remover"
                      className="rounded-md p-1.5 text-white/40 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ArticleEditor
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        initial={editing}
        categories={categories}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Remover artigo"
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
                  await ticketsService.deleteKbArticle(deleting.id)
                  setDeleting(null)
                  toast.success('Artigo removido')
                }
              }}
            >
              Remover
            </Button>
          </>
        }
      >
        <p className="text-sm text-white/75">
          Remover <strong className="text-white">{deleting?.title}</strong>?
        </p>
      </Modal>
    </>
  )
}

function ArticleEditor({
  open,
  onClose,
  initial,
  categories,
}: {
  open: boolean
  onClose: () => void
  initial: KbArticle | null
  categories: TicketCategory[]
}) {
  const [title, setTitle] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [summary, setSummary] = React.useState('')
  const [body, setBody] = React.useState('')
  const [videoUrl, setVideoUrl] = React.useState('')
  const [categoryId, setCategoryId] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [published, setPublished] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setTitle(initial.title)
      setSlug(initial.slug)
      setSummary(initial.summary ?? '')
      setBody(initial.bodyMarkdown ?? '')
      setVideoUrl(initial.videoUrl ?? '')
      setCategoryId(initial.categoryId ?? '')
      setTags((initial.tags ?? []).join(', '))
      setPublished(initial.published)
    } else {
      setTitle('')
      setSlug('')
      setSummary('')
      setBody('')
      setVideoUrl('')
      setCategoryId(categories[0]?.id ?? '')
      setTags('')
      setPublished(true)
    }
  }, [open, initial, categories])

  // Auto-slug na criação
  React.useEffect(() => {
    if (!initial && title) {
      setSlug(slugify(title))
    }
  }, [title, initial])

  const submit = async () => {
    if (!title.trim() || !slug.trim()) {
      toast.error('Título e slug obrigatórios.')
      return
    }
    setSaving(true)
    await ticketsService.upsertKbArticle({
      id: initial?.id,
      title: title.trim(),
      slug: slug.trim(),
      summary: summary.trim() || undefined,
      bodyMarkdown: body.trim() || undefined,
      videoUrl: videoUrl.trim() || undefined,
      categoryId: categoryId || null,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      published,
    })
    setSaving(false)
    toast.success('Artigo salvo')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar artigo' : 'Novo artigo'}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Como reconectar meu WhatsApp"
          />
          <Input
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="reconectar-whatsapp"
            hint="URL amigável (sem espaços)."
          />
          <Select
            label="Categoria"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            options={[
              { value: '', label: '— sem categoria —' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Input
            label="Tags (separadas por vírgula)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="whatsapp, conexão, qr code"
          />
        </div>

        <Input
          label="URL do vídeo (YouTube/Loom/Vimeo)"
          value={videoUrl}
          onChange={(e) => setVideoUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          leftIcon={<Video className="h-4 w-4" />}
          hint="Embed gerado automaticamente no portal /suporte."
        />

        <Input
          label="Resumo curto"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="O que o artigo resolve em uma frase."
        />

        <Textarea
          label="Conteúdo (markdown ou texto simples)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder={'1. Abra o painel de chat\n2. Vá em Conexões\n3. ...'}
        />

        <label className="flex items-center gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          {published ? (
            <>
              <Eye className="h-4 w-4 text-success" />
              <span>Publicado (visível no portal /suporte)</span>
            </>
          ) : (
            <>
              <EyeOff className="h-4 w-4 text-warning" />
              <span>Rascunho (oculto do portal)</span>
            </>
          )}
        </label>
      </div>
    </Modal>
  )
}

// =====================================================================
// Aba — Categorias
// =====================================================================

function CategoriesTab() {
  const categories = useTicketCategories()
  const [editing, setEditing] = React.useState<TicketCategory | null>(null)
  const [creating, setCreating] = React.useState(false)

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/55">
          Categorias aparecem no portal /suporte e definem SLA padrão dos tickets.
        </p>
        <Button onClick={() => setCreating(true)} size="sm" leftIcon={<Plus className="h-4 w-4" />}>
          Nova categoria
        </Button>
      </div>

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {categories.map((c) => (
          <li
            key={c.id}
            className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1',
                toneClass(c.color),
              )}>
                <HelpCircle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">{c.name}</div>
                <div className="text-[11px] text-white/45">
                  SLA {c.defaultSlaHours}h · {c.defaultPriority}
                </div>
              </div>
            </div>
            <button
              onClick={() => setEditing(c)}
              className="opacity-0 group-hover:opacity-100 rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <CategoryEditor
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        initial={editing}
      />
    </>
  )
}

function CategoryEditor({
  open,
  onClose,
  initial,
}: {
  open: boolean
  onClose: () => void
  initial: TicketCategory | null
}) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [color, setColor] = React.useState('info')
  const [position, setPosition] = React.useState('0')
  const [slaHours, setSlaHours] = React.useState('24')
  const [priority, setPriority] = React.useState<TicketPriority>('normal')
  const [active, setActive] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setName(initial.name)
      setDescription(initial.description ?? '')
      setColor(initial.color)
      setPosition(String(initial.position))
      setSlaHours(String(initial.defaultSlaHours))
      setPriority(initial.defaultPriority)
      setActive(initial.active)
    } else {
      setName('')
      setDescription('')
      setColor('info')
      setPosition('0')
      setSlaHours('24')
      setPriority('normal')
      setActive(true)
    }
  }, [open, initial])

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Informe o nome.')
      return
    }
    setSaving(true)
    await ticketsService.upsertCategory({
      id: initial?.id,
      name: name.trim(),
      description: description.trim() || undefined,
      color,
      position: Number(position) || 0,
      defaultSlaHours: Number(slaHours) || 24,
      defaultPriority: priority,
      active,
    })
    setSaving(false)
    toast.success('Categoria salva')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar categoria' : 'Nova categoria'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Descrição (aparece no portal)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-3">
          <Select
            label="Cor"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            options={[
              { value: 'info', label: 'Azul' },
              { value: 'success', label: 'Verde' },
              { value: 'warning', label: 'Amarelo' },
              { value: 'danger', label: 'Vermelho' },
              { value: 'neutral', label: 'Cinza' },
            ]}
          />
          <Input
            label="Posição"
            type="number"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
          />
          <Input
            label="SLA (horas)"
            type="number"
            value={slaHours}
            onChange={(e) => setSlaHours(e.target.value)}
          />
        </div>
        <Select
          label="Prioridade padrão"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          options={[
            { value: 'low', label: 'Baixa' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'Alta' },
            { value: 'urgent', label: 'Urgente' },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-white/75">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 accent-[#4F8EF7]"
          />
          Ativa (aparece no portal /suporte)
        </label>
      </div>
    </Modal>
  )
}

// =====================================================================
// Aba — Triagem em árvore
// =====================================================================

function TriageEditorTab() {
  const categories = useTicketCategories()
  const articles = useKbArticles()
  const [selectedCat, setSelectedCat] = React.useState<string>('')
  const [steps, setSteps] = React.useState<TicketTriageStep[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState<TicketTriageStep | null>(null)
  const [creating, setCreating] = React.useState<{ parentId: string | null } | null>(null)

  React.useEffect(() => {
    if (!selectedCat && categories[0]) setSelectedCat(categories[0].id)
  }, [categories, selectedCat])

  const reload = React.useCallback(async () => {
    if (!selectedCat) return
    setLoading(true)
    const { data, error } = await supabase
      .from('ticket_triage_steps')
      .select('*')
      .eq('category_id', selectedCat)
    setLoading(false)
    if (error) {
      toast.error('Falha ao carregar: ' + error.message)
      return
    }
    setSteps(
      ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
        id: r.id as string,
        categoryId: r.category_id as string,
        parentId: (r.parent_id as string) ?? null,
        question: r.question as string,
        options: (r.options as TriageOption[]) ?? [],
        position: (r.position as number) ?? 0,
      })),
    )
  }, [selectedCat])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const roots = React.useMemo(
    () => steps.filter((s) => !s.parentId).sort((a, b) => a.position - b.position),
    [steps],
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={selectedCat}
          onChange={(e) => setSelectedCat(e.target.value)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          className="max-w-xs"
        />
        <Button
          onClick={() => setCreating({ parentId: null })}
          size="sm"
          leftIcon={<Plus className="h-4 w-4" />}
          disabled={!selectedCat}
        >
          Pergunta raiz
        </Button>
      </div>

      {loading && <div className="text-sm text-white/55">Carregando…</div>}

      {!loading && steps.length === 0 && (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title="Sem triagem configurada"
          description="Adicione a primeira pergunta. Cada opção pode levar a outra pergunta ou a um artigo de KB."
        />
      )}

      {!loading && roots.length > 0 && (
        <ul className="space-y-2">
          {roots.map((step) => (
            <TriageNode
              key={step.id}
              step={step}
              allSteps={steps}
              depth={0}
              onEdit={(s) => setEditing(s)}
              onAddChild={(parentId) => setCreating({ parentId })}
            />
          ))}
        </ul>
      )}

      <TriageEditor
        open={Boolean(editing) || Boolean(creating)}
        onClose={() => {
          setEditing(null)
          setCreating(null)
        }}
        initial={editing}
        parentId={creating?.parentId ?? null}
        categoryId={selectedCat}
        allSteps={steps}
        articles={articles}
        onSaved={() => {
          setEditing(null)
          setCreating(null)
          void reload()
        }}
      />
    </>
  )
}

function TriageNode({
  step,
  allSteps,
  depth,
  onEdit,
  onAddChild,
}: {
  step: TicketTriageStep
  allSteps: TicketTriageStep[]
  depth: number
  onEdit: (s: TicketTriageStep) => void
  onAddChild: (parentId: string) => void
}) {
  const [expanded, setExpanded] = React.useState(true)
  const children = allSteps
    .filter((s) => s.parentId === step.id)
    .sort((a, b) => a.position - b.position)

  return (
    <li
      className="rounded-xl border border-line bg-card p-3"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex items-start gap-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-0.5 text-white/40 hover:text-white"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-white font-medium">{step.question}</div>
          <ul className="mt-2 space-y-1">
            {step.options.map((opt, i) => (
              <li
                key={i}
                className="flex items-center gap-1.5 text-xs text-white/65"
              >
                <span className="text-white/40">→</span>
                <span>{opt.label}</span>
                {opt.kbArticleId && (
                  <Badge tone="success">KB</Badge>
                )}
                {opt.nextStepId && (
                  <Badge tone="info">→ sub-pergunta</Badge>
                )}
                {!opt.kbArticleId && !opt.nextStepId && (
                  <Badge tone="warning">→ abrir ticket</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => onAddChild(step.id)}
            title="Adicionar sub-pergunta"
            className="rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onEdit(step)}
            title="Editar"
            className="rounded-md p-1.5 text-white/55 hover:bg-white/[0.06] hover:text-white"
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {expanded && children.length > 0 && (
        <ul className="mt-2 space-y-2">
          {children.map((c) => (
            <TriageNode
              key={c.id}
              step={c}
              allSteps={allSteps}
              depth={depth + 1}
              onEdit={onEdit}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TriageEditor({
  open,
  onClose,
  initial,
  parentId,
  categoryId,
  allSteps,
  articles,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  initial: TicketTriageStep | null
  parentId: string | null
  categoryId: string
  allSteps: TicketTriageStep[]
  articles: KbArticle[]
  onSaved: () => void
}) {
  const [question, setQuestion] = React.useState('')
  const [options, setOptions] = React.useState<TriageOption[]>([])
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setQuestion(initial.question)
      setOptions(initial.options.length > 0 ? initial.options : [{ label: '' }])
    } else {
      setQuestion('')
      setOptions([{ label: '' }])
    }
  }, [open, initial])

  const otherSteps = allSteps.filter((s) => s.id !== initial?.id)
  const categoryArticles = articles.filter((a) => a.categoryId === categoryId)

  const updateOption = (i: number, patch: Partial<TriageOption>) => {
    setOptions((arr) => arr.map((o, idx) => (idx === i ? { ...o, ...patch } : o)))
  }

  const addOption = () => setOptions((arr) => [...arr, { label: '' }])
  const removeOption = (i: number) => setOptions((arr) => arr.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!question.trim()) {
      toast.error('Informe a pergunta.')
      return
    }
    const cleanOptions = options
      .filter((o) => o.label.trim())
      .map((o) => ({
        label: o.label.trim(),
        nextStepId: o.nextStepId || null,
        kbArticleId: o.kbArticleId || null,
      }))
    if (cleanOptions.length === 0) {
      toast.error('Adicione pelo menos uma opção.')
      return
    }
    setSaving(true)
    const row = {
      category_id: categoryId,
      parent_id: parentId ?? initial?.parentId ?? null,
      question: question.trim(),
      options: cleanOptions,
    }
    if (initial) {
      const { error } = await supabase.from('ticket_triage_steps').update(row).eq('id', initial.id)
      if (error) toast.error('Falha: ' + error.message)
      else toast.success('Pergunta atualizada')
    } else {
      const { error } = await supabase.from('ticket_triage_steps').insert(row)
      if (error) toast.error('Falha: ' + error.message)
      else toast.success('Pergunta criada')
    }
    setSaving(false)
    onSaved()
  }

  const remove = async () => {
    if (!initial) return
    setDeleting(true)
    const { error } = await supabase
      .from('ticket_triage_steps')
      .delete()
      .eq('id', initial.id)
    setDeleting(false)
    if (error) toast.error('Falha: ' + error.message)
    else {
      toast.success('Pergunta removida')
      onSaved()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar pergunta' : 'Nova pergunta'}
      size="lg"
      footer={
        <>
          {initial && (
            <Button variant="danger" onClick={remove} loading={deleting} className="mr-auto">
              Remover
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="Pergunta apresentada ao cliente"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="O WhatsApp aparece como desconectado?"
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wider text-white/45">
              Opções de resposta
            </span>
            <Button size="sm" variant="ghost" onClick={addOption} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Adicionar
            </Button>
          </div>
          <ul className="space-y-2">
            {options.map((opt, i) => (
              <li key={i} className="rounded-lg border border-line bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Rótulo (Sim / Não / Não sei)"
                    value={opt.label}
                    onChange={(e) => updateOption(i, { label: e.target.value })}
                  />
                  <button
                    onClick={() => removeOption(i)}
                    className="rounded-md p-2 text-white/40 hover:bg-danger/10 hover:text-danger"
                    title="Remover opção"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    value={opt.kbArticleId ?? ''}
                    onChange={(e) =>
                      updateOption(i, {
                        kbArticleId: e.target.value || undefined,
                        nextStepId: e.target.value ? undefined : opt.nextStepId,
                      })
                    }
                    options={[
                      { value: '', label: '— sem KB —' },
                      ...categoryArticles.map((a) => ({ value: a.id, label: a.title })),
                    ]}
                  />
                  <Select
                    value={opt.nextStepId ?? ''}
                    onChange={(e) =>
                      updateOption(i, {
                        nextStepId: e.target.value || undefined,
                        kbArticleId: e.target.value ? undefined : opt.kbArticleId,
                      })
                    }
                    options={[
                      { value: '', label: '— fim do fluxo —' },
                      ...otherSteps.map((s) => ({
                        value: s.id,
                        label: '→ ' + s.question.slice(0, 50),
                      })),
                    ]}
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-white/40">
                  Se KB selecionado: sugere artigo. Senão, se sub-pergunta: vai
                  pra ela. Se nenhum: vai direto pra abrir ticket.
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  )
}

function toneClass(color: string): string {
  const map: Record<string, string> = {
    info: 'bg-accent/10 text-accent ring-accent/20',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    danger: 'bg-danger/10 text-danger ring-danger/20',
    neutral: 'bg-white/[0.04] text-white/55 ring-white/10',
  }
  return map[color] ?? map.neutral
}
