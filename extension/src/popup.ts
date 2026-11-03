/**
 * Popup da extensão (§6.1, §6.2): aba "Conta" (servidor + token pessoal) e aba "Captura" (demo de destino,
 * anonimizar, modo, iniciar/finalizar, revisão das telas e envio). Sem framework: a extensão tem que ser leve.
 */
import { listarTelas } from './armazem'
import { chamar, lerConta, origemDe, type Conta } from './api'
import type { Estado, Modo, MsgParaSw } from './tipos'

const app = document.getElementById('app')!
let aba: 'captura' | 'conta' = 'captura'
const removidas = new Set<string>()

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const sw = (m: MsgParaSw) => chrome.runtime.sendMessage(m) as Promise<{ ok?: boolean; erro?: string }>

async function estado(): Promise<Estado> {
  const { estado: e } = await chrome.storage.session.get('estado')
  return (e as Estado) ?? { fase: 'parado' }
}

document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    aba = b.dataset.aba as typeof aba
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('ativa', x === b))
    void desenhar()
  }),
)
chrome.storage.onChanged.addListener((_m, area) => { if (area === 'session' && aba === 'captura') void desenhar() })

async function desenhar() {
  const conta = await lerConta()
  if (aba === 'conta' || !conta) return telaConta(conta)
  const e = await estado()
  if (e.fase === 'gravando') return telaGravando(e)
  if (e.fase === 'revisando') return telaRevisao(e)
  if (e.fase === 'enviando') return telaEnviando(e)
  return telaInicio(conta, e)
}

/* ------------------------------------------------------------------ conta */

function telaConta(conta: Conta | null) {
  app.innerHTML = `
    <div class="pilha">
      <label>Endereço da API do Demo Studio
        <input type="url" id="servidor" placeholder="https://api.seudominio.com.br" value="${esc(conta?.servidor ?? '')}">
      </label>
      <label>Token pessoal
        <input type="password" id="token" placeholder="nxd_…" value="${esc(conta?.token ?? '')}">
      </label>
      <p class="dica">Gere o token no painel: Demo Studio → Configurações → Extensão.</p>
      <button class="b primario" id="salvar">Salvar e testar</button>
      <p id="resultado"></p>
    </div>`
  document.getElementById('salvar')!.addEventListener('click', async () => {
    const servidor = (document.getElementById('servidor') as HTMLInputElement).value.trim().replace(/\/+$/, '')
    const token = (document.getElementById('token') as HTMLInputElement).value.trim()
    const r = document.getElementById('resultado')!
    const origem = origemDe(servidor)
    if (!origem || !token) { r.className = 'erro'; r.textContent = 'Preencha o endereço (https://…) e o token.'; return }
    // Permissão só para o domínio do servidor (§6.3) — pedida agora, no clique.
    const deu = await chrome.permissions.request({ origins: [`${origem}/*`] })
    if (!deu) { r.className = 'erro'; r.textContent = 'Sem permissão para falar com o servidor.'; return }
    const nova = { servidor, token }
    try {
      const eu = await chamar<{ user: { name: string | null; email: string }; role: string }>(nova, '/api/ext/me')
      await chrome.storage.local.set({ conta: nova })
      r.className = 'ok'
      r.textContent = `Conectado como ${eu.user.name ?? eu.user.email} (${eu.role === 'ADMIN' ? 'admin' : 'editor'}).`
    } catch (err) {
      r.className = 'erro'
      r.textContent = (err as Error).message
    }
  })
}

/* ------------------------------------------------------------------ início */

async function telaInicio(conta: Conta, e: Estado) {
  app.innerHTML = `<p class="dica">Carregando…</p>`
  let demos: { id: string; name: string; status: string; stepsCount: number }[] = []
  let podeDesligar = false
  try {
    ;[demos, podeDesligar] = await Promise.all([
      chamar<typeof demos>(conta, '/api/ext/demos'),
      chamar<{ canDisable: boolean }>(conta, '/api/ext/anonymize-rules').then((r) => r.canDisable),
    ])
  } catch (err) {
    app.innerHTML = `<p class="erro">${esc((err as Error).message)}</p><p class="dica">Confira a aba Conta.</p>`
    return
  }
  const concluido = e.envio?.concluido
    ? `<p class="ok">Telas enviadas! ${e.envio.editorUrl ? `<a href="${esc(e.envio.editorUrl)}" target="_blank">Abrir o editor</a>` : ''}</p>`
    : ''
  app.innerHTML = `
    ${concluido}
    <label>Demo de destino
      <select id="demo">
        <option value="__nova">+ Nova demo</option>
        ${demos.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${d.stepsCount} etapas)</option>`).join('')}
      </select>
    </label>
    <label id="nome-nova">Nome da nova demo
      <input type="text" id="nome" placeholder="NX Systems — clínica">
    </label>
    <div class="linha"><label><input type="checkbox" id="anon" checked ${podeDesligar ? '' : 'disabled'}> Anonimizar dados ${podeDesligar ? '' : '(obrigatório)'}</label></div>
    <div class="linha">
      <label><input type="radio" name="modo" value="imagem" checked> Imagem</label>
      <label><input type="radio" name="modo" value="html"> Imagem + HTML</label>
    </div>
    <button class="b primario" id="iniciar">Iniciar captura</button>
    <p class="dica">Cada clique na página vira uma tela com o destaque no lugar do clique. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> captura sem clicar.</p>
    <p id="msg"></p>`
  const sel = document.getElementById('demo') as HTMLSelectElement
  const nomeNova = document.getElementById('nome-nova')!
  if (demos.length) sel.value = demos[0].id
  const alternar = () => { nomeNova.style.display = sel.value === '__nova' ? 'block' : 'none' }
  sel.addEventListener('change', alternar)
  alternar()

  document.getElementById('iniciar')!.addEventListener('click', async () => {
    const msg = document.getElementById('msg')!
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const origem = tab?.url ? origemDe(tab.url) : null
    if (!tab?.id || !origem) { msg.className = 'erro'; msg.textContent = 'Abra o sistema que vai capturar (página http/https) nesta aba.'; return }
    // Permissão só para o site capturado, pedida agora (§6.3: nada de <all_urls> permanente).
    if (!(await chrome.permissions.request({ origins: [`${origem}/*`] }))) { msg.className = 'erro'; msg.textContent = 'Sem permissão para capturar este site.'; return }
    let demoId = sel.value
    let demoNome = sel.options[sel.selectedIndex].text
    try {
      if (demoId === '__nova') {
        const nome = (document.getElementById('nome') as HTMLInputElement).value.trim()
        if (!nome) { msg.className = 'erro'; msg.textContent = 'Dê um nome para a nova demo.'; return }
        const nova = await chamar<{ id: string; name: string }>(conta, '/api/ext/demos', { method: 'POST', body: { name: nome } })
        demoId = nova.id
        demoNome = nova.name
      }
      const anonimizar = (document.getElementById('anon') as HTMLInputElement).checked
      const modo = (document.querySelector('input[name=modo]:checked') as HTMLInputElement).value as Modo
      const r = await sw({ tipo: 'iniciar', tabId: tab.id, demoId, demoNome, anonimizar, modo })
      if (r?.erro) throw new Error(r.erro)
      window.close()
    } catch (err) {
      msg.className = 'erro'
      msg.textContent = (err as Error).message
    }
  })
}

/* ------------------------------------------------------------------ gravando */

function telaGravando(e: Estado) {
  app.innerHTML = `
    <div class="gravando"><span class="ponto"></span> Gravando · ${e.total ?? 0} tela(s)</div>
    <p class="dica">Destino: <b>${esc(e.demoNome ?? '')}</b>. Navegue pelo sistema normalmente: cada clique registra a tela atual.</p>
    <div class="pilha">
      <button class="b neutro" id="agora">Capturar tela agora (Alt+Shift+S)</button>
      <button class="b primario" id="fim">Finalizar e revisar</button>
      <button class="b perigo" id="descartar">Descartar captura</button>
    </div>`
  document.getElementById('agora')!.addEventListener('click', () => void sw({ tipo: 'capturarAgora' }))
  document.getElementById('fim')!.addEventListener('click', () => void sw({ tipo: 'finalizar' }))
  document.getElementById('descartar')!.addEventListener('click', () => { if (confirm('Descartar todas as telas desta captura?')) void sw({ tipo: 'descartar' }) })
}

/* ------------------------------------------------------------------ revisão */

async function telaRevisao(e: Estado) {
  const telas = await listarTelas()
  const ficam = telas.filter((t) => !removidas.has(t.id)).length
  app.innerHTML = `
    <p><b>${telas.length}</b> tela(s) capturada(s) para <b>${esc(e.demoNome ?? '')}</b>. Tire as que não quiser.</p>
    ${e.envio?.erro ? `<p class="erro">O envio parou: ${esc(e.envio.erro)}. As telas que faltam continuam aqui.</p>` : ''}
    <div class="grade">
      ${telas.map((t, i) => {
        const c = t.click
        const marca = c ? `<i class="clique" style="left:${(c.x / t.viewport.width) * 100}%;top:${(c.y / t.viewport.height) * 100}%;width:${(c.w / t.viewport.width) * 100}%;height:${(c.h / t.viewport.height) * 100}%"></i>` : ''
        return `<div class="tela ${removidas.has(t.id) ? 'fora' : ''}"><img src="${t.image}" alt="">${marca}<span>${i + 1}</span><button data-id="${esc(t.id)}">${removidas.has(t.id) ? 'voltar' : '✕'}</button></div>`
      }).join('')}
    </div>
    <div class="pilha">
      <button class="b primario" id="enviar" ${ficam ? '' : 'disabled'}>Enviar ${ficam} tela(s) para a demo</button>
      <button class="b perigo" id="descartar">Descartar tudo</button>
    </div>`
  app.querySelectorAll<HTMLButtonElement>('.tela button').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id!
      if (removidas.has(id)) removidas.delete(id)
      else removidas.add(id)
      void desenhar()
    }),
  )
  document.getElementById('enviar')!.addEventListener('click', () => void sw({ tipo: 'enviar', removidas: [...removidas] }))
  document.getElementById('descartar')!.addEventListener('click', () => { if (confirm('Descartar todas as telas?')) void sw({ tipo: 'descartar' }) })
}

function telaEnviando(e: Estado) {
  const { feito = 0, total = 0 } = e.envio ?? {}
  app.innerHTML = `
    <p>Enviando ${feito} de ${total} tela(s)…</p>
    <div class="barra"><div style="width:${total ? (feito / total) * 100 : 0}%"></div></div>
    <p class="dica">Pode fechar esta janela: o envio continua. No fim o editor abre numa aba nova.</p>`
}

void desenhar()
