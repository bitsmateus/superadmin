import type { Client } from '@/types/client'
import type { ServerConfig } from '@/store/authStore'
import { db } from '@/services/db'

export const DEFAULT_CLIENT_PASSWORD = '12345678'
export const SUPPORT_PHONE = '48 93618-0186'

export interface AccessSheetParams {
  client: Client
  server?: ServerConfig
  password?: string
  supportPhone?: string
}

/**
 * Opens a print-ready window with the client access sheet. The user prints to
 * PDF from the browser dialog — this avoids adding a PDF lib dependency and
 * keeps the layout fully editable via plain HTML/CSS.
 */
export function openAccessSheet({ client, server }: AccessSheetParams): boolean {
  const html = renderAccessSheetHtml({ client, server })
  // NOTE: noopener/noreferrer make window.open return null per spec — omit them
  // so we can write to the new window's document.
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

/** Monta assunto + corpo (texto) do e-mail de acessos pro cliente. */
export function buildAccessEmail({ client, server, password }: AccessSheetParams): {
  subject: string
  body: string
} {
  const company = client.company || client.name || ''
  const loginUrl = server?.loginUrl || ''
  const settings = db.getSettings()
  const effectivePassword = password ?? settings.defaultAccessPassword ?? DEFAULT_CLIENT_PASSWORD
  const login = client.supportEmail || ''
  const supportPhone = settings.supportPhone ?? SUPPORT_PHONE
  const accesses = (client.accesses ?? []).filter((a) => a.name?.trim())

  const lines: string[] = []
  lines.push(`Olá! Seguem os acessos do sistema de atendimento da ${company}.`)
  lines.push('')
  lines.push('— Sistema de atendimento —')
  if (loginUrl) lines.push(`Endereço: ${loginUrl}`)
  if (login) lines.push(`E-mail / login: ${login}`)
  lines.push(`Senha: ${effectivePassword}`)
  lines.push('')
  lines.push('⚠️ Por segurança, troque a senha no primeiro acesso (Perfil > Alterar senha).')
  if (accesses.length > 0) {
    lines.push('')
    lines.push('— Acessos adicionais —')
    for (const a of accesses) {
      lines.push(`• ${a.name}`)
      if (a.url) lines.push(`  Endereço: ${a.url}`)
      if (a.emailOrPhone) lines.push(`  E-mail/Telefone: ${a.emailOrPhone}`)
      if (a.password) lines.push(`  Senha: ${a.password}`)
    }
  }
  lines.push('')
  lines.push(`Qualquer dúvida, fale com o suporte: ${supportPhone}`)
  lines.push('NX Digital')

  return { subject: `Acessos do sistema — ${company}`, body: lines.join('\n') }
}

/** Abre o cliente de e-mail (mailto) com os acessos prontos para enviar. */
export function openAccessEmail(params: AccessSheetParams): void {
  const { subject, body } = buildAccessEmail(params)
  const to = params.client.email || ''
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function row(label: string, value: string, highlight = false): string {
  const valHtml = highlight
    ? `<span class="password-box">${escapeHtml(value)}</span>`
    : `<span class="field-value">${escapeHtml(value)}</span>`
  return `
    <div class="field">
      <span class="field-label">${escapeHtml(label)}</span>
      ${valHtml}
    </div>`
}

function renderAccessSheetHtml({ client, server, password, supportPhone }: AccessSheetParams): string {
  const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
  const company = client.company || client.name || '—'
  const loginUrl = server?.loginUrl || '—'
  const settings = db.getSettings()
  const effectivePassword = password ?? settings.defaultAccessPassword ?? DEFAULT_CLIENT_PASSWORD
  const effectiveSupportPhone = supportPhone ?? settings.supportPhone ?? SUPPORT_PHONE

  // Extra accesses from client.accesses
  const accesses = (client.accesses ?? []).filter((a) => a.name?.trim())
  const accessCards = accesses.map((a) => `
    <div class="card">
      <div class="card-header">${escapeHtml(a.name)}</div>
      <div class="card-body">
        ${a.url ? row('Endereço', a.url) : ''}
        ${a.emailOrPhone ? row('E-mail / Telefone', a.emailOrPhone) : ''}
        ${a.password ? row('Senha', a.password, true) : ''}
      </div>
    </div>`).join('')

  const hasEmail = Boolean(client.supportEmail)

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Acessos — ${escapeHtml(company)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #F1F5F9;
    color: #1E293B;
    min-height: 100vh;
    padding: 40px 20px;
  }

  /* ── Page container ── */
  .page {
    max-width: 700px;
    margin: 0 auto;
    background: #fff;
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 8px 40px rgba(0,0,0,0.10);
  }

  /* ── Header ── */
  .header {
    background: #0F172A;
    padding: 32px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand-icon {
    width: 46px; height: 46px;
    background: #4F8EF7;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 22px; color: #fff;
    letter-spacing: -1px;
  }
  .brand-name {
    font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -0.5px;
  }
  .brand-name span { color: #4F8EF7; }
  .brand-tagline {
    font-size: 10px; color: rgba(255,255,255,0.35);
    text-transform: uppercase; letter-spacing: 1.5px; margin-top: 2px;
  }
  .header-right { text-align: right; }
  .doc-label {
    font-size: 10px; color: rgba(255,255,255,0.4);
    text-transform: uppercase; letter-spacing: 1.5px;
  }
  .doc-company {
    font-size: 17px; font-weight: 700; color: #fff; margin-top: 4px;
  }
  .doc-date {
    font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 3px;
  }

  /* ── Accent bar ── */
  .accent-bar {
    height: 4px;
    background: linear-gradient(90deg, #4F8EF7 0%, #93C5FD 100%);
  }

  /* ── Content ── */
  .content { padding: 36px 40px; }

  /* ── Section title ── */
  .section-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 1.5px; color: #94A3B8;
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 14px;
  }
  .section-label::after {
    content: ''; flex: 1; height: 1px; background: #E2E8F0;
  }

  /* ── Card ── */
  .card {
    border: 1.5px solid #E2E8F0;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .card-header {
    background: #F8FAFC;
    padding: 11px 20px;
    font-size: 12px; font-weight: 700; color: #475569;
    text-transform: uppercase; letter-spacing: 0.8px;
    border-bottom: 1.5px solid #E2E8F0;
  }
  .card-body { padding: 0; }

  /* ── Field row ── */
  .field {
    display: flex; align-items: center;
    padding: 13px 20px; gap: 16px;
    border-bottom: 1px solid #F1F5F9;
  }
  .field:last-child { border-bottom: none; }
  .field-label {
    width: 150px; flex-shrink: 0;
    font-size: 12px; color: #94A3B8; font-weight: 500;
  }
  .field-value {
    flex: 1; font-size: 14px; color: #1E293B;
    font-weight: 500; word-break: break-all;
  }

  /* ── Password highlight ── */
  .password-box {
    display: inline-block;
    background: #FFF7ED; border: 1.5px solid #FED7AA;
    border-radius: 8px; padding: 8px 16px;
    font-family: "Courier New", "SF Mono", monospace;
    font-size: 17px; font-weight: 800; color: #C2410C;
    letter-spacing: 3px;
  }

  /* ── Notice ── */
  .notice {
    background: #EFF6FF; border: 1.5px solid #BFDBFE;
    border-radius: 10px; padding: 14px 18px;
    font-size: 13px; color: #1D4ED8;
    display: flex; gap: 10px; align-items: flex-start;
    margin-bottom: 30px;
  }
  .notice-icon { font-size: 16px; flex-shrink: 0; }

  /* ── Spacer ── */
  .spacer { margin-bottom: 30px; }

  /* ── Footer ── */
  .footer {
    border-top: 1.5px solid #E2E8F0;
    background: #F8FAFC;
    padding: 18px 40px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
  }
  .footer-brand {
    font-size: 13px; font-weight: 800; color: #0F172A;
    display: flex; align-items: center; gap: 4px;
  }
  .footer-brand span { color: #4F8EF7; }
  .footer-right { text-align: right; }
  .footer-support { font-size: 12px; color: #475569; font-weight: 500; }
  .footer-note { font-size: 10px; color: #94A3B8; margin-top: 2px; }

  /* ── Print button ── */
  .print-btn {
    position: fixed; top: 16px; right: 16px;
    background: #4F8EF7; color: #fff; border: none;
    padding: 10px 20px; border-radius: 8px; cursor: pointer;
    font-size: 13px; font-weight: 700;
    box-shadow: 0 4px 14px rgba(79,142,247,0.45);
    display: flex; align-items: center; gap: 6px;
  }
  .print-btn:hover { background: #3b7de8; }

  @media print {
    .print-btn { display: none; }
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; border-radius: 0; max-width: 100%; }
  }
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">⬇&nbsp; Salvar como PDF</button>

<div class="page">

  <div class="header">
    <div class="brand">
      <div class="brand-icon">NX</div>
      <div>
        <div class="brand-name"><span>NX</span> Digital</div>
        <div class="brand-tagline">Automação &amp; Tecnologia</div>
      </div>
    </div>
    <div class="header-right">
      <div class="doc-label">Guia de Acessos</div>
      <div class="doc-company">${escapeHtml(company)}</div>
      <div class="doc-date">Emitido em ${escapeHtml(today)}</div>
    </div>
  </div>

  <div class="accent-bar"></div>

  <div class="content">

    <div class="section-label">Acesso à plataforma</div>

    <div class="card">
      <div class="card-header">Sistema de atendimento</div>
      <div class="card-body">
        ${row('Endereço', loginUrl)}
        ${hasEmail ? row('E-mail', client.supportEmail!) : ''}
        ${row('Senha inicial', effectivePassword, true)}
      </div>
    </div>

    <div class="notice">
      <div class="notice-icon">🔒</div>
      <div>
        <strong>Segurança:</strong> Recomendamos alterar a senha inicial no primeiro acesso.
        Após entrar, vá em <em>Perfil → Alterar senha</em> para definir uma senha pessoal.
      </div>
    </div>

    ${accesses.length > 0 ? `<div class="section-label">Acessos adicionais</div>${accessCards}` : ''}

  </div>

  <div class="footer">
    <div class="footer-brand"><span>NX</span> Digital</div>
    <div class="footer-right">
      <div class="footer-support">📞 ${escapeHtml(effectiveSupportPhone)}</div>
      <div class="footer-note">Documento confidencial · uso exclusivo do cliente</div>
    </div>
  </div>

</div>
</body>
</html>`
}
