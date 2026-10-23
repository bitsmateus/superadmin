import { query, queryOne } from '../db.js';
import { sendMail, type SmtpConfig } from '../lib/mailer.js';
import { ASSUNTO_PADRAO, CORPO_PADRAO, listaEmails, montarHtml, preencher } from '../lib/engeEnvio.js';

/**
 * Enge Services (/engeenvio): manda os avisos de garantia cujo dia/hora agendado já chegou.
 * Roda a cada minuto. O texto é montado na hora do envio (com o modelo atual) e gravado na
 * linha do envio — o que ficou registrado é exatamente o que o síndico recebeu.
 */

const INTERVAL_MS = 60_000;
const TZ = 'America/Sao_Paulo';

// Um envio por vez por id: o "Enviar agora" da tela e o job podem cair no mesmo aviso.
const emAndamento = new Set<string>();

interface ConfigEnge {
  smtp: SmtpConfig | null;
  copia_oculta: string | null;
  assunto: string | null;
  corpo: string | null;
  app_url: string | null;
}

interface EnvioParaMandar {
  id: string;
  token: string;
  status: string;
  item: string;
  prazo: string | null;
  vencimento: string;
  empreendimento: string;
  sindico: string | null;
  emails: string | null;
  construtora: string | null;
}

const hojeSp = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function smtpCompleto(smtp: SmtpConfig | null | undefined): smtp is SmtpConfig {
  return Boolean(smtp?.host && smtp.user && smtp.password && smtp.fromEmail);
}

export async function lerConfigEnge(): Promise<ConfigEnge> {
  const row = await queryOne<ConfigEnge>('SELECT smtp, copia_oculta, assunto, corpo, app_url FROM ee_config WHERE id = true');
  return row ?? { smtp: null, copia_oculta: null, assunto: null, corpo: null, app_url: null };
}

export function linkCiente(cfg: ConfigEnge, token: string): string | null {
  const base = (cfg.app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return base ? `${base}/engeenvio/ciente/${token}` : null;
}

/** Manda um aviso agora. Grava "enviado" ou "erro" na linha; devolve a mensagem de erro, se houver. */
export async function enviarAviso(id: string): Promise<string | null> {
  if (emAndamento.has(id)) return 'Este aviso já está sendo enviado.';
  emAndamento.add(id);
  try {
    const e = await queryOne<EnvioParaMandar>(
      `SELECT v.id, v.token, v.status, g.item, g.prazo, to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento,
              m.nome AS empreendimento, m.sindico, m.emails, m.construtora
       FROM ee_envios v
       JOIN ee_garantias g ON g.id = v.garantia_id
       JOIN ee_empreendimentos m ON m.id = g.empreendimento_id
       WHERE v.id = $1`,
      [id],
    );
    if (!e) return 'Aviso não encontrado.';
    if (e.status === 'enviado' || e.status === 'cancelado') return null;

    const falhar = async (msg: string) => {
      await query(`UPDATE ee_envios SET status = 'erro', erro = $2 WHERE id = $1`, [id, msg]);
      return msg;
    };

    const cfg = await lerConfigEnge();
    if (!smtpCompleto(cfg.smtp)) return falhar('E-mail de envio não configurado (Configurações › E-mail de envio).');
    const para = listaEmails(e.emails);
    if (!para.length) return falhar('O empreendimento não tem e-mail válido do síndico.');

    const dados = { ...e, enviadoEm: hojeSp() };
    const assunto = preencher(cfg.assunto?.trim() || ASSUNTO_PADRAO, dados);
    const corpo = preencher(cfg.corpo?.trim() || CORPO_PADRAO, dados);
    try {
      await sendMail({
        to: para.join(', '),
        bcc: listaEmails(cfg.copia_oculta).join(', ') || undefined,
        subject: assunto,
        html: montarHtml(corpo, linkCiente(cfg, e.token)),
        smtp: cfg.smtp,
      });
    } catch (err) {
      return falhar(err instanceof Error ? err.message : 'Falha no envio.');
    }
    await query(
      `UPDATE ee_envios SET status = 'enviado', enviado_em = NOW(), erro = NULL,
              destinatarios = $2, assunto = $3, corpo = $4
       WHERE id = $1`,
      [id, para.join(', '), assunto, corpo],
    );
    return null;
  } finally {
    emAndamento.delete(id);
  }
}

async function runOnce() {
  const vencidos = await query<{ id: string }>(
    `SELECT id FROM ee_envios WHERE status = 'agendado' AND enviar_em <= NOW() ORDER BY enviar_em LIMIT 50`,
  );
  for (const { id } of vencidos) {
    const erro = await enviarAviso(id);
    if (erro) console.error(`[engeEnvioDispatch] aviso ${id}: ${erro}`);
  }
}

export function startEngeEnvioDispatch() {
  if (process.env.ENGE_ENVIO_DISPATCH === 'off') {
    console.log('[engeEnvioDispatch] desativado (ENGE_ENVIO_DISPATCH=off)');
    return;
  }
  const tick = () => {
    runOnce().catch((err) => console.error('[engeEnvioDispatch] erro:', err));
  };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVAL_MS);
  console.log('[engeEnvioDispatch] job iniciado (a cada 1 min)');
}
