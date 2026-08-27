import * as React from 'react'
import { Plus, Trash2, Loader2, GripVertical, Search, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tabs } from '@/components/ui/Tabs'
import { briefingTemplateAdmin, type BriefingCustomQuestion, type BriefingFieldOverride } from '@/services/briefingTemplate'
import { BRIEFING_FIELD_LABELS } from '@/constants/briefingFields'

/**
 * Editor do "modelo padrão" do Briefing público: rótulos dos campos já existentes
 * (aba "Campos existentes") + perguntas de texto livre novas (aba "Perguntas novas"),
 * mostradas ao final da seção "Observações" do form público.
 */
export function BriefingTemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = React.useState<'fields' | 'questions'>('fields')

  return (
    <Modal open={open} onClose={onClose} title="Modelo do Briefing" size="lg">
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as 'fields' | 'questions')}
        items={[
          { value: 'fields', label: 'Campos existentes' },
          { value: 'questions', label: 'Perguntas novas' },
        ]}
        className="mb-4 -mt-2"
      />
      {tab === 'fields' ? <FieldOverridesTab open={open} /> : <CustomQuestionsTab open={open} />}
    </Modal>
  )
}

function FieldOverridesTab({ open }: { open: boolean }) {
  const [overrides, setOverrides] = React.useState<BriefingFieldOverride[]>([])
  const [loading, setLoading] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState<Record<string, boolean>>({})

  const load = React.useCallback(() => {
    setLoading(true)
    briefingTemplateAdmin
      .listOverrides()
      .then(setOverrides)
      .catch((err) => toast.error('Falha ao carregar campos: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const overrideByKey = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const o of overrides) if (o.label) map[o.fieldKey] = o.label
    return map
  }, [overrides])

  const filtered = search.trim()
    ? BRIEFING_FIELD_LABELS.filter((l) => l.toLowerCase().includes(search.trim().toLowerCase()))
    : BRIEFING_FIELD_LABELS

  const save = async (originalText: string) => {
    const value = (drafts[originalText] ?? overrideByKey[originalText] ?? '').trim()
    setSaving((s) => ({ ...s, [originalText]: true }))
    try {
      await briefingTemplateAdmin.setOverride(originalText, value, '')
      setOverrides((os) => {
        const idx = os.findIndex((o) => o.fieldKey === originalText)
        const next = { fieldKey: originalText, label: value || null, placeholder: null }
        if (idx === -1) return [...os, next]
        const copy = os.slice(); copy[idx] = next; return copy
      })
      toast.success(value ? 'Rótulo atualizado' : 'Rótulo restaurado ao padrão')
    } catch {
      // erro já mostrado no service
    } finally {
      setSaving((s) => ({ ...s, [originalText]: false }))
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground/60">
        Altere o texto exibido pra qualquer campo do formulário público — o campo original continua
        funcionando igual, só o rótulo muda. Deixe em branco pra voltar ao texto padrão.
      </p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar campo…"
        className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      {loading ? (
        <div className="flex items-center justify-center py-8 text-foreground/40">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {filtered.map((original) => {
            const current = drafts[original] ?? overrideByKey[original] ?? ''
            const hasOverride = Boolean(overrideByKey[original])
            return (
              <div key={original} className="rounded-lg border border-line bg-elevate/[0.02] p-3">
                <p className="mb-1.5 truncate text-xs text-foreground/40" title={original}>
                  Original: {original}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={current}
                    onChange={(e) => setDrafts((d) => ({ ...d, [original]: e.target.value }))}
                    placeholder={original}
                    className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {hasOverride && (
                    <button
                      type="button"
                      onClick={() => { setDrafts((d) => ({ ...d, [original]: '' })); void save(original) }}
                      title="Restaurar padrão"
                      className="shrink-0 rounded-md p-2 text-foreground/30 hover:bg-elevate/[0.05] hover:text-foreground"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => save(original)}
                    disabled={saving[original] || current.trim() === (overrideByKey[original] ?? '')}
                  >
                    Salvar
                  </Button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-foreground/40">
              <Search className="mx-auto mb-1 h-4 w-4" /> Nenhum campo encontrado.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CustomQuestionsTab({ open }: { open: boolean }) {
  const [questions, setQuestions] = React.useState<BriefingCustomQuestion[]>([])
  const [loading, setLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [newLabel, setNewLabel] = React.useState('')
  const [newPlaceholder, setNewPlaceholder] = React.useState('')
  const [newType, setNewType] = React.useState<'text' | 'textarea'>('text')

  const load = React.useCallback(() => {
    setLoading(true)
    briefingTemplateAdmin
      .listCustomQuestions()
      .then(setQuestions)
      .catch((err) => toast.error('Falha ao carregar perguntas: ' + (err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const addQuestion = async () => {
    const label = newLabel.trim()
    if (!label) return
    setCreating(true)
    try {
      const q = await briefingTemplateAdmin.createCustomQuestion(
        label,
        newPlaceholder.trim(),
        newType,
        questions.length,
      )
      setQuestions((qs) => [...qs, q])
      setNewLabel('')
      setNewPlaceholder('')
      setNewType('text')
      toast.success('Pergunta adicionada')
    } catch {
      // erro já mostrado no service
    } finally {
      setCreating(false)
    }
  }

  const removeQuestion = async (id: string) => {
    const prev = questions
    setQuestions((qs) => qs.filter((q) => q.id !== id))
    try {
      await briefingTemplateAdmin.deleteCustomQuestion(id)
    } catch {
      setQuestions(prev)
    }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-foreground/60">
        Adicione perguntas de texto livre que aparecem ao final da seção "Observações" do
        formulário público de Briefing.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-foreground/40">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {questions.length === 0 && (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-foreground/40">
              Nenhuma pergunta adicionada ainda.
            </p>
          )}
          {questions.map((q) => (
            <div
              key={q.id}
              className="flex items-start gap-2 rounded-lg border border-line bg-elevate/[0.02] p-3"
            >
              <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-foreground/20" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{q.label}</p>
                <p className="text-xs text-foreground/40">
                  {q.type === 'textarea' ? 'Texto longo' : 'Texto curto'}
                  {q.placeholder ? ` · placeholder: "${q.placeholder}"` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeQuestion(q.id)}
                className="shrink-0 rounded-md p-1.5 text-foreground/30 hover:bg-danger/10 hover:text-danger"
                aria-label="Remover pergunta"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-lg border border-line p-3">
        <p className="text-xs font-medium uppercase tracking-wider text-foreground/40">
          Nova pergunta
        </p>
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Texto da pergunta"
          className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <input
          value={newPlaceholder}
          onChange={(e) => setNewPlaceholder(e.target.value)}
          placeholder="Placeholder (opcional)"
          className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-sm text-foreground/70">
            <input
              type="radio"
              checked={newType === 'text'}
              onChange={() => setNewType('text')}
            />
            Texto curto
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-foreground/70">
            <input
              type="radio"
              checked={newType === 'textarea'}
              onChange={() => setNewType('textarea')}
            />
            Texto longo
          </label>
          <Button
            size="sm"
            className="ml-auto"
            onClick={addQuestion}
            disabled={creating || !newLabel.trim()}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  )
}
