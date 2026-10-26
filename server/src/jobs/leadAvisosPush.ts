import { query } from '../db.js';
import { sendPushToUsers } from '../lib/webPush.js';
import { rotuloDaOrigem } from '../lib/integracaoCards.js';
import { agendamentoLegivel } from '../lib/reuniaoResultado.js';
import { abaDeFora } from '../lib/abasJuntas.js';

/**
 * Push no celular dos avisos da Luiza (lead_avisos, ver routes/leadAvisos.ts). A cada 15s pega os avisos novos, marca
 * como enviados (cada um sai uma vez só) e manda pra quem trabalha no CRM ARTHUR: quem tem a aba liberada em Equipe
 * (não admin — admin vê o aviso na tela quando abre o CRM ARTHUR, mas não recebe push). Muitos de uma vez (ex.:
 * importação) viram um push só com o resumo. Sem VAPID configurado, o push fica desligado (o toast segue).
 */
const INTERVALO_MS = 15_000;
const PAGINA_LUIZA = 'crm-ia-luiza';
/** A partir de quantos avisos no mesmo ciclo vira um push de resumo. */
const RESUMO_A_PARTIR_DE = 4;

const TITULOS: Record<string, string> = {
  novo: 'Luiza: novo atendimento',
  qualificado: 'Luiza qualificou um lead',
  reuniao_agendada: 'Luiza agendou uma reunião',
};

async function destinatarios(): Promise<string[]> {
  const abas = [PAGINA_LUIZA, abaDeFora(PAGINA_LUIZA)].filter(Boolean) as string[];
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT p.id FROM profiles p
     JOIN user_page_access a ON a.user_id = p.id AND a.page_id = ANY($1)
     WHERE p.role <> 'admin'`,
    [abas]
  );
  return rows.map((r) => r.id);
}

async function enviarPendentes() {
  // Marca antes de mandar: dois ciclos (ou duas instâncias) nunca mandam o mesmo aviso duas vezes.
  const avisos = await query<{
    id: string; tipo: string; card_id: string; nome: string; empresa: string; origem: string; agendamento: string;
  }>(
    `UPDATE lead_avisos a SET push_enviado_em = NOW()
     FROM lead_rows r
     WHERE r.id = a.lead_row_id AND a.push_enviado_em IS NULL AND a.created_at > NOW() - INTERVAL '1 hour'
     RETURNING a.id, a.tipo, r.id AS card_id, COALESCE(r.nome, '') AS nome, COALESCE(r.empresa, '') AS empresa,
               COALESCE(r.origem, '') AS origem, COALESCE(r.agendamento, '') AS agendamento`
  );
  if (!avisos.length) return;
  const para = await destinatarios();
  if (!para.length) return;
  const base = `/comercial/${abaDeFora(PAGINA_LUIZA) ?? PAGINA_LUIZA}?quadro=${PAGINA_LUIZA}`;

  if (avisos.length >= RESUMO_A_PARTIR_DE) {
    const nomes = avisos.slice(0, 3).map((a) => a.nome || a.empresa || 'Lead sem nome').join(', ');
    await sendPushToUsers(para, {
      title: `Luiza: ${avisos.length} avisos novos`,
      body: `${nomes}${avisos.length > 3 ? ` e mais ${avisos.length - 3}` : ''}`,
      url: base,
      tag: 'avisos-luiza',
    });
    return;
  }
  for (const a of avisos) {
    const quem = [a.nome || 'Lead sem nome', a.empresa].filter(Boolean).join(' · ');
    const detalhe = a.tipo === 'reuniao_agendada' && a.agendamento
      ? agendamentoLegivel(a.agendamento)
      : a.origem ? rotuloDaOrigem(a.origem) : '';
    await sendPushToUsers(para, {
      title: TITULOS[a.tipo] ?? 'Aviso da Luiza',
      body: [quem, detalhe].filter(Boolean).join(' · '),
      url: `${base}&lead=${a.card_id}`,
      tag: `aviso-${a.id}`,
    });
  }
}

export function startLeadAvisosPush() {
  const tick = () => { enviarPendentes().catch((err) => console.error('[avisos-luiza] erro no push:', err)); };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVALO_MS);
  console.log('[avisos-luiza] push dos avisos da Luiza ativo (a cada 15s)');
}
