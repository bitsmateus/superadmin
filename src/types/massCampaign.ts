export type MassCampaignStatus = 'draft' | 'running' | 'paused' | 'done'

export interface MassCampaignSummary {
  id: string
  name: string
  template_name: string
  status: MassCampaignStatus
  delay_seconds: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  total: string
  sent: string
  failed: string
  queued: string
}

export interface ApprovedTemplateButton {
  type?: string
  text?: string
}

export interface ApprovedTemplate {
  name: string
  language: string
  bodyText: string
  variableCount: number
  buttons: ApprovedTemplateButton[]
}

export interface VariableMappingEntry {
  position: number
  source: 'column' | 'fixed'
  column?: string
  value?: string
}

export interface MassCampaignRecipient {
  id: string
  phone: string
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  error_message: string | null
  scheduled_for: string | null
  sent_at: string | null
}
