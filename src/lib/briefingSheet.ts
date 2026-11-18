import { BRIEFING_MODELO } from '@/lib/gcBriefingModelo'
import type { GcBriefing } from '@/services/gestaoClientes'

/**
 * PDF do briefing do cliente: abre uma janela pronta pra impressão e a pessoa salva como PDF pelo
 * diálogo do navegador (mesmo mecanismo de `contractSheet.ts`, sem dependência de PDF).
 * As SENHAS ficam de fora de propósito: o PDF costuma ser enviado/arquivado, e senha não deve viajar nele.
 */
const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const RESPOSTA: Record<string, string> = { sim: 'Sim', nao: 'Não', nao_sei: 'Não sei' }

const linha = (rotulo: string, valor: string) =>
  valor.trim() ? `<div class="row"><span class="k">${esc(rotulo)}</span><span class="v">${esc(valor).replace(/\n/g, '<br>')}</span></div>` : ''

const secao = (titulo: string, corpo: string) => (corpo.trim() ? `<h2>${esc(titulo)}</h2>${corpo}` : '')

export function openBriefingSheet(nomeCliente: string, b: GcBriefing): boolean {
  const dados =
    linha('Site', b.site) + linha('WhatsApp dos leads', b.whatsapp_leads) +
    linha('Instagram', b.instagram) + linha('Facebook', b.facebook) +
    linha('CRM', b.crm) + linha('E-mail do CRM', b.crm_email) +
    b.extras.map((e) => (e.rotulo.trim() ? linha(e.rotulo, e.valor) : '')).join('')

  const item = (rotulo: string, v: string, obs: string) =>
    v || obs.trim() ? linha(rotulo, [RESPOSTA[v] ?? '', obs.trim()].filter(Boolean).join(' — ')) : ''
  const contas =
    item('Forma de pagamento nos anúncios', b.pagamento_anuncios, b.pagamento_obs) +
    item('Google Ads', b.google_ads, b.google_ads_obs) +
    item('Google Analytics', b.analytics, b.analytics_obs) +
    item('Tag Manager', b.tag_manager, b.tag_manager_obs) +
    item('Google Meu Negócio', b.meu_negocio, b.meu_negocio_obs)

  // Perguntas agrupadas pelo bloco do modelo; as acrescentadas pela equipe vão em "Outras perguntas".
  let blocoAtual = ''
  const perguntas = b.perguntas
    .map((p, i) => {
      if (!p.resposta.trim()) return ''
      const m = i < BRIEFING_MODELO.length && BRIEFING_MODELO[i].pergunta === p.pergunta ? BRIEFING_MODELO[i] : null
      const bloco = m ? m.bloco : 'Outras perguntas'
      const cab = bloco !== blocoAtual ? `<h3>${esc(bloco)}</h3>` : ''
      blocoAtual = bloco
      return `${cab}<div class="qa"><p class="q">${esc(p.pergunta)}</p><p class="a">${esc(p.resposta).replace(/\n/g, '<br>')}</p></div>`
    })
    .join('')

  const hoje = new Date().toLocaleDateString('pt-BR')
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Briefing - ${esc(nomeCliente)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; line-height: 1.45; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #666; margin: 0 0 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #2F5BFF; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 22px 0 8px; }
  h3 { font-size: 12px; margin: 14px 0 6px; }
  .row { display: flex; gap: 12px; padding: 3px 0; }
  .k { width: 190px; flex-shrink: 0; color: #555; }
  .v { flex: 1; word-break: break-word; }
  .qa { margin-bottom: 8px; break-inside: avoid; }
  .q { margin: 0; font-weight: 600; }
  .a { margin: 2px 0 0; color: #222; }
  .print-btn { position: fixed; top: 12px; right: 12px; background: #2F5BFF; color: #fff; border: 0; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; }
  @media print { .print-btn { display: none; } body { padding: 0; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">⬇&nbsp; Salvar como PDF</button>
<h1>Briefing — ${esc(nomeCliente)}</h1>
<p class="sub">Gerado em ${hoje}</p>
${secao('Dados do cliente', dados)}
${secao('Contas e pagamento', contas)}
${secao('Perguntas e respostas', perguntas)}
${!dados && !contas && !perguntas ? '<p>Nenhuma informação preenchida ainda.</p>' : ''}
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.setTimeout(() => {
    try { w.focus(); w.print() } catch { /* ignore */ }
  }, 250)
  return true
}
