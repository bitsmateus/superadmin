import type { Client, FollowUp } from '@/types/client'

export interface FollowUpTemplates {
  day3: string
  day7: string
  day15: string
  day30: string
}

export const DEFAULT_FOLLOWUP_TEMPLATES: FollowUpTemplates = {
  day3: `Olá {nome}! Tudo certo com o sistema? Já passaram 3 dias desde a entrega. Se tiver qualquer dúvida, estou à disposição!`,
  day7: `Oi {nome}, passando para ver como está sendo a experiência com a plataforma. Alguma dificuldade ou sugestão até agora?`,
  day15: `{nome}, já são 15 dias desde que vocês começaram a usar o sistema! Como está o time se adaptando? Precisam de algum ajuste?`,
  day30: `{nome}, completamos 1 mês juntos! Quero entender como foi essa primeira experiência e se há algo que possamos melhorar para vocês.`,
}

export const FOLLOWUP_DAYS = [3, 7, 15, 30] as const

export type FollowUpDay = (typeof FOLLOWUP_DAYS)[number]

export function renderTemplate(
  template: string,
  client: Pick<Client, 'name' | 'company'>,
  dayNumber: number,
): string {
  return template
    .split('{nome}')
    .join(client.name || '')
    .split('{empresa}')
    .join(client.company || '')
    .split('{dia}')
    .join(String(dayNumber))
}

export function buildFollowUps(
  client: Pick<Client, 'name' | 'company'>,
  deliveryDate: Date,
  templates: FollowUpTemplates = DEFAULT_FOLLOWUP_TEMPLATES,
): FollowUp[] {
  return FOLLOWUP_DAYS.map((day) => {
    const scheduled = new Date(deliveryDate)
    scheduled.setDate(scheduled.getDate() + day)
    const key = `day${day}` as keyof FollowUpTemplates
    const tmpl = templates[key] ?? ''
    return {
      id: `fu_${day}_${scheduled.toISOString()}`,
      scheduledFor: scheduled.toISOString(),
      dayNumber: day,
      message: renderTemplate(tmpl, client, day),
    }
  })
}
