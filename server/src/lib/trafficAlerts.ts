import { query, queryOne } from '../db.js';
import { sendToSupportGroupId } from './supportGroup.js';
import { brl, dataSp, rankingTrafego, totaisTrafego } from './trafegoMetricas.js';

/**
 * Regras de alerta de tráfego (valores iniciais do documento; ajustar na calibração).
 * Cada rodada calcula o que está "disparando" agora e reconcilia com traffic_alerts:
 *  - alerta novo é inserido (um aberto por regra+entidade, índice único parcial);
 *  - alerta aberto cuja condição deixou de valer é resolvido sozinho;
 *  - CRÍTICO novo vai pro grupo na hora; atenção/oportunidade entram só no relatório das 8h.
 */

const LIM = {
  gastoSemLead: 150,          // R$ gastos hoje por anúncio sem nenhum lead
  divergenciaLeads: 3,        // leads do Meta - leads no CRM, hoje
  cplFator: 1.5,              // CPL 3d acima de 1,5x a média 14d da conta
  cplMinLeads: 5,
  frequencia: 3,
  frequenciaMinImpressoes: 2000,
  ctrQueda: 0.3,
  ctrMinImpressoes: 2000,
  leadsSemAgendamento: 20,
  orcamentoBaixo: 60,         // R$/dia: abaixo disso o conjunto é candidato a escalar
  oportunidadeFator: 0.7,
  oportunidadeMinReunioes: 2,
};

type Nivel = 'critico' | 'atencao' | 'oportunidade';
interface Disparo { rule: string; level: Nivel; entityType: string; entityId: string; message: string }

const nomeDe = (n: string | null | undefined, id: string) => (n && n.trim() ? n.trim() : id);

async function calcular(): Promise<{ disparos: Disparo[]; regras: string[] }> {
  const d: Disparo[] = [];
  const hoje = dataSp(0);
  const horaSp = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  const regras = [
    'ad_sem_lead', 'integracao_leads', 'conta_sem_gasto', 'ad_reprovado', 'cpl_alto', 'frequencia_alta',
    'ctr_caiu', 'sem_agendamento', 'candidato_escalar',
  ];

  // Crítico: anúncio gastou muito hoje e não trouxe lead.
  for (const r of await query<{ ad_id: string; spend: string; name: string | null }>(
    `SELECT i.ad_id, SUM(i.spend) AS spend, a.name FROM meta_ad_insights_daily i
     LEFT JOIN meta_ads a ON a.ad_id = i.ad_id
     WHERE i.dia = $1::date GROUP BY i.ad_id, a.name HAVING SUM(i.spend) >= $2
       AND NOT EXISTS (SELECT 1 FROM lead_rows lr WHERE lr.meta_ad_id = i.ad_id AND lr.deleted_at IS NULL
         AND (lr.created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date)`,
    [hoje, LIM.gastoSemLead],
  )) {
    d.push({ rule: 'ad_sem_lead', level: 'critico', entityType: 'anuncio', entityId: r.ad_id,
      message: `${nomeDe(r.name, r.ad_id)}: gastou ${brl(Number(r.spend))} hoje e não trouxe nenhum lead` });
  }

  // Crítico: Meta contou mais leads que o CRM recebeu (integração/n8n caiu).
  const meta = await queryOne<{ n: string }>(`SELECT COALESCE(SUM(meta_leads),0) AS n FROM meta_ad_insights_daily WHERE dia = $1::date`, [hoje]);
  const crm = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM lead_rows WHERE meta_lead_id IS NOT NULL
       AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $1::date`, [hoje]);
  const dif = Number(meta?.n ?? 0) - Number(crm?.n ?? 0);
  if (dif >= LIM.divergenciaLeads) {
    d.push({ rule: 'integracao_leads', level: 'critico', entityType: 'conta', entityId: 'conta',
      message: `Meta contou ${meta?.n} leads hoje e o CRM recebeu ${crm?.n} — a integração pode ter caído` });
  }

  // Crítico: conta com campanha ativa e sem gasto depois do meio-dia.
  if (horaSp >= 12) {
    const gasto = await queryOne<{ n: string }>(`SELECT COALESCE(SUM(spend),0) AS n FROM meta_ad_insights_daily WHERE dia = $1::date`, [hoje]);
    const ativas = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM meta_campaigns WHERE status = 'ACTIVE'`);
    if (Number(gasto?.n ?? 0) === 0 && Number(ativas?.n ?? 0) > 0) {
      d.push({ rule: 'conta_sem_gasto', level: 'critico', entityType: 'conta', entityId: 'conta',
        message: 'Conta sem nenhum gasto hoje até o meio-dia, com campanhas ativas' });
    }
  }

  // Crítico: anúncio reprovado.
  for (const r of await query<{ ad_id: string; name: string | null }>(`SELECT ad_id, name FROM meta_ads WHERE status = 'DISAPPROVED'`)) {
    d.push({ rule: 'ad_reprovado', level: 'critico', entityType: 'anuncio', entityId: r.ad_id,
      message: `${nomeDe(r.name, r.ad_id)}: anúncio reprovado pelo Meta` });
  }

  // Atenção: CPL da campanha (3 dias) acima de 1,5x a média de 14 dias da conta.
  const conta14 = await totaisTrafego(dataSp(13), hoje);
  const cpl14 = conta14.cpl;
  if (cpl14) {
    for (const c of await rankingTrafego('campanha', dataSp(2), hoje)) {
      if (c.leads >= LIM.cplMinLeads && c.cpl && c.cpl > LIM.cplFator * cpl14) {
        d.push({ rule: 'cpl_alto', level: 'atencao', entityType: 'campanha', entityId: c.id,
          message: `${nomeDe(c.nome, c.id)}: CPL ${brl(c.cpl)} em 3 dias, ${(c.cpl / cpl14).toFixed(1)}x a média da conta (${brl(cpl14)})` });
      }
    }
  }

  // Atenção: frequência alta (público saturando) e CTR caindo com frequência subindo (criativo cansado).
  const sem = await query<{ ad_id: string; name: string | null; imp: string; freq: string; clicks: string;
    imp_ant: string; freq_ant: string; clicks_ant: string }>(
    `SELECT i.ad_id, a.name,
       COALESCE(SUM(i.impressions) FILTER (WHERE i.dia > $1::date - 7), 0) AS imp,
       COALESCE(SUM(i.frequency * i.impressions) FILTER (WHERE i.dia > $1::date - 7), 0) AS freq,
       COALESCE(SUM(i.link_clicks) FILTER (WHERE i.dia > $1::date - 7), 0) AS clicks,
       COALESCE(SUM(i.impressions) FILTER (WHERE i.dia <= $1::date - 7), 0) AS imp_ant,
       COALESCE(SUM(i.frequency * i.impressions) FILTER (WHERE i.dia <= $1::date - 7), 0) AS freq_ant,
       COALESCE(SUM(i.link_clicks) FILTER (WHERE i.dia <= $1::date - 7), 0) AS clicks_ant
     FROM meta_ad_insights_daily i LEFT JOIN meta_ads a ON a.ad_id = i.ad_id
     WHERE i.dia > $1::date - 14 AND i.dia <= $1::date GROUP BY i.ad_id, a.name`,
    [hoje],
  );
  for (const r of sem) {
    const imp = Number(r.imp), impAnt = Number(r.imp_ant);
    const freq = imp > 0 ? Number(r.freq) / imp : 0;
    const freqAnt = impAnt > 0 ? Number(r.freq_ant) / impAnt : 0;
    const nome = nomeDe(r.name, r.ad_id);
    if (imp >= LIM.frequenciaMinImpressoes && freq > LIM.frequencia) {
      d.push({ rule: 'frequencia_alta', level: 'atencao', entityType: 'anuncio', entityId: r.ad_id,
        message: `${nome}: frequência ${freq.toFixed(1)} em 7 dias (público saturando)` });
    }
    if (imp >= LIM.ctrMinImpressoes && impAnt >= LIM.ctrMinImpressoes) {
      const ctr = Number(r.clicks) / imp, ctrAnt = Number(r.clicks_ant) / impAnt;
      if (ctrAnt > 0 && (ctrAnt - ctr) / ctrAnt >= LIM.ctrQueda && freq > freqAnt) {
        d.push({ rule: 'ctr_caiu', level: 'atencao', entityType: 'anuncio', entityId: r.ad_id,
          message: `${nome}: CTR caiu ${Math.round(((ctrAnt - ctr) / ctrAnt) * 100)}% e a frequência subiu (${freq.toFixed(1)}) — criativo cansado` });
      }
    }
  }

  // Atenção: campanha com muito lead e nenhum agendamento em 14 dias.
  for (const c of await rankingTrafego('campanha', dataSp(13), hoje)) {
    if (c.leads >= LIM.leadsSemAgendamento && c.agendadas === 0) {
      d.push({ rule: 'sem_agendamento', level: 'atencao', entityType: 'campanha', entityId: c.id,
        message: `${nomeDe(c.nome, c.id)}: ${c.leads} leads e nenhum agendamento em 14 dias` });
    }
  }

  // Oportunidade: conjunto com custo por reunião bem abaixo da média e verba baixa (candidato a escalar).
  const conta7 = await totaisTrafego(dataSp(6), hoje);
  if (conta7.custoReuniao) {
    const orc = new Map((await query<{ adset_id: string; daily_budget: string | null }>(`SELECT adset_id, daily_budget FROM meta_adsets`))
      .map((o) => [o.adset_id, o.daily_budget == null ? null : Number(o.daily_budget)]));
    for (const s of await rankingTrafego('conjunto', dataSp(6), hoje)) {
      const verba = orc.get(s.id);
      if (s.reunioes >= LIM.oportunidadeMinReunioes && s.custoReuniao && verba != null && verba <= LIM.orcamentoBaixo
        && s.custoReuniao < LIM.oportunidadeFator * conta7.custoReuniao) {
        d.push({ rule: 'candidato_escalar', level: 'oportunidade', entityType: 'conjunto', entityId: s.id,
          message: `${nomeDe(s.nome, s.id)}: ${brl(s.custoReuniao)} por reunião (média ${brl(conta7.custoReuniao)}), verba ${brl(verba)}/dia — candidato a escalar` });
      }
    }
  }
  return { disparos: d, regras };
}

/** Grupo que recebe relatório e alertas críticos. Sem a variável, nada é enviado. */
export const grupoTrafego = (): string => (process.env.TRAFFIC_REPORT_GROUP_ID ?? '').trim();

export async function avaliarAlertasTrafego(): Promise<{ novos: number; resolvidos: number; enviados: number }> {
  const { disparos, regras } = await calcular();
  const chaves = new Set(disparos.map((x) => `${x.rule}|${x.entityType}|${x.entityId}`));
  let novos = 0;

  for (const x of disparos) {
    const r = await query(
      `INSERT INTO traffic_alerts (rule, level, entity_type, entity_id, message) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (rule, entity_type, entity_id) WHERE resolved_at IS NULL DO UPDATE SET message = EXCLUDED.message
       RETURNING (xmax = 0) AS inserido`,
      [x.rule, x.level, x.entityType, x.entityId, x.message],
    );
    if ((r[0] as { inserido?: boolean } | undefined)?.inserido) novos++;
  }

  let resolvidos = 0;
  const abertos = await query<{ id: string; rule: string; entity_type: string; entity_id: string }>(
    `SELECT id, rule, entity_type, entity_id FROM traffic_alerts WHERE resolved_at IS NULL AND rule = ANY($1)`, [regras]);
  for (const a of abertos) {
    if (!chaves.has(`${a.rule}|${a.entity_type}|${a.entity_id}`)) {
      await query(`UPDATE traffic_alerts SET resolved_at = now() WHERE id = $1`, [a.id]);
      resolvidos++;
    }
  }

  // Críticos abertos que ainda não foram avisados vão pro grupo na hora.
  let enviados = 0;
  const grupo = grupoTrafego();
  if (grupo) {
    const pend = await query<{ id: string; message: string }>(
      `SELECT id, message FROM traffic_alerts WHERE level = 'critico' AND resolved_at IS NULL AND sent_at IS NULL ORDER BY created_at`);
    for (const p of pend) {
      const res = await sendToSupportGroupId(grupo, `🚨 *Tráfego NX — crítico*\n${p.message}`);
      if (res.ok) {
        await query(`UPDATE traffic_alerts SET sent_at = now() WHERE id = $1`, [p.id]);
        enviados++;
      } else {
        console.error('[traffic-alerts] falha ao enviar crítico ao grupo:', res.reason ?? res.status ?? res.detail);
        break;
      }
    }
  }
  return { novos, resolvidos, enviados };
}
