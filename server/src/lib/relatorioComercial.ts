import { query, queryOne } from '../db.js';

/**
 * O relatório do mês do Dashboard Comercial, montado AQUI no servidor.
 *
 * A tela interna calcula tudo no navegador, em cima dos dados que já estão carregados. O link
 * público não tem nada carregado nem login nenhum — então a mesma conta é refeita aqui, em SQL, e
 * sai pronta em JSON. As regras são as mesmas da tela, e estão repetidas nos comentários de cada
 * trecho pra que uma mudança de regra lá apareça como divergência aqui, e não passe batida.
 *
 * Só leitura: nada deste arquivo escreve no banco.
 */

const REUNIAO_STATUSES = ['Reunião agendada', 'Reunião não comparecida'];
const POS_REUNIAO_STATUSES = ['Proposta Enviada', 'Follow-up Propostas', 'Vendido'];
const MILESTONE_NO_SHOW = 'Reunião não comparecida';
const MILESTONE_VENDIDO = 'Vendido';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** "R$ 1.797,00" -> 179700. O valor é texto digitado na planilha do Comercial, não número. */
function centavos(raw: string | null | undefined): number {
  const limpo = (raw ?? '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function limitesDoMes(mes: string): { inicio: string; fimExclusivo: string } {
  const [y, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { inicio: `${mes}-01`, fimExclusivo: prox };
}

export interface RelatorioComercial {
  mes: string;
  rotuloMes: string;
  geradoEm: string;
  investimentoCents: number;
  custosExtrasCents: number;
  custoTotalCents: number;
  leads: number;
  leadsNoCrm: number;
  agendamentos: number;
  reunioesRealizadas: number;
  noShows: number;
  vendas: number;
  vendasDoFunil: number;
  mrrCents: number;
  implCents: number;
  receitaCents: number;
  receitaProjetadaCents: number;
  permanencia: number;
  cplCents: number;
  cacCents: number;
  ticketCents: number;
  roas: number;
  roi: number;
  taxaLeadAgendamento: number;
  taxaComparecimento: number;
  taxaNoShow: number;
  taxaReuniaoVenda: number;
  metas: {
    receitaCents: number;
    mrrCents: number;
    implCents: number;
    vendas: number;
    leads: number;
    agendamentos: number;
  };
  porSdr: { nome: string; cor: string; vendas: number; mrrCents: number }[];
}

export async function montarRelatorioDoMes(mes: string): Promise<RelatorioComercial | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;
  const { inicio, fimExclusivo } = limitesDoMes(mes);

  // Leva do mês: leads criados no período, fora dos quadros de Vendas (que são cópias) e fora das
  // cópias do espelho do CRM do closer — mesma exclusão das Métricas por SDR.
  const funil = await queryOne<{
    leads: string; agendadas: string; compareceram: string; no_show: string; vendidos: string;
  }>(
    `WITH leva AS (
       SELECT lr.id, lr.status,
         (lr.status = ANY($3) OR EXISTS (
            SELECT 1 FROM lead_events le
            WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = ANY($3)
          )) AS agendada,
         (lr.status = ANY($4) OR EXISTS (
            SELECT 1 FROM lead_events le
            WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = ANY($4)
          )) AS compareceu
       FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
       WHERE lb.is_vendas = false AND lr.espelho_origem_id IS NULL AND lr.deleted_at IS NULL
         -- Dia em Brasília, não em UTC: lead criada às 23h do último dia do mês caía no mês
         -- seguinte, e o relatório público divergia da tela interna.
         AND (lr.created_at AT TIME ZONE 'America/Sao_Paulo') >= $1::date
         AND (lr.created_at AT TIME ZONE 'America/Sao_Paulo') < $2::date
     )
     SELECT count(*) AS leads,
            count(*) FILTER (WHERE agendada) AS agendadas,
            count(*) FILTER (WHERE agendada AND compareceu) AS compareceram,
            count(*) FILTER (WHERE agendada AND status = $5) AS no_show,
            count(*) FILTER (WHERE status = $6) AS vendidos
     FROM leva`,
    [inicio, fimExclusivo, REUNIAO_STATUSES, POS_REUNIAO_STATUSES, MILESTONE_NO_SHOW, MILESTONE_VENDIDO]
  );

  // Dinheiro: linhas da aba Vendas fechadas no mês (o campo Fechamento manda; sem ele, a data de
  // criação da linha). Venda revertida fica de fora.
  const vendas = await query<{ sdr: string; valor_mrr: string; valor_implementacao: string }>(
    `SELECT lr.sdr, lr.valor_mrr, lr.valor_implementacao
     FROM lead_rows lr JOIN lead_boards lb ON lb.id = lr.board_id
     WHERE lb.is_vendas AND lr.deleted_at IS NULL AND lr.venda_revertida IS NOT TRUE
       AND COALESCE(NULLIF(lr.fechamento, ''),
                    to_char(lr.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')) >= $1
       AND COALESCE(NULLIF(lr.fechamento, ''),
                    to_char(lr.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')) < $2`,
    [inicio, fimExclusivo]
  );

  const mesManual = await queryOne<{
    investimento_trafego: string; custos_extras: string | null; leads_gerados: number;
    permanencia_media: string; meta_vendas: number | null; meta_mrr: string | null;
    meta_impl: string | null; meta_leads: number | null; meta_agendamentos: number | null;
  }>('SELECT * FROM commercial_months WHERE id = $1', [mes]);

  const cores = await query<{ name: string; color: string }>(
    `SELECT name, color FROM lead_labels WHERE field = 'sdr'`
  );
  const corPorNome = new Map(cores.map((c) => [c.name, c.color]));

  const mrrCents = vendas.reduce((s, v) => s + centavos(v.valor_mrr), 0);
  const implCents = vendas.reduce((s, v) => s + centavos(v.valor_implementacao), 0);
  const receitaCents = mrrCents + implCents;

  const porSdrMapa = new Map<string, { vendas: number; mrrCents: number }>();
  for (const v of vendas) {
    const nome = v.sdr || 'Sem SDR';
    const atual = porSdrMapa.get(nome) ?? { vendas: 0, mrrCents: 0 };
    atual.vendas += 1;
    atual.mrrCents += centavos(v.valor_mrr);
    porSdrMapa.set(nome, atual);
  }

  const leadsNoCrm = Number(funil?.leads ?? 0);
  // Mesma regra da tela: vale o número digitado (o que o tráfego entregou); sem ele, o do CRM.
  const leads = mesManual?.leads_gerados || leadsNoCrm;
  const agendamentos = Number(funil?.agendadas ?? 0);
  const reunioesRealizadas = Number(funil?.compareceram ?? 0);
  const noShows = Number(funil?.no_show ?? 0);
  const vendasDoFunil = Number(funil?.vendidos ?? 0);

  const investimentoCents = centavos(mesManual?.investimento_trafego);
  const custosExtrasCents = centavos(mesManual?.custos_extras);
  const custoTotalCents = investimentoCents + custosExtrasCents;
  const permanencia = Number(mesManual?.permanencia_media ?? 0);
  const comDesfecho = reunioesRealizadas + noShows;

  const [ano, numeroMes] = mes.split('-').map(Number);

  return {
    mes,
    rotuloMes: `${MESES[numeroMes - 1] ?? mes}/${ano}`,
    geradoEm: new Date().toISOString(),
    investimentoCents,
    custosExtrasCents,
    custoTotalCents,
    leads,
    leadsNoCrm,
    agendamentos,
    reunioesRealizadas,
    noShows,
    vendas: vendas.length,
    vendasDoFunil,
    mrrCents,
    implCents,
    receitaCents,
    receitaProjetadaCents: mrrCents * permanencia + implCents,
    permanencia,
    cplCents: leads > 0 ? Math.round(custoTotalCents / leads) : 0,
    // CAC é custo de aquisição PELO TRÁFEGO: divide pelas vendas que vieram do funil.
    cacCents: vendasDoFunil > 0 ? Math.round(custoTotalCents / vendasDoFunil) : 0,
    ticketCents: vendas.length > 0 ? Math.round(receitaCents / vendas.length) : 0,
    roas: custoTotalCents > 0 ? receitaCents / custoTotalCents : 0,
    roi: custoTotalCents > 0 ? (receitaCents - custoTotalCents) / custoTotalCents : 0,
    taxaLeadAgendamento: leads > 0 ? agendamentos / leads : 0,
    // Comparecimento sai sobre as reuniões que já tiveram desfecho — reunião marcada pra frente
    // não derruba a taxa de ninguém.
    taxaComparecimento: comDesfecho > 0 ? reunioesRealizadas / comDesfecho : 0,
    taxaNoShow: comDesfecho > 0 ? noShows / comDesfecho : 0,
    taxaReuniaoVenda: reunioesRealizadas > 0 ? vendasDoFunil / reunioesRealizadas : 0,
    metas: {
      // A meta geral é sempre a soma das duas — não existe campo próprio, pra não se contradizer.
      receitaCents: centavos(mesManual?.meta_mrr) + centavos(mesManual?.meta_impl),
      mrrCents: centavos(mesManual?.meta_mrr),
      implCents: centavos(mesManual?.meta_impl),
      vendas: mesManual?.meta_vendas ?? 0,
      leads: mesManual?.meta_leads ?? 0,
      agendamentos: mesManual?.meta_agendamentos ?? 0,
    },
    porSdr: Array.from(porSdrMapa.entries())
      .map(([nome, v]) => ({ nome, cor: corPorNome.get(nome) ?? '#9CA3AF', ...v }))
      .sort((a, b) => b.vendas - a.vendas),
  };
}

/** Os meses que já têm registro (é o que o link público oferece pra navegar). */
export async function mesesDisponiveis(): Promise<string[]> {
  const linhas = await query<{ id: string }>('SELECT id FROM commercial_months ORDER BY id DESC');
  return linhas.map((l) => l.id);
}
