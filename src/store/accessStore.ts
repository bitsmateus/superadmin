import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DEFAULT_SYSTEM_URL = 'https://chat.nxsystems.com.br/login'

interface AccessState {
  masterkey: string | null
  systemUrl: string
  setMasterkey: (key: string | null) => void
  clearMasterkey: () => void
  setSystemUrl: (url: string) => void
  resetSystemUrl: () => void
}

// Persistido sob a chave única `tenanthub-access` (versionada). Antes a
// store fazia leituras/escritas manuais em localStorage usando duas chaves
// separadas (`tenanthub_masterkey` / `tenanthub_system_url`) — a migração
// abaixo cobre quem tinha a versão antiga e move pro novo formato.
export const useAccessStore = create<AccessState>()(
  persist(
    (set) => ({
      masterkey: null,
      systemUrl: DEFAULT_SYSTEM_URL,
      setMasterkey: (key) => {
        const v = key && key.trim() ? key.trim() : null
        set({ masterkey: v })
      },
      clearMasterkey: () => set({ masterkey: null }),
      setSystemUrl: (url) => {
        const normalized = url.trim() || DEFAULT_SYSTEM_URL
        set({ systemUrl: normalized })
      },
      resetSystemUrl: () => set({ systemUrl: DEFAULT_SYSTEM_URL }),
    }),
    {
      name: 'tenanthub-access',
      version: 1,
      migrate: (persisted) => {
        // Quando persisted vem null ou shape antigo, tenta ler do LS legado.
        const fallback = readLegacyLs()
        const p = (persisted as Partial<AccessState> | null) ?? {}
        return {
          masterkey: p.masterkey ?? fallback.masterkey,
          systemUrl: p.systemUrl ?? fallback.systemUrl ?? DEFAULT_SYSTEM_URL,
        } as AccessState
      },
    },
  ),
)

function readLegacyLs(): { masterkey: string | null; systemUrl: string | null } {
  if (typeof window === 'undefined') return { masterkey: null, systemUrl: null }
  try {
    return {
      masterkey: window.localStorage.getItem('tenanthub_masterkey'),
      systemUrl: window.localStorage.getItem('tenanthub_system_url'),
    }
  } catch {
    return { masterkey: null, systemUrl: null }
  }
}
