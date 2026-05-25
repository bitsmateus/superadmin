import type { Client } from '@/types/client'
import type { ServerConfig } from '@/store/authStore'
import { db } from '@/services/db'

// Defaults usados quando settings ainda não foram configuradas no painel.
// Em produção, configure em /settings → Asaas / Acesso.
export const DEFAULT_CLIENT_PASSWORD = '12345678'
export const SUPPORT_PHONE = '48 93618-0186'

export interface AccessSheetParams {
  client: Client
  server?: ServerConfig
  /** Sobreescrever defaults via param (opcional). */
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
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  // Give the new document a tick to lay out before printing.
  w.setTimeout(() => {
    try {
      w.focus()
      w.print()
    } catch {
      /* ignore */
    }
  }, 250)
  return true
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderAccessSheetHtml({
  client,
  server,
  password,
  supportPhone,
}: AccessSheetParams): string {
  const today = new Date().toLocaleDateString('pt-BR')
  const company = client.company || client.name || '—'
  const supportEmail = client.supportEmail || '—'
  const loginUrl = server?.loginUrl || '—'
  const serverName = server?.name || client.tenantServerId || '—'
  const settings = db.getSettings()
  const effectivePassword =
    password ?? settings.defaultAccessPassword ?? DEFAULT_CLIENT_PASSWORD
  const effectiveSupportPhone =
    supportPhone ?? settings.supportPhone ?? SUPPORT_PHONE

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Acessos — ${escapeHtml(company)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0;
    padding: 40px;
    color: #111;
    background: #fff;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 28px; }
  .card {
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: 20px 22px;
    margin-bottom: 18px;
    page-break-inside: avoid;
  }
  .card h2 {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #888;
    margin: 0 0 10px;
  }
  .row { display: flex; gap: 14px; padding: 6px 0; border-bottom: 1px dashed #eee; }
  .row:last-child { border-bottom: none; }
  .row .k { width: 180px; color: #666; font-size: 13px; }
  .row .v {
    flex: 1; color: #111; font-size: 14px; word-break: break-all;
  }
  .pill {
    display: inline-block;
    background: #eef4ff;
    color: #2257d0;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    margin-left: 8px;
  }
  .footer {
    margin-top: 24px;
    border-top: 2px solid #111;
    padding-top: 12px;
    font-size: 13px;
    color: #333;
  }
  .footer strong { color: #111; }
  .print-button {
    position: fixed;
    top: 14px;
    right: 14px;
    background: #2257d0;
    color: white;
    border: none;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  @media print {
    .print-button { display: none; }
    body { padding: 24px; }
  }
</style>
</head>
<body>
<button class="print-button" onclick="window.print()">Salvar como PDF</button>

<h1>Acessos — ${escapeHtml(company)}</h1>
<div class="meta">Documento gerado em ${escapeHtml(today)}</div>

<div class="card">
  <h2>Acesso da ferramenta</h2>
  <div class="row">
    <div class="k">Plataforma</div>
    <div class="v">${escapeHtml(serverName)} <span class="pill">${escapeHtml(serverName)}</span></div>
  </div>
  <div class="row">
    <div class="k">URL</div>
    <div class="v">${escapeHtml(loginUrl)}</div>
  </div>
  <div class="row">
    <div class="k">E-mail de suporte</div>
    <div class="v">${escapeHtml(supportEmail)}</div>
  </div>
  <div class="row">
    <div class="k">Senha padrão</div>
    <div class="v"><strong>${escapeHtml(effectivePassword)}</strong></div>
  </div>
</div>

<div class="card">
  <h2>Cliente</h2>
  <div class="row">
    <div class="k">Empresa</div>
    <div class="v">${escapeHtml(company)}</div>
  </div>
  <div class="row">
    <div class="k">Responsável (cliente)</div>
    <div class="v">${escapeHtml(client.name || '—')}</div>
  </div>
  <div class="row">
    <div class="k">E-mail</div>
    <div class="v">${escapeHtml(client.email || '—')}</div>
  </div>
  <div class="row">
    <div class="k">Telefone</div>
    <div class="v">${escapeHtml(client.phone || '—')}</div>
  </div>
</div>

<div class="footer">
  <div>📞 <strong>Suporte oficial:</strong> ${escapeHtml(effectiveSupportPhone)}</div>
  <div style="margin-top: 6px; color: #666; font-size: 12px;">
    Recomendamos alterar a senha padrão no primeiro acesso.
  </div>
</div>

<script>
  // Auto-print is triggered from the opener; this is a backup if blocked.
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') { /* native */ }
  });
</script>
</body>
</html>`
}
