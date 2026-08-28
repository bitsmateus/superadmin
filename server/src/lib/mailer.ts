import nodemailer from 'nodemailer';
import { queryOne } from '../db.js';

interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  secure?: boolean;
  fromEmail?: string;
  fromName?: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const row = await queryOne<{ smtp: SmtpConfig | null }>('SELECT smtp FROM settings WHERE id = true');
  const smtp = row?.smtp;
  if (!smtp?.host || !smtp.user || !smtp.password || !smtp.fromEmail) return null;
  return smtp;
}

/** Manda um e-mail via SMTP configurado em Configurações > E-mail (SMTP). Lança se não estiver
 * configurado ou se o envio falhar — quem chama decide como avisar o usuário. */
export async function sendMail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const smtp = await getSmtpConfig();
  if (!smtp) {
    throw new Error('SMTP não configurado — configure em Configurações > E-mail (SMTP)');
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: Boolean(smtp.secure),
    auth: { user: smtp.user, pass: smtp.password },
  });

  await transporter.sendMail({
    from: smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
