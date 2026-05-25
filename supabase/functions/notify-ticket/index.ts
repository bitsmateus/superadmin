// Edge Function: notify-ticket
//
// Recebe webhooks do Postgres trigger `notify_ticket_event` e envia e-mail
// via Resend pro responsável (ou pra um e-mail de fallback se não há
// assignee).
//
// Deploy:
//   supabase functions deploy notify-ticket --no-verify-jwt
//
// Variáveis de ambiente necessárias (Supabase → Settings → Edge Functions):
//   RESEND_API_KEY      — chave do Resend (resend.com)
//   RESEND_FROM_EMAIL   — remetente (ex.: suporte@seudominio.com)
//   FALLBACK_TO_EMAIL   — pra quem mandar quando sem assignee (admin)
//   PUBLIC_PANEL_URL    — URL do painel pra montar link (ex.: https://tenanthub.app)
//   SUPABASE_URL        — auto (Supabase preenche)
//   SUPABASE_SERVICE_ROLE_KEY — auto (Supabase preenche)
//
// Depois de deployar, pegue a URL pública (Settings → Functions →
// notify-ticket → URL) e cole em /settings → Notificações da app.

// @ts-expect-error — Deno runtime (não há types no projeto)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

interface TicketPayload {
  event: 'ticket.created' | 'ticket.assigned'
  ticket: {
    id: string
    number: number
    subject: string
    priority: 'low' | 'normal' | 'high' | 'urgent'
    status: string
    customer_name: string | null
    customer_email: string
    customer_company: string | null
    assignee_id: string | null
    public_token: string
    opened_at: string
  }
}

// @ts-expect-error — Deno.serve global
Deno.serve(async (req: Request) => {
  try {
    const payload = (await req.json()) as TicketPayload
    // @ts-expect-error — Deno.env global
    const resendKey = Deno.env.get('RESEND_API_KEY')
    // @ts-expect-error
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL')
    // @ts-expect-error
    const fallbackTo = Deno.env.get('FALLBACK_TO_EMAIL')
    // @ts-expect-error
    const panelUrl = Deno.env.get('PUBLIC_PANEL_URL') ?? ''
    // @ts-expect-error
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    // @ts-expect-error
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!resendKey || !fromEmail) {
      return new Response(
        JSON.stringify({ error: 'Configure RESEND_API_KEY e RESEND_FROM_EMAIL.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Decide pra quem mandar
    let toEmail: string | null = null
    let assigneeName = ''
    if (payload.ticket.assignee_id && supabaseUrl && serviceKey) {
      const sb = createClient(supabaseUrl, serviceKey)
      const { data, error } = await sb
        .from('profiles')
        .select('email, name')
        .eq('id', payload.ticket.assignee_id)
        .maybeSingle()
      if (!error && data?.email) {
        toEmail = data.email as string
        assigneeName = (data.name as string) ?? ''
      }
    }
    if (!toEmail) toEmail = fallbackTo ?? null

    if (!toEmail) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no recipient' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const t = payload.ticket
    const subject =
      payload.event === 'ticket.assigned'
        ? `Ticket #${t.number} atribuído a você — ${t.subject}`
        : `Novo ticket #${t.number} — ${t.subject}`

    const link = panelUrl ? `${panelUrl}/tickets/${t.id}` : ''

    const priorityEmoji: Record<string, string> = {
      urgent: '🔥',
      high: '⚠️',
      normal: '📩',
      low: '💬',
    }

    const html = `
<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0c0c10;color:#e6e6e8;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,0.06);border-radius:16px;overflow:hidden;">
    <div style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#888;">
        ${payload.event === 'ticket.assigned' ? 'Atribuído a você' : 'Novo ticket'}
      </div>
      <h1 style="margin:8px 0 0;font-size:18px;color:#fff;">
        ${priorityEmoji[t.priority] ?? '📩'} #${t.number} — ${escapeHtml(t.subject)}
      </h1>
    </div>
    <div style="padding:20px 28px;font-size:14px;line-height:1.55;color:#cfcfd2;">
      ${assigneeName ? `<p>Oi <strong style="color:#fff;">${escapeHtml(assigneeName)}</strong>,</p>` : ''}
      <p>${
        payload.event === 'ticket.assigned'
          ? 'Você foi atribuído a um ticket no suporte:'
          : 'Um novo ticket chegou e está aguardando atendimento:'
      }</p>
      <table style="margin:14px 0;width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#888;width:120px;">Cliente</td><td style="color:#fff;">${escapeHtml(t.customer_name ?? '—')}</td></tr>
        ${t.customer_company ? `<tr><td style="padding:4px 0;color:#888;">Empresa</td><td>${escapeHtml(t.customer_company)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#888;">E-mail</td><td>${escapeHtml(t.customer_email)}</td></tr>
        <tr><td style="padding:4px 0;color:#888;">Prioridade</td><td style="text-transform:uppercase;">${t.priority}</td></tr>
      </table>
      ${
        link
          ? `<p style="margin-top:18px;"><a href="${link}" style="background:#4F8EF7;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:500;">Abrir ticket no painel →</a></p>`
          : ''
      }
    </div>
    <div style="padding:16px 28px;font-size:11px;color:#666;border-top:1px solid rgba(255,255,255,0.05);">
      TenantHub · notificação automática · respostas a este e-mail são ignoradas.
    </div>
  </div>
</body></html>`

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject,
        html,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error('Resend error:', resendRes.status, errText)
      return new Response(
        JSON.stringify({ error: 'Falha ao enviar e-mail', details: errText }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ ok: true, to: toEmail }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('notify-ticket crash:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
