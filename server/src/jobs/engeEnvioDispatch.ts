import { query, queryOne } from '../db.js';
import { sendMail, type SmtpConfig } from '../lib/mailer.js';
import { sendTextWith } from '../lib/supportGroup.js';
import { sendNxTemplate } from '../lib/nxTemplateSend.js';
import {
  ASSUNTO_PADRAO,
  CORPO_PADRAO,
  WHATSAPP_PADRAO,
  listaEmails,
  listaTelefones,
  montarHtml,
  preencher,
  type DadosAviso,
} from '../lib/engeEnvio.js';

/**
 * Enge Services (/engeenvio): manda os avisos de garantia cujo dia/hora agendado já chegou, por
 * e-mail (o aviso que vale juridicamente) e/ou WhatsApp pela NX (reforço). Roda a cada minuto.
 * O texto é montado na hora do envio (com o modelo atual) e gravado na linha do envio — o que
 * ficou registrado é exatamente o que o síndico recebeu. Cada canal tem seu próprio resultado:
 * um reenvio só refaz o canal que falhou.
 */

const INTERVAL_MS = 60_000;
const TZ = 'America/Sao_Paulo';

// Um envio por vez por id: o "Enviar agora" da tela e o job podem cair no mesmo aviso.
const emAndamento = new Set<string>();

/** Conexão da NX (Z-PRO) da Enge. `modo: 'template'` = número oficial (WABA), que fora da janela de
 * 24h só aceita template aprovado; `'texto'` = mensagem livre (número não oficial). */
export interface NxEnge {
  apiId?: string;
  token?: string;
  baseUrl?: string;
  modo?: 'texto' | 'template';
  template?: string;
  idioma?: string;
  /** Uma variável por linha, na ordem do {{1}}, {{2}}… do template (ex.: "{sindico}"). */
  parametros?: string[];
}

export interface ConfigEnge {
  smtp: SmtpConfig | null;
  copia_oculta: string | null;
  assunto: string | null;
  corpo: string | null;
  app_url: string | null;
  nx: NxEnge | null;
  whatsapp_texto: string | null;
}

/** Modelo de mensagem (aba Modelos e réguas). */
export interface ModeloEnge {
  id: string;
  nome: string;
  assunto: string;
  corpo: string;
  whatsapp_texto: string;
  whatsapp_template: string | null;
  whatsapp_idioma: string | null;
  whatsapp_parametros: string[];
}

/**
 * Textos que valem pra um aviso: o modelo dele; sem modelo (ou apagado), o modelo padrão; sem
 * nenhum modelo, os textos antigos da config e, por fim, os textos de fábrica.
 */
export async function textosDoAviso(cfg: ConfigEnge, modeloId: string | null) {
  const modelo =
    (modeloId ? await queryOne<ModeloEnge>('SELECT * FROM ee_modelos WHERE id = $1', [modeloId]) : null) ??
    (await queryOne<ModeloEnge>('SELECT * FROM ee_modelos ORDER BY padrao DESC, ordem, created_at LIMIT 1'));
  return {
    assunto: modelo?.assunto?.trim() || cfg.assunto?.trim() || ASSUNTO_PADRAO,
    corpo: modelo?.corpo?.trim() || cfg.corpo?.trim() || CORPO_PADRAO,
    whatsapp: modelo?.whatsapp_texto?.trim() || cfg.whatsapp_texto?.trim() || WHATSAPP_PADRAO,
    // Número oficial: template do modelo; sem template no modelo, o que ficou na conexão (versão antiga).
    template: modelo?.whatsapp_template?.trim() || cfg.nx?.template?.trim() || '',
    idioma: modelo?.whatsapp_idioma?.trim() || cfg.nx?.idioma?.trim() || 'pt_BR',
    parametros: modelo?.whatsapp_template?.trim() ? modelo.whatsapp_parametros ?? [] : cfg.nx?.parametros ?? [],
  };
}

interface EnvioParaMandar {
  id: string;
  modelo_id: string | null;
  token: string;
  status: string;
  canal_email: boolean;
  canal_whatsapp: boolean;
  enviado_em: string | null;
  whatsapp_enviado_em: string | null;
  item: string;
  prazo: string | null;
  vencimento: string;
  empreendimento: string;
  sindico: string | null;
  emails: string | null;
  telefone: string | null;
  construtora: string | null;
}

const hojeSp = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function smtpCompleto(smtp: SmtpConfig | null | undefined): smtp is SmtpConfig {
  return Boolean(smtp?.host && smtp.user && smtp.password && smtp.fromEmail);
}

/** Conexão preenchida (o template, no número oficial, vem de cada modelo). */
export function nxCompleto(nx: NxEnge | null | undefined): boolean {
  return Boolean(nx?.apiId && nx.token);
}

export async function lerConfigEnge(): Promise<ConfigEnge> {
  const row = await queryOne<ConfigEnge>(
    'SELECT smtp, copia_oculta, assunto, corpo, app_url, nx, whatsapp_texto FROM ee_config WHERE id = true',
  );
  return row ?? { smtp: null, copia_oculta: null, assunto: null, corpo: null, app_url: null, nx: null, whatsapp_texto: null };
}

export function linkCiente(cfg: Pick<ConfigEnge, 'app_url'>, token: string): string | null {
  const base = (cfg.app_url || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  return base ? `${base}/engeenvio/ciente/${token}` : null;
}

/** Manda o WhatsApp para cada número. Devolve os que receberam e os que falharam (com o motivo). */
export async function mandarWhatsApp(
  nx: NxEnge,
  numeros: string[],
  texto: string,
  dados: DadosAviso,
  tpl?: { template: string; idioma: string; parametros: string[] },
): Promise<{ ok: string[]; falhas: string[] }> {
  const ok: string[] = [];
  const falhas: string[] = [];
  const baseUrl = (nx.baseUrl || 'https://appapi.nxsystems.com.br').replace(/\/$/, '');
  for (const numero of numeros) {
    try {
      if (nx.modo === 'template') {
        const template = tpl?.template || nx.template?.trim();
        if (!template) throw new Error('Número oficial: o modelo deste aviso não tem o nome do template aprovado.');
        // WhatsApp recusa parâmetro vazio — variável sem valor vira um traço.
        const params = (tpl?.parametros ?? nx.parametros ?? []).map((p) => preencher(p, dados).trim() || '-');
        await sendNxTemplate(
          { baseUrl, apiId: nx.apiId!, apiToken: nx.token! },
          numero,
          template,
          tpl?.idioma || nx.idioma?.trim() || 'pt_BR',
          params,
          false,
        );
      } else {
        const r = await sendTextWith({ apiId: nx.apiId!, token: nx.token!, baseUrl }, numero, texto, 'engeenvio', false);
        if (!r.ok) throw new Error(r.detail || (r.status ? `NX HTTP ${r.status}` : 'Não enviou.'));
      }
      ok.push(numero);
    } catch (err) {
      falhas.push(`${numero}: ${err instanceof Error ? err.message : 'não enviou'}`.slice(0, 400));
    }
  }
  return { ok, falhas };
}

/**
 * Manda um aviso agora pelos canais escolhidos que ainda não saíram. Grava o resultado de cada
 * canal; status fica "enviado" quando todos os canais escolhidos saíram, senão "erro".
 * Devolve a mensagem de erro (de um ou dos dois canais), ou null se deu tudo certo.
 */
export async function enviarAviso(id: string): Promise<string | null> {
  if (emAndamento.has(id)) return 'Este aviso já está sendo enviado.';
  emAndamento.add(id);
  try {
    const e = await queryOne<EnvioParaMandar>(
      `SELECT v.id, v.modelo_id, v.token, v.status, v.canal_email, v.canal_whatsapp, v.enviado_em, v.whatsapp_enviado_em,
              g.item, g.prazo, to_char(g.vencimento, 'YYYY-MM-DD') AS vencimento,
              m.nome AS empreendimento, m.sindico, m.emails, m.telefone, m.construtora
       FROM ee_envios v
       JOIN ee_garantias g ON g.id = v.garantia_id
       JOIN ee_empreendimentos m ON m.id = g.empreendimento_id
       WHERE v.id = $1`,
      [id],
    );
    if (!e) return 'Aviso não encontrado.';
    if (e.status === 'enviado' || e.status === 'cancelado') return null;

    const cfg = await lerConfigEnge();
    const link = linkCiente(cfg, e.token);
    const dados: DadosAviso = { ...e, enviadoEm: hojeSp(), link };
    const textos = await textosDoAviso(cfg, e.modelo_id);
    let emailOk = !e.canal_email || Boolean(e.enviado_em);
    let whatsOk = !e.canal_whatsapp || Boolean(e.whatsapp_enviado_em);
    const erros: string[] = [];

    if (!emailOk) {
      let erro: string | null = null;
      const para = listaEmails(e.emails);
      if (!smtpCompleto(cfg.smtp)) erro = 'E-mail de envio não configurado (Configurações › E-mail de envio).';
      else if (!para.length) erro = 'O empreendimento não tem e-mail válido do síndico.';
      else {
        const assunto = preencher(textos.assunto, dados);
        const corpo = preencher(textos.corpo, dados);
        try {
          await sendMail({
            to: para.join(', '),
            bcc: listaEmails(cfg.copia_oculta).join(', ') || undefined,
            subject: assunto,
            html: montarHtml(corpo, link),
            smtp: cfg.smtp,
          });
          emailOk = true;
          await query(
            `UPDATE ee_envios SET enviado_em = NOW(), erro = NULL, destinatarios = $2, assunto = $3, corpo = $4 WHERE id = $1`,
            [id, para.join(', '), assunto, corpo],
          );
        } catch (err) {
          erro = err instanceof Error ? err.message : 'Falha no envio.';
        }
      }
      if (erro) {
        erros.push(`E-mail: ${erro}`);
        await query(`UPDATE ee_envios SET erro = $2 WHERE id = $1`, [id, erro]);
      }
    }

    if (!whatsOk) {
      let erro: string | null = null;
      const numeros = listaTelefones(e.telefone);
      if (!nxCompleto(cfg.nx)) erro = 'WhatsApp (NX) não configurado (Configurações › WhatsApp pela NX).';
      else if (!numeros.length) erro = 'O empreendimento não tem telefone/WhatsApp válido do síndico.';
      else {
        const texto = preencher(textos.whatsapp, dados);
        const r = await mandarWhatsApp(cfg.nx!, numeros, texto, dados, textos);
        if (r.ok.length) {
          whatsOk = true;
          // Saiu pra pelo menos um número: conta como enviado (não reenviar pra quem já recebeu);
          // quem falhou fica anotado no aviso.
          await query(
            `UPDATE ee_envios SET whatsapp_enviado_em = NOW(), whatsapp_para = $2, whatsapp_texto = $3, whatsapp_erro = $4 WHERE id = $1`,
            [id, r.ok.join(', '), cfg.nx!.modo === 'template' ? `[template ${textos.template}]` : texto, r.falhas.join(' | ') || null],
          );
        } else {
          erro = r.falhas.join(' | ');
        }
      }
      if (erro) {
        erros.push(`WhatsApp: ${erro}`);
        await query(`UPDATE ee_envios SET whatsapp_erro = $2 WHERE id = $1`, [id, erro]);
      }
    }

    await query(`UPDATE ee_envios SET status = $2 WHERE id = $1`, [id, emailOk && whatsOk ? 'enviado' : 'erro']);
    return erros.length ? erros.join(' · ') : null;
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
