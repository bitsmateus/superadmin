import * as React from 'react'
import { ticketsService, isTicketsBooted } from '@/services/tickets'
import type {
  KbArticle,
  MessageTemplate,
  NpsResponse,
  Reminder,
  Ticket,
  TicketCategory,
} from '@/types/ticket'

function useSnapshot<T>(getter: () => T): T {
  return React.useSyncExternalStore(
    ticketsService.subscribe,
    getter,
    getter,
  )
}

export function useTicketsBooted(): boolean {
  return useSnapshot(isTicketsBooted)
}

export function useTickets(): Ticket[] {
  return useSnapshot(ticketsService.getTickets)
}

export function useTicket(id: string | undefined): Ticket | undefined {
  const tickets = useTickets()
  return React.useMemo(
    () => (id ? tickets.find((t) => t.id === id) : undefined),
    [tickets, id],
  )
}

export function useTicketCategories(): TicketCategory[] {
  const all = useSnapshot(ticketsService.getCategories)
  return React.useMemo(() => all.filter((c) => c.active), [all])
}

export function useKbArticles(): KbArticle[] {
  const all = useSnapshot(ticketsService.getKbArticles)
  return React.useMemo(() => all.filter((a) => a.published), [all])
}

export function useMessageTemplates(): MessageTemplate[] {
  return useSnapshot(ticketsService.getTemplates)
}

export function useReminders(userId: string | undefined): Reminder[] {
  const all = useSnapshot(ticketsService.getReminders)
  return React.useMemo(
    () => (userId ? all.filter((r) => r.userId === userId) : []),
    [all, userId],
  )
}

export function useOpenReminders(userId: string | undefined): Reminder[] {
  const list = useReminders(userId)
  return React.useMemo(() => list.filter((r) => !r.completedAt), [list])
}

/** Tickets que esperam ação do suporte (novo / em aberto / aguardando). */
export function useActiveTickets(): Ticket[] {
  const tickets = useTickets()
  return React.useMemo(
    () => tickets.filter((t) => t.status === 'new' || t.status === 'open'),
    [tickets],
  )
}

export function useUnreadTicketsCount(): number {
  const tickets = useTickets()
  return React.useMemo(
    () => tickets.filter((t) => t.status === 'new').length,
    [tickets],
  )
}

export function useNpsResponses(): NpsResponse[] {
  return useSnapshot(ticketsService.getNpsResponses)
}

export function useNpsForClient(clientId: string | undefined): NpsResponse[] {
  const all = useNpsResponses()
  return React.useMemo(
    () => (clientId ? all.filter((n) => n.clientId === clientId) : []),
    [all, clientId],
  )
}
