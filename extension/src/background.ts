/**
 * Service worker da extensão (§6). Orquestra a captura: injeta o content script na aba, tira o print
 * (captureVisibleTab) a cada pedido, guarda as telas no IndexedDB e, no fim, envia uma por uma para a demo.
 * O estado vai para chrome.storage.session porque o service worker pode dormir no meio da captura.
 */
import { apagarTela, guardarExtra, guardarTela, lerExtra, limparTudo, listarTelas } from './armazem'
import { chamar, lerConta } from './api'
import { LIMITE_TELAS, type DadosDaTela, type Estado, type MsgParaConteudo, type MsgParaSw } from './tipos'

async function estado(): Promise<Estado> {
  const { estado: e } = await chrome.storage.session.get('estado')
  return (e as Estado) ?? { fase: 'parado' }
}
async function salvarEstado(e: Estado) {
  await chrome.storage.session.set({ estado: e })
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Print da aba visível. O Chrome limita a 2 por segundo: se estourar, espera e tenta uma vez de novo. */
async function tirarPrint(windowId: number): Promise<string> {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
  } catch (err) {
    if (String(err).includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
      await esperar(600)
      return chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
    }
    throw err
  }
}

async function registrarTela(dados: DadosDaTela, tab: chrome.tabs.Tab | undefined): Promise<{ total: number; aviso?: string }> {
  const e = await estado()
  if (e.fase !== 'gravando' || !tab || tab.id !== e.tabId) return { total: e.total ?? 0 }
  const total = e.total ?? 0
  if (total >= LIMITE_TELAS) return { total, aviso: `Limite de ${LIMITE_TELAS} telas` }
  const image = await tirarPrint(tab.windowId)
  await guardarTela({ ...dados, id: crypto.randomUUID(), ordem: Date.now(), image })
  await salvarEstado({ ...e, total: total + 1 })
  return { total: total + 1 }
}

async function paraConteudo(tabId: number, msg: MsgParaConteudo) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => undefined)
}

async function iniciar(m: Extract<MsgParaSw, { tipo: 'iniciar' }>) {
  const conta = await lerConta()
  if (!conta) throw new Error('Configure a conta primeiro.')
  const regras = await chamar<{ rules: { find: string; replace: string; isRegex: boolean }[]; auto: { phone: boolean; email: boolean; cpf: boolean; cnpj: boolean; avatars: boolean }; canDisable: boolean }>(conta, '/api/ext/anonymize-rules')
  // Anonimizar só pode ser desligado por administrador (§13); o servidor diz quem pode.
  const anonimizar = m.anonimizar || !regras.canDisable
  await limparTudo()
  await chrome.scripting.executeScript({ target: { tabId: m.tabId }, files: ['content.js'] })
  await salvarEstado({ fase: 'gravando', tabId: m.tabId, demoId: m.demoId, demoNome: m.demoNome, modo: m.modo, anonimizar, total: 0 })
  await paraConteudo(m.tabId, { tipo: 'config', config: { anonimizar, modo: m.modo, regras: regras.rules, auto: regras.auto, total: 0 } })
}

async function finalizar() {
  const e = await estado()
  if (e.fase !== 'gravando' || e.tabId === undefined) return
  // "Finalizar" também captura a tela final (§6.2 passo 6).
  await paraConteudo(e.tabId, { tipo: 'capturarAgora' })
  await esperar(150)
  await paraConteudo(e.tabId, { tipo: 'parar' })
  const atual = await estado()
  await salvarEstado({ ...atual, fase: 'revisando' })
}

async function enviar(removidas: string[]) {
  const conta = await lerConta()
  const e = await estado()
  if (!conta || !e.demoId) throw new Error('Nada para enviar.')
  for (const id of removidas) await apagarTela(id)
  const telas = await listarTelas()
  await salvarEstado({ ...e, fase: 'enviando', envio: { feito: 0, total: telas.length } })
  try {
    let cssAssetId: string | undefined
    const css = await lerExtra<string>('css')
    if (e.modo === 'html' && css) cssAssetId = (await chamar<{ cssAssetId: string }>(conta, '/api/ext/css', { method: 'POST', body: { css } })).cssAssetId
    let editorUrl = ''
    for (const [i, t] of telas.entries()) {
      const r = await chamar<{ editorUrl: string }>(conta, `/api/ext/demos/${e.demoId}/screens`, {
        method: 'POST',
        body: { image: t.image, viewport: t.viewport, url: t.url, title: t.title, click: t.click, html: t.html, cssAssetId },
      })
      editorUrl = r.editorUrl
      await apagarTela(t.id)
      // Cada set no storage também mantém o service worker acordado durante o envio.
      await salvarEstado({ ...e, fase: 'enviando', envio: { feito: i + 1, total: telas.length } })
    }
    await limparTudo()
    await salvarEstado({ fase: 'parado', envio: { feito: telas.length, total: telas.length, editorUrl, concluido: true } })
    // Recarrega a aba capturada para desfazer a anonimização ao vivo (§6.2 passo 8) e abre o editor.
    if (e.tabId !== undefined) chrome.tabs.reload(e.tabId).catch(() => undefined)
    if (editorUrl) chrome.tabs.create({ url: editorUrl })
  } catch (err) {
    const atual = await estado()
    await salvarEstado({ ...atual, fase: 'revisando', envio: { ...(atual.envio ?? { feito: 0, total: telas.length }), erro: (err as Error).message } })
  }
}

chrome.runtime.onMessage.addListener((msg: MsgParaSw, remetente, responder) => {
  const tratar = async () => {
    switch (msg.tipo) {
      case 'iniciar': await iniciar(msg); return { ok: true }
      case 'tela': return registrarTela(msg.dados, remetente.tab)
      case 'css': await guardarExtra('css', msg.css); return { ok: true }
      case 'capturarAgora': {
        const e = await estado()
        if (e.fase === 'gravando' && e.tabId !== undefined) await paraConteudo(e.tabId, { tipo: 'capturarAgora' })
        return { ok: true }
      }
      case 'finalizar': await finalizar(); return { ok: true }
      case 'enviar': void enviar(msg.removidas); return { ok: true }
      case 'descartar': {
        const e = await estado()
        if (e.fase === 'gravando' && e.tabId !== undefined) await paraConteudo(e.tabId, { tipo: 'parar' })
        await limparTudo()
        await salvarEstado({ fase: 'parado' })
        if (e.tabId !== undefined && e.fase !== 'parado') chrome.tabs.reload(e.tabId).catch(() => undefined)
        return { ok: true }
      }
    }
  }
  tratar().then(responder, (err) => responder({ erro: (err as Error).message }))
  return true
})

// Alt+Shift+S: captura a tela atual sem clique (etapa sem destaque, para montar depois).
chrome.commands.onCommand.addListener(async (comando) => {
  if (comando !== 'capturar-tela') return
  const e = await estado()
  if (e.fase === 'gravando' && e.tabId !== undefined) await paraConteudo(e.tabId, { tipo: 'capturarAgora' })
})

// Aba da captura fechada: não tem mais o que gravar.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const e = await estado()
  if (e.fase === 'gravando' && e.tabId === tabId) await salvarEstado({ ...e, fase: 'revisando' })
})

// Navegação de página inteira na aba da captura (não SPA): o content script some junto com a página
// antiga. Reinjeta e reconfigura assim que a nova carregar.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return
  const e = await estado()
  if (e.fase !== 'gravando' || e.tabId !== tabId) return
  const conta = await lerConta()
  if (!conta) return
  try {
    const regras = await chamar<{ rules: { find: string; replace: string; isRegex: boolean }[]; auto: { phone: boolean; email: boolean; cpf: boolean; cnpj: boolean; avatars: boolean } }>(conta, '/api/ext/anonymize-rules')
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    await paraConteudo(tabId, { tipo: 'config', config: { anonimizar: e.anonimizar !== false, modo: e.modo ?? 'imagem', regras: regras.rules, auto: regras.auto, total: e.total ?? 0 } })
  } catch {
    /* página sem permissão (ex.: outro domínio): a captura continua quando voltar */
  }
})
