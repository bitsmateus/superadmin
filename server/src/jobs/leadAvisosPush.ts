import { query } from '../db.js';
import { sendPushToUsers } from '../lib/webPush.js';
import { criarNotificacao, linkDoCard, type DadosDaNotificacao, type TipoNotificacao } from '../lib/notificacoes.js';
import { agendamentoParaIso } from '../lib/reuniaoResultado.js';
import { abaDeFora } from '../lib/abasJuntas.js';

/**
 * Os avisos que o próprio app gera (lead_avisos, pelo gatilho registrar_aviso_luiza: card novo no CRM IA LUIZA, foi
 * pra "Qualificado", foi pra "Reunião agendada") viram notificações do sininho/popup (lib/notificacoes.ts) — a mesma
 * reunião avisada pelo n8n não duplica. A cada 5s pega os avisos novos (cada um sai uma vez só). Muitos de uma vez (ex.:
 * importação) viram um push só com o resumo, em vez de um por card.
 */
const INTERVALO_MS = 5_000;
const PAGINA_LUIZA = 'crm-ia-luiza';
const RESUMO_A_PARTIR_DE = 4;

const TIPO: Record<string, TipoNotificacao> = {
  novo: 'lead_novo_ia',
  qualificado: 'lead_qualificado_ia',
  reuniao_agendada: 'reuniao_agendada_ia',
};

async function converterPendentes() {
  // Marca antes: dois ciclos (ou duas instâncias) nunca convertem o mesmo aviso duas vezes.
  const avisos = await query<{
    id: string; tipo: string; card_id: string; nome: string; empresa: string; telefone: string; agendamento: string;
  }>(
    `UPDATE lead_avisos a SET push_enviado_em = NOW()
     FROM lead_rows r
     WHERE r.id = a.lead_row_id AND a.push_enviado_em IS NULL AND a.created_at > NOW() - INTERVAL '1 hour'
     RETURNING a.id, a.tipo, r.id AS card_id, COALESCE(r.nome, '') AS nome, COALESCE(r.empresa, '') AS empresa,
               COALESCE(r.telefone, '') AS telefone, COALESCE(r.agendamento, '') AS agendamento`
  );
  if (!avisos.length) return;
  const emLote = avisos.length >= RESUMO_A_PARTIR_DE;
  const para = new Set<string>();
  for (const a of avisos) {
    const tipo = TIPO[a.tipo];
    if (!tipo) continue;
    const dados: DadosDaNotificacao = {
      tipo, titulo: '', mensagem: a.empresa, nome: a.nome, telefone: a.telefone, ticket_nx: '', card_id: a.card_id,
      quadro: PAGINA_LUIZA, ultima_mensagem_lead: '', resposta_luiza: '',
      reuniao_em: tipo === 'reuniao_agendada_ia' ? (agendamentoParaIso(a.agendamento) ? new Date(agendamentoParaIso(a.agendamento)!).toISOString() : null) : null,
      link_reuniao: '',
    };
    const { id } = await criarNotificacao(dados, null, { semPush: emLote });
    if (emLote) {
      const quem = await query<{ user_id: string }>('SELECT user_id FROM notificacao_destinatarios WHERE notificacao_id = $1', [id]);
      for (const q of quem) para.add(q.user_id);
    }
  }
  if (emLote && para.size) {
    const nomes = avisos.slice(0, 3).map((a) => a.nome || a.empresa || 'Lead sem nome').join(', ');
    await sendPushToUsers([...para], {
      title: `Luiza: ${avisos.length} avisos novos`,
      body: `${nomes}${avisos.length > 3 ? ` e mais ${avisos.length - 3}` : ''}`,
      url: linkDoCard(PAGINA_LUIZA, avisos[0].card_id).replace(/&lead=.*$/, ''),
      tag: 'avisos-luiza',
    });
  }
}

export function startLeadAvisosPush() {
  const tick = () => { converterPendentes().catch((err) => console.error('[avisos-luiza] erro ao gerar notificação:', err)); };
  setTimeout(tick, 20_000);
  setInterval(tick, INTERVALO_MS);
  console.log(`[avisos-luiza] avisos do CRM IA LUIZA viram notificações (a cada 5s; aba de fora: ${abaDeFora(PAGINA_LUIZA) ?? '—'})`);
}
