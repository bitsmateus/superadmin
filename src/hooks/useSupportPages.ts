import * as React from 'react'
import { supportPagesService, isSupportPagesBooted } from '@/services/supportPages'
import type { SupportPage } from '@/services/supportPages'

function useSnapshot<T>(getter: () => T): T {
  return React.useSyncExternalStore(
    supportPagesService.subscribe,
    getter,
    getter,
  )
}

export function useSupportPagesBooted(): boolean {
  return useSnapshot(isSupportPagesBooted)
}

/** Itens do menu Suporte não arquivados — Tarefas, Pipeline, Clientes, Canais, Tenants,
 * Configurações, Clientes arquivados, Tickets, Templates. */
export function useSupportPages(): SupportPage[] {
  return useSnapshot(supportPagesService.getAll)
}
