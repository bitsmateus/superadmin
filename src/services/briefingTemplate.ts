import { toast } from 'sonner'
import { api } from '@/services/api'

export interface BriefingFieldOverride {
  fieldKey: string
  label: string | null
  placeholder: string | null
}

export interface BriefingCustomQuestion {
  id: string
  fieldKey: string
  label: string
  placeholder: string | null
  type: 'text' | 'textarea'
  position: number
}

type OverrideRow = { field_key: string; label: string | null; placeholder: string | null }
type QuestionRow = {
  id: string
  field_key: string
  label: string
  placeholder: string | null
  type: 'text' | 'textarea'
  position: number
}

function rowToOverride(r: OverrideRow): BriefingFieldOverride {
  return { fieldKey: r.field_key, label: r.label, placeholder: r.placeholder }
}
function rowToQuestion(r: QuestionRow): BriefingCustomQuestion {
  return { id: r.id, fieldKey: r.field_key, label: r.label, placeholder: r.placeholder, type: r.type, position: r.position }
}

/** Usado pelo formulário PÚBLICO (sem autenticação) pra aplicar os overrides/perguntas custom. */
export async function fetchPublicBriefingTemplate(): Promise<{
  overrides: BriefingFieldOverride[]
  customQuestions: BriefingCustomQuestion[]
}> {
  const data = await api.get<{ overrides: OverrideRow[]; customQuestions: QuestionRow[] }>(
    '/api/public/briefing-template',
  )
  return {
    overrides: data.overrides.map(rowToOverride),
    customQuestions: data.customQuestions.map(rowToQuestion),
  }
}

/** CRUD admin (autenticado) usado pelo editor de modelo do Briefing. */
export const briefingTemplateAdmin = {
  async listOverrides(): Promise<BriefingFieldOverride[]> {
    const rows = await api.get<OverrideRow[]>('/api/briefing-field-overrides')
    return rows.map(rowToOverride)
  },

  async setOverride(fieldKey: string, label: string, placeholder: string): Promise<void> {
    try {
      await api.put(`/api/briefing-field-overrides/${encodeURIComponent(fieldKey)}`, { label, placeholder })
    } catch (err) {
      toast.error('Falha ao salvar campo: ' + (err as Error).message)
      throw err
    }
  },

  async listCustomQuestions(): Promise<BriefingCustomQuestion[]> {
    const rows = await api.get<QuestionRow[]>('/api/briefing-custom-questions')
    return rows.map(rowToQuestion).sort((a, b) => a.position - b.position)
  },

  async createCustomQuestion(
    label: string,
    placeholder: string,
    type: 'text' | 'textarea',
    position: number,
  ): Promise<BriefingCustomQuestion> {
    const row = await api.post<QuestionRow>('/api/briefing-custom-questions', { label, placeholder, type, position })
    return rowToQuestion(row)
  },

  async updateCustomQuestion(
    id: string,
    patch: Partial<{ label: string; placeholder: string; type: 'text' | 'textarea'; position: number }>,
  ): Promise<void> {
    try {
      await api.patch(`/api/briefing-custom-questions/${id}`, patch)
    } catch (err) {
      toast.error('Falha ao salvar pergunta: ' + (err as Error).message)
      throw err
    }
  },

  async deleteCustomQuestion(id: string): Promise<void> {
    try {
      await api.delete(`/api/briefing-custom-questions/${id}`)
    } catch (err) {
      toast.error('Falha ao remover pergunta: ' + (err as Error).message)
      throw err
    }
  },
}
