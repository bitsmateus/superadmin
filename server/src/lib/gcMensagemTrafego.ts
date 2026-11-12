import { query, queryOne } from '../db.js';
import { diasAtras } from './metaInsights.js';
import { chamarClaude, contextoDoCliente } from './gcIa.js';
import { totaisGoogleDoCliente } from './gcGoogleAds.js';
import { interpretarFinanceiro, type FinanceiroMeta } from './gcSaldo.js';

/**
 * "Mensagem para o cliente" da aba Tráfego: o gestor escreve o que quer dizer (ou escolhe um atalho,
 * ex.: "resultado da semana") e a IA monta um recado de WhatsApp com os números reais do cliente
 * (Meta, Google Ads, saldo, edições registradas). O gestor revisa, edita se quiser e copia; nada é
 * enviado sozinho.
 */

export const SISTEMA_MENSAGEM = `Você escreve, em nome da NX Digital (agência de marketing), uma mensagem de WhatsApp para o cliente
sobre o tráfego pago dele (anúncios no Meta: Facebook e Instagram, e no Google Ads).

Você recebe o PEDIDO do gestor (o que a mensagem tem que dizer) e um JSON com os dados do cliente: números do Meta e do
Google Ads (últimos 7 e 30 dias contra os períodos anteriores), campanhas, saldo das contas, as últimas edições feitas
nas campanhas e o histórico recente.

Regras:
- Faça exatamente o que o pedido diz. Se o pedido for curto ("resultado da semana"), escolha os 2 ou 3 números que
  mais importam para o cliente (investimento, leads/conversas/conversões, custo por resultado) e compare com o período
  anterior em linguagem simples.
- Português do Brasil, tom cordial, próximo e profissional. Pode usar 1 ou 2 emojis, sem exagero.
- Comece cumprimentando pelo primeiro nome do contato, se ele vier; senão, "Olá, tudo bem?".
- Sem jargão: troque "CTR", "CPM", "CPC", "conjunto", "lookalike" por explicações curtas.
- Use SÓ números e fatos do JSON ou do pedido. Nunca invente número, resultado, prazo nem prometa resultado.
  Se o dado pedido não existir no JSON, escreva sem ele (não chute).
- Ignore comentários internos que não são para o cliente (opinião sobre o cliente, cobrança interna, problemas da equipe).
- Valores em reais no formato R$ 1.234,56.
- Curta: de 3 a 10 linhas. Se forem vários pontos, use uma lista com "•".
- Não assine com nome de pessoa. Responda SÓ com o texto da mensagem, sem aspas e sem comentários.`;

/** Atalhos que a tela oferece (o gestor pode escrever qualquer outra coisa). */
export const ATALHOS_MENSAGEM = [
  'Resultado da semana',
  'Resultado do mês',
  'O que mudamos nas campanhas',
  'Pedir recarga de saldo',
] as const;

/** O pedido que vai para a IA (puro, coberto por teste). */
export function pedidoDaMensagem(d: { contato: string; pedido: string; dados: Record<string, unknown> }): string {
  const primeiroNome = d.contato.trim().split(/\s+/)[0] ?? '';
  return [
    `Contato: ${primeiroNome || '(não informado)'}`,
    '',
    'PEDIDO do gestor:',
    d.pedido.trim(),
    '',
    'Dados do cliente (JSON):',
    JSON.stringify(d.dados),
  ].join('\n');
}

/** Limpa a resposta: sem aspas em volta e sem espaço sobrando. */
export function limparMensagem(t: string): string {
  return t.trim().replace(/^["“](.*)["”]$/s, '$1').trim().slice(0, 4000);
}

const arred = (v: number | null) => (v == null ? null : Math.round(v * 100) / 100);

/** O que a mensagem pode usar: o contexto da IA do cliente + Google Ads + saldo + edições. */
async function dadosParaMensagem(clienteId: string): Promise<{ contato: string; dados: Record<string, unknown> }> {
  const [contexto, c, g7, g7ant, g30, g30ant, edicoes, contas] = await Promise.all([
    contextoDoCliente(clienteId),
    queryOne<{ nome_contato: string }>('SELECT nome_contato FROM gc_clientes WHERE id = $1', [clienteId]),
    totaisGoogleDoCliente(clienteId, diasAtras(7), diasAtras(1)),
    totaisGoogleDoCliente(clienteId, diasAtras(14), diasAtras(8)),
    totaisGoogleDoCliente(clienteId, diasAtras(30), diasAtras(1)),
    totaisGoogleDoCliente(clienteId, diasAtras(60), diasAtras(31)),
    query<{ texto: string; dia: string }>(
      `SELECT texto, to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia
       FROM gc_trafego_edicoes WHERE gc_cliente_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [clienteId],
    ),
    query<{ nome: string; financeiro: FinanceiroMeta | null }>(
      'SELECT nome, financeiro FROM gc_trafego_contas WHERE gc_cliente_id = $1 AND ativo', [clienteId],
    ),
  ]);
  const google = (t: typeof g7) => ({
    gasto: arred(t.gasto), cliques: t.cliques, conversoes: arred(t.conversoes), custo_por_conversao: arred(t.custoConversao),
    cpc: arred(t.cpc), impressoes: t.impressoes,
  });
  const temGoogle = g30.gasto > 0 || g30ant.gasto > 0;
  return {
    contato: c?.nome_contato ?? '',
    dados: {
      ...contexto,
      // O Instagram não entra no recado de tráfego e pesa no pedido.
      instagram_ultimos_90_dias: undefined,
      google_ads: temGoogle
        ? { ultimos_7_dias: google(g7), '7_dias_anteriores': google(g7ant), ultimos_30_dias: google(g30), '30_dias_anteriores': google(g30ant) }
        : null,
      saldo_contas_meta: contas
        .filter((x) => x.financeiro)
        .map((x) => {
          const f = interpretarFinanceiro(x.financeiro!);
          return { conta: x.nome, forma_pagamento: f.formaPagamento, pre_paga: f.prePaga, saldo_disponivel: f.saldoDisponivel, status: f.statusRotulo };
        }),
      edicoes_recentes_nas_campanhas: edicoes,
    },
  };
}

export async function gerarMensagemPorPedido(clienteId: string, pedido: string): Promise<string> {
  const { contato, dados } = await dadosParaMensagem(clienteId);
  const resposta = await chamarClaude(SISTEMA_MENSAGEM, [{ role: 'user', content: pedidoDaMensagem({ contato, pedido, dados }) }], 1500);
  return limparMensagem(resposta);
}
