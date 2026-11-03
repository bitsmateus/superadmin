/**
 * Telas capturadas ficam no IndexedDB da extensão até o envio: um print 2x tem 1–3 MB e o
 * chrome.storage.session aguenta só 10 MB. Popup e service worker leem o mesmo banco (mesma origem).
 */
import type { TelaCapturada } from './tipos'

const NOME = 'nx-demo-capture'
const TELAS = 'telas'
const EXTRAS = 'extras'

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NOME, 1)
    r.onupgradeneeded = () => {
      r.result.createObjectStore(TELAS, { keyPath: 'id' })
      r.result.createObjectStore(EXTRAS)
    }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function transacao<T>(loja: string, modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await abrir()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(loja, modo)
    const req = fn(tx.objectStore(loja))
    tx.oncomplete = () => { resolve(req ? req.result : undefined); db.close() }
    tx.onerror = () => { reject(tx.error); db.close() }
  })
}

export const guardarTela = (t: TelaCapturada) => transacao(TELAS, 'readwrite', (s) => { s.put(t) })
export const apagarTela = (id: string) => transacao(TELAS, 'readwrite', (s) => { s.delete(id) })
export async function listarTelas(): Promise<TelaCapturada[]> {
  const todas = (await transacao<TelaCapturada[]>(TELAS, 'readonly', (s) => s.getAll())) ?? []
  return todas.sort((a, b) => a.ordem - b.ordem)
}
export const guardarExtra = (chave: string, valor: unknown) => transacao(EXTRAS, 'readwrite', (s) => { s.put(valor, chave) })
export const lerExtra = <T>(chave: string) => transacao<T>(EXTRAS, 'readonly', (s) => s.get(chave))
export async function limparTudo() {
  await transacao(TELAS, 'readwrite', (s) => { s.clear() })
  await transacao(EXTRAS, 'readwrite', (s) => { s.clear() })
}
