import { create } from 'zustand'

const MASTERKEY_LS_KEY = 'tenanthub_masterkey'
const SYSTEM_URL_LS_KEY = 'tenanthub_system_url'

export const DEFAULT_SYSTEM_URL = 'https://chat.nxsystems.com.br/login'

function readLs(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLs(key: string, value: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* ignore quota / privacy errors */
  }
}

interface AccessState {
  masterkey: string | null
  systemUrl: string
  setMasterkey: (key: string | null) => void
  clearMasterkey: () => void
  setSystemUrl: (url: string) => void
  resetSystemUrl: () => void
}

export const useAccessStore = create<AccessState>((set) => ({
  masterkey: readLs(MASTERKEY_LS_KEY),
  systemUrl: readLs(SYSTEM_URL_LS_KEY) ?? DEFAULT_SYSTEM_URL,
  setMasterkey: (key) => {
    const v = key && key.trim() ? key.trim() : null
    writeLs(MASTERKEY_LS_KEY, v)
    set({ masterkey: v })
  },
  clearMasterkey: () => {
    writeLs(MASTERKEY_LS_KEY, null)
    set({ masterkey: null })
  },
  setSystemUrl: (url) => {
    const normalized = url.trim() || DEFAULT_SYSTEM_URL
    writeLs(SYSTEM_URL_LS_KEY, normalized)
    set({ systemUrl: normalized })
  },
  resetSystemUrl: () => {
    writeLs(SYSTEM_URL_LS_KEY, null)
    set({ systemUrl: DEFAULT_SYSTEM_URL })
  },
}))
