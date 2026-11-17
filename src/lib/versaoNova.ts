/**
 * Quando sai uma versão nova do app, os arquivos das telas ganham nome novo e os antigos somem do servidor. Quem está com o app
 * ABERTO desde antes continua com a lista de arquivos antiga: ao abrir uma tela que ainda não tinha carregado, o navegador pede um
 * arquivo que não existe mais e dá "Failed to fetch dynamically imported module". Não é erro do usuário nem da tela: é só a
 * aba desatualizada. A saída é recarregar uma vez (aí vem a lista nova), sem entrar em loop se o erro for outro.
 */
const PADRAO = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk [\w-]+ failed|Loading CSS chunk/i

export function ehErroDeVersaoNova(erro: unknown): boolean {
  const msg = erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : ''
  return PADRAO.test(msg)
}

const CHAVE = 'nx:recarga-versao-nova'
const JANELA_MS = 30_000

/** Pode recarregar agora? Só uma vez a cada 30s: se logo depois do reload der o mesmo erro, o problema é outro e a tela de erro aparece. */
export function podeRecarregarPorVersaoNova(agora: number, ultima: number | null): boolean {
  return ultima === null || !Number.isFinite(ultima) || agora - ultima > JANELA_MS
}

/** Recarrega a página uma vez por causa de versão nova. Devolve true se mandou recarregar. */
export function recarregarPorVersaoNova(): boolean {
  let ultima: number | null = null
  try {
    const v = window.sessionStorage.getItem(CHAVE)
    ultima = v ? Number(v) : null
  } catch { /* sem storage: segue, o pior caso é recarregar uma vez a mais */ }
  const agora = Date.now()
  if (!podeRecarregarPorVersaoNova(agora, ultima)) return false
  try { window.sessionStorage.setItem(CHAVE, String(agora)) } catch { /* idem */ }
  window.location.reload()
  return true
}
